#!/usr/bin/env node
/**
 * Runs a build or test command and tells the desktop pet what failed: `buggie-watch [--watch] -- <command…>`.
 * The command's output passes through as it comes; when it ends, its problems (web/dev-errors.js) go to the pet
 * page server's `POST /api/bugs`, where each becomes a bug on the screen until a later run of the same command in
 * the same folder no longer reports it. The exit code is the command's.
 *
 * `--watch` runs it again whenever a file under the current folder changes (`node_modules`, `.git` and build
 * output aside) and keeps going until interrupted. The pet server is looked for on 127.0.0.1 from port 7797 up,
 * or at `BUGGIE_PET_PORT`.
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { problemsIn } from '../web/dev-errors.js';

const FIRST_PORT = 7797, PORT_ATTEMPTS = 10;
/** Lines and characters of the output's end sent along, for explaining a problem the output did not name. */
const TAIL_LINES = 40, TAIL_MAX = 4000;
const IGNORED = /(^|[\\/])(node_modules|\.git|dist|build|out|target|coverage|__pycache__|\.next|\.turbo)([\\/]|$)/;
const SETTLE_MS = 400;

const args = process.argv.slice(2);
const sep = args.indexOf('--');
const flags = sep < 0 ? args.filter((a) => a.startsWith('--')) : args.slice(0, sep);
const command = (sep < 0 ? args.filter((a) => !a.startsWith('--')) : args.slice(sep + 1)).join(' ');
if (!command || flags.includes('--help')) {
  console.log('usage: buggie-watch [--watch] -- <command…>\n  e.g. buggie-watch -- npm test\n       buggie-watch --watch -- npx tsc --noEmit');
  process.exit(command ? 0 : 2);
}
const keepWatching = flags.includes('--watch');
const cwd = process.cwd();

async function petPort() {
  const ports = process.env.BUGGIE_PET_PORT ? [Number(process.env.BUGGIE_PET_PORT)] : Array.from({ length: PORT_ATTEMPTS }, (_, i) => FIRST_PORT + i);
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/bugs`, { signal: AbortSignal.timeout(800) });
      if (res.ok && Array.isArray((await res.json())?.bugs)) return port;
    } catch { /* not this one */ }
  }
  return null;
}

let port = null;
async function report(body) {
  port ??= await petPort();
  if (port === null) { console.error('[buggie] the pet is not running (no pet server on 127.0.0.1)'); return; }
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/bugs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) console.error(`[buggie] the pet refused the report (${res.status})`);
  } catch (err) {
    port = null;
    console.error(`[buggie] the pet could not be reached: ${err.message}`);
  }
}

function tailOf(output) {
  const lines = output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const tail = lines.slice(-TAIL_LINES).join('\n');
  return tail.length > TAIL_MAX ? tail.slice(-TAIL_MAX) : tail;
}

function run() {
  return new Promise((done) => {
    let output = '';
    const child = spawn(command, { cwd, shell: true, env: { FORCE_COLOR: '1', ...process.env }, stdio: ['inherit', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { process.stdout.write(d); output += d; });
    child.stderr.on('data', (d) => { process.stderr.write(d); output += d; });
    child.on('error', (err) => { output += String(err.message); });
    child.on('close', async (code) => {
      const ok = code === 0;
      const tail = tailOf(output);
      let problems = ok ? [] : problemsIn(output);
      // a failure whose output names no problem is still one: its last line stands for it
      if (!ok && !problems.length) problems = [{ file: null, line: null, message: (tail.split('\n').at(-1) || `exit ${code}`).slice(0, 300) }];
      await report({ command, cwd, ok, exitCode: code ?? -1, problems, tail: ok ? '' : tail });
      console.error(ok ? '[buggie] ✓' : `[buggie] ✗ ${problems.length}`);
      done(code ?? 1);
    });
  });
}

if (!keepWatching) process.exit(await run());

let running = false, again = false, timer = 0;
const kick = async () => {
  if (running) { again = true; return; }
  running = true;
  do { again = false; await run(); } while (again);
  running = false;
};
watch(cwd, { recursive: true }, (_event, file) => {
  if (!file || IGNORED.test(String(file))) return;
  clearTimeout(timer);
  timer = setTimeout(kick, SETTLE_MS);
});
await kick();

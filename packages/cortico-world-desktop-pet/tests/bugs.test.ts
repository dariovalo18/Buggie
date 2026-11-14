import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESKTOP_PET_DEFAULTS } from '../src/config.ts';
import { BugBoard, REPORT_PROBLEMS, readReport } from '../src/bugs.ts';
import { DesktopPetWorld } from '../src/world.ts';
import { CLIP_MAX, MAX_PROBLEMS, looksLikeError, problemsIn } from '../web/dev-errors.js';
import { FakeHost } from './helpers/fake-host.ts';
import { FakePage } from './helpers/page.ts';

const BIN = fileURLToPath(new URL('../bin/buggie-watch.mjs', import.meta.url));

describe('problemsIn', () => {
  it('reads the file, line and message of common compilers and test runners', () => {
    expect(problemsIn("src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.")).toEqual([
      { file: 'src/a.ts', line: 12, message: "TS2322: Type 'string' is not assignable to type 'number'." },
    ]);
    expect(problemsIn("\x1b[96msrc/b.ts\x1b[0m:3:1 - \x1b[91merror\x1b[0m TS2304: Cannot find name 'foo'.")).toEqual([
      { file: 'src/b.ts', line: 3, message: "TS2304: Cannot find name 'foo'." },
    ]);
    expect(problemsIn("main.c:10:5: error: expected ';' before 'return'")[0]).toMatchObject({ file: 'main.c', line: 10 });
    expect(problemsIn('main.go:4:2: undefined: x')[0]).toEqual({ file: 'main.go', line: 4, message: 'undefined: x' });
    expect(problemsIn('error[E0425]: cannot find value `y` in this scope\n --> src/main.rs:3:13')[0])
      .toEqual({ file: 'src/main.rs', line: 3, message: 'E0425: cannot find value `y` in this scope' });
    expect(problemsIn('Traceback (most recent call last):\n  File "app.py", line 7, in <module>\n    main()\n  File "app.py", line 4, in main\n    1/0\nZeroDivisionError: division by zero'))
      .toEqual([{ file: 'app.py', line: 4, message: 'ZeroDivisionError: division by zero' }]);
    expect(problemsIn('FAILED tests/test_x.py::test_add - assert 1 == 2')).toEqual([{ file: 'tests/test_x.py', line: null, message: 'test_add: assert 1 == 2' }]);
    expect(problemsIn(' FAIL  tests/sum.test.ts > sum > adds\nAssertionError: expected 3 to be 4\n ❯ tests/sum.test.ts:5:17')[0])
      .toEqual({ file: 'tests/sum.test.ts', line: 5, message: 'sum > adds: AssertionError: expected 3 to be 4' });
  });

  it('keeps each problem once and at most MAX_PROBLEMS', () => {
    const line = (i: number) => `a.ts(${i},1): error TS1: x`;
    expect(problemsIn([line(1), line(1)].join('\n'))).toHaveLength(1);
    expect(problemsIn(Array.from({ length: MAX_PROBLEMS + 5 }, (_, i) => line(i + 1)).join('\n'))).toHaveLength(MAX_PROBLEMS);
  });
});

describe('looksLikeError', () => {
  it('takes stack traces and error lines', () => {
    expect(looksLikeError("TypeError: Cannot read properties of undefined (reading 'x')\n    at foo (/app/a.js:3:9)")).toBe(true);
    expect(looksLikeError('Traceback (most recent call last):\n  File "a.py", line 1, in <module>\nNameError: name \'x\' is not defined')).toBe(true);
    expect(looksLikeError("src/a.ts(1,1): error TS2304: Cannot find name 'x'.")).toBe(true);
  });

  it('leaves prose, links, short words and very long text', () => {
    expect(looksLikeError('I made an error in the meeting notes, sorry about that.')).toBe(false);
    expect(looksLikeError('https://example.com/error')).toBe(false);
    expect(looksLikeError('Error')).toBe(false);
    expect(looksLikeError(`TypeError: x\n    at f (/a.js:1:1)\n${'.'.repeat(CLIP_MAX)}`)).toBe(false);
  });
});

describe('BugBoard', () => {
  const report = (ok: boolean, messages: string[], command = 'npm test') =>
    readReport({ command, cwd: '/p', ok, problems: messages.map((message) => ({ file: 'a.ts', line: 1, message })) })!;

  it('keeps ids across reports, fixes what a report no longer names and everything when one passes', () => {
    const board = new BugBoard();
    const first = board.take(report(false, ['x', 'y']));
    expect(first.added.map((b) => b.message)).toEqual(['x', 'y']);
    const second = board.take(report(false, ['y', 'z']));
    expect(second.added.map((b) => b.message)).toEqual(['z']);
    expect(second.fixed.map((b) => b.message)).toEqual(['x']);
    expect(board.all.find((b) => b.message === 'y')!.id).toBe(first.added[1]!.id);
    const third = board.take(report(true, []));
    expect(third.fixed.map((b) => b.message)).toEqual(['y', 'z']);
    expect(board.all).toEqual([]);
  });

  it('keeps runs of other commands apart', () => {
    const board = new BugBoard();
    board.take(report(false, ['x'], 'tsc'));
    board.take(report(true, [], 'npm test'));
    expect(board.all.map((b) => b.command)).toEqual(['tsc']);
  });

  it('reads a failing report without problems as one, and refuses a report without a command, folder or outcome', () => {
    expect(readReport({ command: 'make', cwd: '/p', ok: false, exitCode: 2 })!.problems).toEqual([{ file: null, line: null, message: 'make: exit 2' }]);
    expect(readReport({ cwd: '/p', ok: false })).toBeNull();
    expect(readReport({ command: 'make', ok: false })).toBeNull();
    expect(readReport({ command: 'make', cwd: '/p' })).toBeNull();
    const many = Array.from({ length: REPORT_PROBLEMS + 3 }, (_, i) => ({ message: `m${i}` }));
    expect(readReport({ command: 'make', cwd: '/p', ok: false, problems: many })!.problems).toHaveLength(REPORT_PROBLEMS);
  });
});

describe('bugs through the World', () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => { for (const s of stops.splice(0).reverse()) await s(); });

  async function mounted() {
    const cfg = structuredClone(DESKTOP_PET_DEFAULTS);
    Object.assign(cfg, { enabled: true, port: 0 });
    cfg.window.enabled = false;
    cfg.asr.enabled = false;
    const dir = mkdtempSync(join(tmpdir(), 'pet-bugs-'));
    const world = new DesktopPetWorld({ cfg, timezone: 'UTC', persist: () => {}, runtimesRoot: () => join(dir, 'r'), modelsDir: () => join(dir, 'm') });
    const host = new FakeHost();
    await world.start(host);
    stops.push(() => world.stop());
    const origin = world.petUrl.replace(/\/pet$/, '');
    const page = await FakePage.open(origin);
    stops.push(() => page.close());
    return { world, host, page, origin };
  }
  const post = (origin: string, body: unknown) =>
    fetch(`${origin}/api/bugs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('shows a failed run as bugs, tells the bot with its next wake, and has the page eat them when the run passes', async () => {
    const { host, page, origin } = await mounted();
    const res = await post(origin, { command: 'npm test', cwd: '/p', ok: false, problems: [{ file: 'a.ts', line: 3, message: 'boom' }], tail: 'boom' });
    expect(res.status).toBe(200);
    const shown = await page.next((m) => m.t === 'bugs');
    expect(shown.bugs).toMatchObject([{ file: 'a.ts', line: 3, message: 'boom' }]);
    await expect.poll(() => host.events.length).toBe(1);
    expect(host.events[0]).toMatchObject({ type: 'desktop-pet.build' });
    expect(host.events[0]!.text).toContain('a.ts:3 boom');
    expect(host.pushOpts[0]).toEqual({ trigger: 'piggyback' });
    expect(await (await fetch(`${origin}/api/bugs`)).json()).toMatchObject({ bugs: [{ message: 'boom' }] });

    const id = (shown.bugs as Array<{ id: string }>)[0]!.id;
    page.send({ t: 'bug', id });
    await expect.poll(() => host.events.length).toBe(2);
    expect(host.events[1]).toMatchObject({ type: 'desktop-pet.explain' });
    expect(host.events[1]!.text).toContain('a.ts:3 boom');
    expect(host.pushOpts[1]).toEqual({ trigger: 'preempt' });

    await post(origin, { command: 'npm test', cwd: '/p', ok: true });
    const fixed = await page.next((m) => m.t === 'bugs' && (m.bugs as unknown[]).length === 0);
    expect(fixed.fixed).toEqual([id]);
    await expect.poll(() => host.events.length).toBe(3);
    expect(host.events[2]).toMatchObject({ type: 'desktop-pet.build' });
  });

  it('refuses what is not a report', async () => {
    const { origin } = await mounted();
    expect((await post(origin, { ok: false })).status).toBe(400);
  });

  it('passes copied text the person asked about to the bot at once', async () => {
    const { host, page } = await mounted();
    page.send({ t: 'explain', text: 'TypeError: x is not a function\n    at f (/a.js:1:1)' });
    await expect.poll(() => host.events.length).toBe(1);
    expect(host.events[0]).toMatchObject({ type: 'desktop-pet.explain' });
    expect(host.events[0]!.text).toContain('TypeError: x is not a function');
    expect(host.pushOpts[0]).toEqual({ trigger: 'preempt' });
  });

  it('buggie-watch runs the command, passes on its exit code and reports its problems', async () => {
    const { page, world } = await mounted();
    const port = new URL(world.petUrl).port;
    const dir = mkdtempSync(join(tmpdir(), 'pet-watch-'));
    const script = join(dir, 'fail.cjs');
    writeFileSync(script, 'console.error("src/x.ts(2,1): error TS2304: Cannot find name \'q\'."); process.exit(2);');
    const code = await new Promise<number | null>((done) => {
      const child = spawn(process.execPath, [BIN, '--', `"${process.execPath}" "${script}"`], { cwd: dir, env: { ...process.env, BUGGIE_PET_PORT: port }, stdio: 'ignore' });
      child.on('close', done);
    });
    expect(code).toBe(2);
    const shown = await page.next((m) => m.t === 'bugs');
    expect(shown.bugs).toMatchObject([{ file: 'src/x.ts', line: 2, message: "TS2304: Cannot find name 'q'." }]);
  });
});

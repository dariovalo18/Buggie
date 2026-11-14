/**
 * Programming errors in text: what a build or test run printed (`problemsIn`, read by bin/buggie-watch.mjs) and
 * whether a piece of copied text is an error at all (`looksLikeError`, read by the pet page for the clipboard).
 * Plain functions over strings, so the command line and the page share them.
 *
 * A problem is `{ file, line, message }`, `file` and `line` null when the output did not say. The formats read:
 * `file(12,5): error TS…` and `file:12:5 - error …` (TypeScript), `file:12:5: error: …` (gcc, clang), `file.go:12:5: …` (Go), Rust's
 * `--> file:12:5`), Python's `File "x.py", line 12` closed by its exception line, pytest's `FAILED a.py::t - …`,
 * and Vitest's and Jest's `FAIL file > test` / `● test` headers.
 */

/** Most problems kept from one run, and most characters of one message. */
export const MAX_PROBLEMS = 20, MESSAGE_MAX = 300;
/** Most characters of copied text the page looks at, and fewest that can be an error report. */
export const CLIP_MAX = 8000, CLIP_MIN = 12;

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const clean = (s) => s.replace(ANSI, '').replace(/\r/g, '');
const cut = (s) => (s.length > MESSAGE_MAX ? s.slice(0, MESSAGE_MAX - 1) + '…' : s);

const TSC = /^(.+?)\((\d+),\d+\):\s+error\s+(\w+):\s*(.*)$/;
const TSC_PRETTY = /^(.+?):(\d+):\d+\s+-\s+error\s+(\w+):\s*(.*)$/;
const CC = /^(.+?):(\d+)(?::\d+)?:\s*(?:fatal\s+)?error(?:\[\w+\])?:\s*(.*)$/i;
const GO = /^(.+?\.go):(\d+):\d+:\s*(.*)$/;
const RUST_HEAD = /^error(?:\[(\w+)\])?:\s*(.*)$/;
const RUST_AT = /^\s*-->\s*(.+?):(\d+):\d+/;
const PY_FRAME = /^\s*File "(.+?)", line (\d+)/;
const PY_RAISED = /^([A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt|Warning)|AssertionError|KeyError|StopIteration)(?::\s*(.*))?$/;
const PYTEST = /^FAILED\s+(.+?)::(\S+)(?:\s+-\s+(.*))?$/;
const JS_FAIL = /^\s*(?:FAIL|×|✗|✕)\s+(\S+\.(?:[cm]?[jt]sx?))\s*(?:>\s*(.*))?$/;
const JS_AT = /\(?((?:[A-Za-z]:)?[^\s():]+\.(?:[cm]?[jt]sx?)):(\d+):\d+\)?\s*$/;

/** The problems in `output`, at most MAX_PROBLEMS, each once. */
export function problemsIn(output) {
  const lines = clean(String(output ?? '')).split('\n');
  const out = [], seen = new Set();
  const add = (file, line, message) => {
    const p = { file: file ? file.trim() : null, line: line ? Number(line) : null, message: cut((message || '').trim()) };
    if (!p.message) return;
    const key = `${p.file}:${p.line}:${p.message}`;
    if (seen.has(key) || out.length >= MAX_PROBLEMS) return;
    seen.add(key);
    out.push(p);
  };
  let py = null, rust = null;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i];
    let m;
    if ((m = TSC.exec(s)) || (m = TSC_PRETTY.exec(s))) { add(m[1], m[2], `${m[3]}: ${m[4]}`); continue; }
    if ((m = PYTEST.exec(s))) { add(m[1], null, m[3] ? `${m[2]}: ${m[3]}` : m[2]); continue; }
    if ((m = PY_FRAME.exec(s))) { py = { file: m[1], line: m[2] }; continue; }
    if (py && (m = PY_RAISED.exec(s.trim()))) { add(py.file, py.line, m[2] ? `${m[1]}: ${m[2]}` : m[1]); py = null; continue; }
    if ((m = RUST_HEAD.exec(s))) { rust = m[1] ? `${m[1]}: ${m[2]}` : m[2]; continue; }
    if (rust && (m = RUST_AT.exec(s))) { add(m[1], m[2], rust); rust = null; continue; }
    if ((m = CC.exec(s)) || (m = GO.exec(s))) { add(m[1], m[2], m[3]); continue; }
    if ((m = JS_FAIL.exec(s))) {
      // the test's own failure is a few lines down: the first line that reads as an error
      const why = lines.slice(i + 1, i + 12).map((l) => l.trim()).find((l) => /Error|expected|Expected|assert/i.test(l));
      const where = lines.slice(i + 1, i + 30).map((l) => JS_AT.exec(l)).find((x) => x && !x[1].includes('node_modules'));
      add(where?.[1] ?? m[1], where?.[2] ?? null, [m[2], why].filter(Boolean).join(': ') || m[1]);
    }
  }
  return out;
}

const TRACE = [
  /^\s+at\s+\S.*\(.*:\d+:\d+\)\s*$/m, // JavaScript
  /^\s+at\s+[\w$.<>]+\(.*\.java:\d+\)\s*$/m, // Java
  /Traceback \(most recent call last\):/, // Python
  /^\s*File ".+", line \d+/m,
  /^goroutine \d+ \[/m, // Go
  /panicked at /, // Rust
  /^\s*-->\s*\S+:\d+:\d+/m,
];
const ERROR_LINE = /(^|\n)\s*(Uncaught\s+)?([A-Z][\w.]*(Error|Exception)|error(\[\w+\])?|fatal error|panic|FAILED|Segmentation fault)\b[:\s]/;

/**
 * Whether copied `text` is a programming error: a stack trace, or a compiler's or runtime's error line.
 * Plain prose that mentions an error, a URL, and one short word are not.
 */
export function looksLikeError(text) {
  if (typeof text !== 'string') return false;
  const s = clean(text).trim();
  if (s.length < CLIP_MIN || s.length > CLIP_MAX) return false;
  if (TRACE.some((r) => r.test(s))) return true;
  if (problemsIn(s).length) return true;
  return ERROR_LINE.test(s) && /[:()[\]{}/\\.=]/.test(s);
}

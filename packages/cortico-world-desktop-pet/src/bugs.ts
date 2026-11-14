/**
 * The bugs on the screen: the problems of build and test runs that bin/buggie-watch.mjs reports to `POST /api/bugs`.
 * A run is one command in one folder; each report replaces that run's problems, so a problem a later report no longer
 * names is fixed, and a passing report fixes all of them. A bug keeps its id across reports while its file, line and
 * message stay the same.
 */
import { createHash } from 'node:crypto';

export interface Problem {
  file: string | null;
  line: number | null;
  message: string;
}

export interface Bug extends Problem {
  id: string;
  command: string;
  cwd: string;
}

export interface BugReport {
  command: string;
  cwd: string;
  ok: boolean;
  problems: Problem[];
  /** The end of the run's output, empty for a passing one. */
  tail: string;
}

/** Most problems kept from one report, most bugs on the screen at once, and the longest texts kept. */
export const REPORT_PROBLEMS = 20, BUGS_MAX = 40;
const COMMAND_MAX = 200, PATH_MAX = 260, MESSAGE_MAX = 300, TAIL_MAX = 4000;

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** A report as the server takes it, or null when it lacks a command, a folder or whether it passed. */
export function readReport(v: unknown): BugReport | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const command = text(r.command, COMMAND_MAX), cwd = text(r.cwd, PATH_MAX);
  if (!command || !cwd || typeof r.ok !== 'boolean') return null;
  const problems: Problem[] = [];
  for (const p of Array.isArray(r.problems) && !r.ok ? r.problems : []) {
    const message = text((p as Problem)?.message, MESSAGE_MAX);
    if (!message) continue;
    const line = (p as Problem).line;
    problems.push({ file: text((p as Problem).file, PATH_MAX), line: Number.isInteger(line) && line! > 0 ? line : null, message });
    if (problems.length === REPORT_PROBLEMS) break;
  }
  // a failing run whose problems did not come through is still one problem
  if (!r.ok && !problems.length) problems.push({ file: null, line: null, message: `${command}: exit ${typeof r.exitCode === 'number' ? r.exitCode : '?'}` });
  return { command, cwd, ok: r.ok, problems, tail: r.ok ? '' : (typeof r.tail === 'string' ? r.tail.slice(-TAIL_MAX) : '') };
}

/** `file:line message`, as the bot reads a problem. */
export const problemLine = (p: Problem): string => (p.file ? `${p.file}${p.line ? `:${p.line}` : ''} ${p.message}` : p.message);

interface Run {
  command: string;
  cwd: string;
  tail: string;
  bugs: Bug[];
}

export class BugBoard {
  private readonly runs = new Map<string, Run>();

  /** Every bug, oldest run first, at most BUGS_MAX. */
  get all(): Bug[] {
    return [...this.runs.values()].flatMap((r) => r.bugs).slice(0, BUGS_MAX);
  }

  /** Takes a report: the bugs it brought that were not there before, and those of the run's last report it no longer names. */
  take(r: BugReport): { added: Bug[]; fixed: Bug[] } {
    const key = `${r.cwd}\0${r.command}`;
    const before = this.runs.get(key)?.bugs ?? [];
    const bugs = r.problems.map((p) => ({ ...p, command: r.command, cwd: r.cwd, id: bugId(key, p) }));
    const ids = new Set(bugs.map((b) => b.id)), had = new Set(before.map((b) => b.id));
    this.runs.delete(key);
    // a run reported again moves to the end, so the newest runs are the ones `all` keeps
    if (bugs.length) this.runs.set(key, { command: r.command, cwd: r.cwd, tail: r.tail, bugs });
    return { added: bugs.filter((b) => !had.has(b.id)), fixed: before.filter((b) => !ids.has(b.id)) };
  }

  /** A bug on the screen with the end of its run's output. */
  find(id: string): { bug: Bug; tail: string } | null {
    for (const run of this.runs.values()) {
      const bug = run.bugs.find((b) => b.id === id);
      if (bug) return { bug, tail: run.tail };
    }
    return null;
  }

  clear(): void {
    this.runs.clear();
  }
}

function bugId(run: string, p: Problem): string {
  return createHash('sha256').update(`${run}\0${p.file ?? ''}\0${p.line ?? ''}\0${p.message}`).digest('hex').slice(0, 16);
}

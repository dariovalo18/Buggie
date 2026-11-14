/**
 * GitHub, read on a timer while `github.enabled` is on: the newest finished Actions run of each workflow and branch in
 * the configured repositories, and the person's notifications.
 *
 * - A run is reported as a build run (src/bugs.ts) of `CI <workflow> · <branch>` in `github.com/<repo>`: a failed one
 *   with a problem per failed job and step, a passing one fixing them. Each run is reported once. With a token the runs
 *   are the person's own (`actor`); without one, everyone's.
 * - Notifications need a token: those that arrived since the last read, on pull requests and issues, are passed on.
 *
 * The token is whatever `token()` gives (src/world.ts: GH_TOKEN, GITHUB_TOKEN, or `gh auth token`); without one only
 * public repositories can be read, and less often, as GitHub's anonymous limit is 60 requests an hour.
 */
import type { BugReport, Problem } from './bugs.ts';

const API = 'https://api.github.com';
/** Seconds between reads with a token and without one. */
export const POLL_SECONDS = 90, POLL_SECONDS_ANON = 300;
const RUNS_PER_PAGE = 30;
/** Conclusions of a run that count as failed; cancelled and skipped runs are left out. */
const FAILED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required']);
/** Notification subjects passed on. */
const SUBJECTS = new Set(['PullRequest', 'Issue']);

export interface Notice {
  repo: string;
  /** GitHub's reason: review_requested, author, comment, mention, assign, state_change, … */
  reason: string;
  title: string;
  type: string;
}

export interface GithubWatchOptions {
  fetch: typeof fetch;
  token(): Promise<string | null>;
  /** The repositories, `owner/repo`, read at each poll. */
  repos(): string[];
  onRun(report: BugReport): void;
  onNotices(notices: Notice[]): void;
  warn?(message: string): void;
  now?(): number;
}

/** `owner/repo` from each comma-separated entry of `value`, a github.com URL included; others are dropped. */
export function readRepos(value: string): string[] {
  const out: string[] = [];
  for (const raw of value.split(/[,\s]+/)) {
    const repo = raw.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    if (/^[\w.-]+\/[\w.-]+$/.test(repo) && !out.includes(repo)) out.push(repo);
  }
  return out;
}

interface Run {
  id: number; name: string; workflow_id: number; head_branch: string; status: string; conclusion: string | null;
  html_url: string; created_at: string;
}
interface Job { name: string; conclusion: string | null; steps?: Array<{ name: string; conclusion: string | null }> }
interface Thread { id: string; reason: string; updated_at: string; subject: { title: string; type: string }; repository: { full_name: string } }

export class GithubWatch {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  /** The login the token belongs to; undefined until asked, null without a token or when it could not be read. */
  private login: string | null | undefined;
  private loginFor: string | null = null;
  /** The last run reported, by repo, workflow and branch. */
  private readonly seen = new Map<string, number>();
  /** Notifications are read from here on: the first read starts at the watch's start, so older ones are not repeated. */
  private since = '';
  private lastWarning = '';

  constructor(private readonly o: GithubWatchOptions) {}

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  /** Reads now, then on the timer, until `stop`. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.since = new Date(this.now()).toISOString();
    void this.loop();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
  }

  private async loop(): Promise<void> {
    let token: string | null = null;
    try {
      token = await this.o.token();
      await this.poll(token);
    } catch (err) {
      this.warn((err as Error).message);
    }
    if (this.running) this.timer = setTimeout(() => void this.loop(), (token ? POLL_SECONDS : POLL_SECONDS_ANON) * 1000);
  }

  private warn(message: string): void {
    if (message === this.lastWarning) return;
    this.lastWarning = message;
    this.o.warn?.(message);
  }

  private async get<T>(path: string, token: string | null): Promise<T> {
    const res = await this.o.fetch(`${API}${path}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'cortico-world-desktop-pet', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status} ${path.split('?')[0]}`);
    return await res.json() as T;
  }

  /** One read of every repository and of the notifications. */
  async poll(token: string | null): Promise<void> {
    if (token !== this.loginFor) { this.login = undefined; this.loginFor = token; }
    if (token && this.login === undefined) {
      try { this.login = (await this.get<{ login?: string }>('/user', token)).login ?? null; } catch { this.login = null; }
    }
    for (const repo of this.o.repos()) {
      try { await this.readRuns(repo, token); } catch (err) { this.warn((err as Error).message); }
    }
    if (token) await this.readNotices(token);
  }

  private async readRuns(repo: string, token: string | null): Promise<void> {
    const actor = token && this.login ? `&actor=${encodeURIComponent(this.login)}` : '';
    const { workflow_runs: runs = [] } = await this.get<{ workflow_runs?: Run[] }>(`/repos/${repo}/actions/runs?per_page=${RUNS_PER_PAGE}${actor}`, token);
    const newest = new Map<string, Run>();
    for (const run of runs) {
      if (run.status !== 'completed') continue;
      const key = `${repo}\0${run.workflow_id}\0${run.head_branch}`;
      const had = newest.get(key);
      if (!had || run.created_at > had.created_at) newest.set(key, run);
    }
    for (const [key, run] of newest) {
      if (this.seen.get(key) === run.id) continue;
      const failed = FAILED.has(run.conclusion ?? '');
      if (!failed && run.conclusion !== 'success') continue;
      this.seen.set(key, run.id);
      const base = { command: `CI ${run.name} · ${run.head_branch}`, cwd: `github.com/${repo}` };
      if (!failed) { this.o.onRun({ ...base, ok: true, problems: [], tail: '' }); continue; }
      const problems = await this.failedSteps(repo, run, token);
      this.o.onRun({ ...base, ok: false, problems, tail: run.html_url });
    }
  }

  private async failedSteps(repo: string, run: Run, token: string | null): Promise<Problem[]> {
    try {
      const { jobs = [] } = await this.get<{ jobs?: Job[] }>(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`, token);
      const out: Problem[] = [];
      for (const job of jobs) {
        if (!FAILED.has(job.conclusion ?? '')) continue;
        const steps = (job.steps ?? []).filter((s) => FAILED.has(s.conclusion ?? ''));
        if (!steps.length) out.push({ file: null, line: null, message: `${job.name}: ${job.conclusion}` });
        for (const step of steps) out.push({ file: null, line: null, message: `${job.name} › ${step.name}` });
      }
      if (out.length) return out;
    } catch { /* the run's own conclusion stands in */ }
    return [{ file: null, line: null, message: `${run.name}: ${run.conclusion}` }];
  }

  private async readNotices(token: string): Promise<void> {
    const since = this.since;
    this.since = new Date(this.now()).toISOString();
    let threads: Thread[];
    try {
      threads = await this.get<Thread[]>(`/notifications?participating=true&since=${encodeURIComponent(since)}`, token);
    } catch (err) {
      this.since = since;
      this.warn((err as Error).message);
      return;
    }
    const notices = threads
      .filter((t) => SUBJECTS.has(t.subject?.type) && t.updated_at >= since)
      .map((t) => ({ repo: t.repository.full_name, reason: t.reason, title: t.subject.title, type: t.subject.type }));
    if (notices.length) this.o.onNotices(notices);
  }
}

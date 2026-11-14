import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DESKTOP_PET_DEFAULTS, hoverButtonList } from '../src/config.ts';
import { FocusTimer, type FocusChange, type FocusState } from '../src/focus.ts';
import { GithubWatch, readRepos, type Notice } from '../src/github.ts';
import type { BugReport } from '../src/bugs.ts';
import { DesktopPetWorld } from '../src/world.ts';
import { KIT_TOOLS, runTool } from '../web/dev-kit.js';
import { FakeHost } from './helpers/fake-host.ts';
import { FakePage } from './helpers/page.ts';

afterEach(() => { vi.useRealTimers(); });

describe('FocusTimer', () => {
  it('runs a block, then its break, then stops; stop ends either at once', () => {
    vi.useFakeTimers({ now: 0 });
    const seen: Array<[FocusState | null, FocusChange]> = [];
    const timer = new FocusTimer({ lengths: () => ({ minutes: 25, breakMinutes: 5 }), onChange: (s, c) => seen.push([s, c]), now: () => Date.now() });
    timer.start();
    expect(timer.state).toEqual({ phase: 'focus', endsAt: 25 * 60_000, minutes: 25 });
    vi.advanceTimersByTime(25 * 60_000);
    expect(timer.state).toMatchObject({ phase: 'break', minutes: 5 });
    vi.advanceTimersByTime(5 * 60_000);
    expect(timer.state).toBeNull();
    expect(seen.map(([, c]) => c)).toEqual(['start', 'break', 'done']);
    timer.start();
    timer.stop();
    vi.advanceTimersByTime(60 * 60_000);
    expect(seen.map(([, c]) => c)).toEqual(['start', 'break', 'done', 'start', 'stop']);
  });
});

describe('readRepos', () => {
  it('takes owner/repo and GitHub URLs, each once, and drops the rest', () => {
    expect(readRepos('a/b, https://github.com/c/d.git  a/b, nope, e/f/g')).toEqual(['a/b', 'c/d']);
  });
});

/** A GitHub API stand-in: answers by path from `routes`, records each request. */
function fakeGithub(routes: Record<string, unknown>) {
  const asked: Array<{ path: string; auth: string | null }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const path = u.pathname + u.search;
    asked.push({ path, auth: new Headers(init?.headers).get('authorization') });
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    return key ? new Response(JSON.stringify(routes[key]), { status: 200 }) : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}
const run = (id: number, conclusion: string, created: string, workflow = 1, branch = 'main') =>
  ({ id, name: 'test', workflow_id: workflow, head_branch: branch, status: 'completed', conclusion, html_url: `https://github.com/o/r/actions/runs/${id}`, created_at: created });

describe('GithubWatch', () => {
  it('reports the newest finished run of each workflow and branch once, a failed one with its failed steps', async () => {
    const routes: Record<string, unknown> = {
      '/user': { login: 'me' },
      '/repos/o/r/actions/runs/2/jobs': { jobs: [{ name: 'build', conclusion: 'failure', steps: [{ name: 'tsc', conclusion: 'failure' }, { name: 'lint', conclusion: 'success' }] }] },
      '/repos/o/r/actions/runs?': { workflow_runs: [run(1, 'success', '2026-01-01T00:00:00Z'), run(2, 'failure', '2026-01-02T00:00:00Z'), { ...run(3, null as never, '2026-01-03T00:00:00Z'), status: 'in_progress' }] },
      '/notifications': [],
    };
    const { fetchImpl, asked } = fakeGithub(routes);
    const runs: BugReport[] = [];
    const watch = new GithubWatch({ fetch: fetchImpl, token: async () => 'tok', repos: () => ['o/r'], onRun: (r) => runs.push(r), onNotices: () => {} });
    await watch.poll('tok');
    expect(runs).toEqual([{ command: 'CI test · main', cwd: 'github.com/o/r', ok: false, problems: [{ file: null, line: null, message: 'build › tsc' }], tail: 'https://github.com/o/r/actions/runs/2' }]);
    expect(asked.find((a) => a.path.startsWith('/repos/o/r/actions/runs?'))!.path).toContain('actor=me');
    expect(asked.every((a) => a.auth === 'Bearer tok')).toBe(true);
    await watch.poll('tok');
    expect(runs).toHaveLength(1);
    routes['/repos/o/r/actions/runs?'] = { workflow_runs: [run(4, 'success', '2026-01-04T00:00:00Z')] };
    await watch.poll('tok');
    expect(runs[1]).toMatchObject({ command: 'CI test · main', ok: true });
  });

  it('reads no notifications and names no actor without a token', async () => {
    const { fetchImpl, asked } = fakeGithub({ '/repos/o/r/actions/runs?': { workflow_runs: [] } });
    const watch = new GithubWatch({ fetch: fetchImpl, token: async () => null, repos: () => ['o/r'], onRun: () => {}, onNotices: () => {} });
    await watch.poll(null);
    expect(asked.map((a) => a.path)).toEqual(['/repos/o/r/actions/runs?per_page=30']);
  });

  it('passes on notifications on pull requests and issues since the last read', async () => {
    const at = '2026-03-01T10:00:00Z';
    const { fetchImpl } = fakeGithub({
      '/user': { login: 'me' },
      '/notifications': [
        { id: '1', reason: 'review_requested', updated_at: at, subject: { title: 'Add parser', type: 'PullRequest' }, repository: { full_name: 'o/r' } },
        { id: '2', reason: 'ci_activity', updated_at: at, subject: { title: 'CI', type: 'CheckSuite' }, repository: { full_name: 'o/r' } },
      ],
    });
    const got: Notice[][] = [];
    const watch = new GithubWatch({ fetch: fetchImpl, token: async () => 'tok', repos: () => [], onRun: () => {}, onNotices: (n) => got.push(n), now: () => Date.parse('2026-03-01T09:00:00Z') });
    watch.start();
    await vi.waitFor(() => expect(got).toHaveLength(1));
    watch.stop();
    expect(got[0]).toEqual([{ repo: 'o/r', reason: 'review_requested', title: 'Add parser', type: 'PullRequest' }]);
  });
});

describe('the tool kit', () => {
  it('converts text with each tool', async () => {
    expect(KIT_TOOLS).toContain('jwt');
    expect(await runTool('json', '{"a":[1]}')).toEqual({ ok: true, out: '{\n  "a": [\n    1\n  ]\n}' });
    expect((await runTool('json', '{a:1}')).ok).toBe(false);
    expect(await runTool('b64', '¡ñ!')).toEqual({ ok: true, out: 'wqHDsSE=' });
    expect(await runTool('unb64', 'wqHDsSE')).toEqual({ ok: true, out: '¡ñ!' });
    expect((await runTool('unb64', '***')).ok).toBe(false);
    const token = `${btoa('{"alg":"none"}')}.${btoa('{"sub":"x","exp":0}')}.sig`;
    expect((await runTool('jwt', token)).out).toContain('exp: 1970-01-01T00:00:00.000Z');
    expect((await runTool('time', '0')).out.split('\n')[0]).toBe('1970-01-01T00:00:00.000Z');
    expect((await runTool('time', '1700000000123')).out.split('\n')[0]).toBe('2023-11-14T22:13:20.123Z');
    expect((await runTool('time', '1970-01-01T00:00:01Z')).out.split('\n').slice(0, 2)).toEqual(['1', '1000']);
    expect(await runTool('url', 'a b&c')).toEqual({ ok: true, out: 'a%20b%26c' });
    expect(await runTool('unurl', 'a+b%26c')).toEqual({ ok: true, out: 'a b&c' });
    expect(await runTool('sha256', 'abc')).toEqual({ ok: true, out: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
    expect((await runTool('uuid', '')).out).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('focus and GitHub through the World', () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => { for (const s of stops.splice(0).reverse()) await s(); });

  async function mounted(patch: (c: typeof DESKTOP_PET_DEFAULTS) => void = () => {}, extra: Partial<ConstructorParameters<typeof DesktopPetWorld>[0]> = {}) {
    const cfg = structuredClone(DESKTOP_PET_DEFAULTS);
    Object.assign(cfg, { enabled: true, port: 0 });
    cfg.window.enabled = false;
    cfg.asr.enabled = false;
    patch(cfg);
    const dir = mkdtempSync(join(tmpdir(), 'pet-dev-'));
    const world = new DesktopPetWorld({ cfg, timezone: 'UTC', persist: () => {}, runtimesRoot: () => join(dir, 'r'), modelsDir: () => join(dir, 'm'), ...extra });
    const host = new FakeHost();
    await world.start(host);
    stops.push(() => world.stop());
    const page = await FakePage.open(world.petUrl.replace(/\/pet$/, ''));
    stops.push(() => page.close());
    return { world, host, page, cfg };
  }

  it('starts and stops a focus block from the page, shows it on every page and tells the bot with its next wake', async () => {
    const { host, page } = await mounted();
    page.send({ t: 'focus', action: 'start' });
    const on = await page.next((m) => m.t === 'prefs' && !!m.focus);
    expect(on.focus).toMatchObject({ phase: 'focus', minutes: DESKTOP_PET_DEFAULTS.focus.minutes });
    await expect.poll(() => host.events.length).toBe(1);
    expect(host.events[0]).toMatchObject({ type: 'desktop-pet.focus' });
    expect(host.pushOpts[0]).toEqual({ trigger: 'piggyback' });
    page.send({ t: 'focus', action: 'stop' });
    await page.next((m) => m.t === 'prefs' && 'focus' in m && m.focus === null);
    await expect.poll(() => host.events.length).toBe(2);
  });

  it('turns a failing Actions run into bugs and wakes the bot for notifications', async () => {
    const { fetchImpl } = fakeGithub({
      '/user': { login: 'me' },
      '/repos/o/r/actions/runs/2/jobs': { jobs: [] },
      '/repos/o/r/actions/runs?': { workflow_runs: [run(2, 'failure', '2026-01-02T00:00:00Z')] },
      '/notifications': [{ id: '1', reason: 'review_requested', updated_at: '2999-01-01T00:00:00Z', subject: { title: 'Add parser', type: 'PullRequest' }, repository: { full_name: 'o/r' } }],
    });
    const { host, page } = await mounted((c) => { c.github = { enabled: true, repos: 'o/r' }; }, { fetchImpl, githubToken: async () => 'tok' });
    // GitHub is read from the World's start: the bugs come with the page's init, or after it
    const withBugs = () => [page.init, ...page.messages].filter((m) => (m.t === 'bugs' || m.t === 'init') && Array.isArray(m.bugs) && m.bugs.length).at(-1);
    await expect.poll(withBugs).toBeTruthy();
    expect(withBugs()!.bugs).toMatchObject([{ command: 'CI test · main', cwd: 'github.com/o/r', message: 'test: failure' }]);
    await expect.poll(() => host.events.map((e) => e.type).sort()).toEqual(['desktop-pet.build', 'desktop-pet.github']);
    const github = host.events.findIndex((e) => e.type === 'desktop-pet.github');
    expect(host.events[github]!.text).toContain('Add parser');
    expect(host.pushOpts[github]).toEqual({ trigger: 'debounce' });
  });

  it('offers the kit and focus among the hover buttons', () => {
    expect(hoverButtonList('kit,focus,nope')).toEqual(['kit', 'focus']);
  });
});

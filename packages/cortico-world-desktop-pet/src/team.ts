/**
 * The team server (team-server/ in the app's repository), read while `team.enabled` is on and the person is signed in
 * with an org picked: the account, the org's sectors, projects and members, and its activity log.
 *
 * - The log is read with `/changes?wait`, so an entry arrives as it is written. Entries the person caused are dropped;
 *   of the rest, those about them become notices: a ticket assigned to them, a new unassigned ticket in one of their
 *   sectors, a change or a comment on a ticket they are assigned or wrote, and their addition to a sector or project.
 * - The first read after a start or a change of org takes the current sequence, so nothing older is told.
 * - `call` is every other request, for the settings window and the bot's tools; it fails with the server's error code.
 */

/** Seconds a `/changes` request waits on the server, and the pause after a failed read. */
export const WAIT_SECONDS = 25, RETRY_SECONDS = 30;
/** How often the org (sectors and their members) is read again besides after an addition. */
const VIEW_SECONDS = 10 * 60;

export interface Person { username: string; name: string }
export interface TicketSummary {
  ref: string; project: string; kind?: string; title: string; status: string; priority: string; sector: string | null;
  assignee: Person | null; author: Person | null;
  /** The details its kind still needs before it can be worked (expected, steps, acceptance…); absent from an older server. */
  missing?: string[];
}
export interface OrgView {
  org: { id: number; name: string; role: string; invite?: string };
  members: Array<Person & { role: string }>;
  sectors: Array<{ id: number; name: string; members: Person[] }>;
  projects: Array<{ key: string; name: string; repos: string[]; archived: boolean; sectors: string[]; members: Person[] }>;
}
interface Change {
  seq: number; kind: string; actor: Person | null; ticket?: TicketSummary;
  fields?: Record<string, { from: unknown; to: unknown }>; excerpt?: string; member?: Person; sector?: string; project?: string;
  /** A Telegram entry's message, and the Telegram name a link was made with. */
  text?: string; telegram?: string;
}

export type TeamNotice =
  | { kind: 'assigned' | 'sector'; actor: string; ticket: TicketSummary }
  | { kind: 'changed'; actor: string; ticket: TicketSummary; fields: string[] }
  | { kind: 'comment'; actor: string; ticket: TicketSummary; excerpt: string }
  | { kind: 'added'; actor: string; to: 'sector' | 'project'; name: string };

export interface TeamOptions {
  fetch: typeof fetch;
  enabled(): boolean;
  /** The server's address, e.g. `http://127.0.0.1:8791`. */
  url(): string;
  token(): string | null;
  storeToken(token: string | null): void;
  org(): number | null;
  setOrg(id: number | null): void;
  onNotices(notices: TeamNotice[]): void;
  /** The entries for this account only: a message it was sent on the company's Telegram bot, or the link made. */
  onTelegram?(entry: { kind: 'message'; text: string } | { kind: 'linked'; name: string }): void;
  /** Called when what `state` shows changes. */
  onState?(): void;
  warn?(message: string): void;
}

/** A failed request: `code` is the server's error code, or `unreachable`. */
export class TeamError extends Error {
  constructor(readonly code: string, readonly status = 0) { super(code); }
}

export class TeamClient {
  user: Person | null = null;
  orgs: Array<{ id: number; name: string; role: string }> = [];
  view: OrgView | null = null;
  /** Why the last read failed; null after one that worked. */
  problem: string | null = null;
  private generation = 0;
  private abort: AbortController | null = null;
  private viewAt = 0;

  constructor(private readonly o: TeamOptions) {}

  /** Signed in, with an org whose view was read. */
  get ready(): boolean { return !!(this.o.enabled() && this.o.token() && this.view); }

  private base() { return this.o.url().trim().replace(/\/+$/, ''); }

  async call<T = any>(method: string, path: string, body?: unknown, signal?: AbortSignal, token = this.o.token()): Promise<T> {
    if (!this.base()) throw new TeamError('no_url');
    let res: Response;
    try {
      res = await this.o.fetch(this.base() + path, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new TeamError('unreachable');
    }
    const json = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok) throw new TeamError(json.error ?? `http_${res.status}`, res.status);
    return json as T;
  }

  /** The org's path, for `call`. */
  orgPath(rest = ''): string {
    const id = this.o.org();
    if (id === null) throw new TeamError('no_org');
    return `/v1/orgs/${id}${rest}`;
  }

  /** Registers or signs in; the token is kept, and the org too when the account is in exactly one. */
  async signIn(a: { username: string; password: string; name?: string; register: boolean }): Promise<void> {
    const r = await this.call<{ token: string; user: Person; orgs: TeamClient['orgs'] }>('POST', a.register ? '/v1/register' : '/v1/login',
      { username: a.username, password: a.password, name: a.name, label: 'Buggie' }, undefined, null);
    this.o.storeToken(r.token);
    this.user = r.user;
    this.orgs = r.orgs;
    const kept = this.orgs.some((x) => x.id === this.o.org());
    if (!kept) this.o.setOrg(this.orgs.length === 1 ? this.orgs[0]!.id : null);
    this.restart();
  }

  async signOut(): Promise<void> {
    await this.call('POST', '/v1/logout').catch(() => {});
    this.o.storeToken(null);
    this.user = null;
    this.orgs = [];
    this.view = null;
    this.restart();
  }

  /** Makes `id` the org read; a new org's view comes with the call that made or joined it. */
  useOrg(id: number | null): void {
    this.o.setOrg(id);
    this.view = null;
    this.restart();
  }

  /** Reads the account and the org again. */
  async refresh(): Promise<void> {
    if (!this.o.token()) { this.user = null; this.orgs = []; this.view = null; return; }
    const me = await this.call<{ user: Person; orgs: TeamClient['orgs'] }>('GET', '/v1/me');
    this.user = me.user;
    this.orgs = me.orgs;
    const id = this.o.org();
    this.view = id !== null && me.orgs.some((x) => x.id === id) ? await this.call<OrgView>('GET', this.orgPath()) : null;
    this.viewAt = Date.now();
  }

  /** Takes an org view an admin call answered with. */
  took(view: OrgView): void {
    if (view.org.id === this.o.org()) { this.view = view; this.viewAt = Date.now(); this.o.onState?.(); }
  }

  start(): void { this.restart(); }

  stop(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
  }

  /** Starts reading again from the current state of the settings. */
  restart(): void {
    this.stop();
    const gen = this.generation;
    void this.loop(gen);
  }

  private async loop(gen: number): Promise<void> {
    const live = () => gen === this.generation;
    let seq: number | null = null;
    while (live()) {
      if (!this.o.enabled() || !this.o.token()) { this.view = null; this.o.onState?.(); return; }
      this.abort = new AbortController();
      try {
        if (!this.view || Date.now() - this.viewAt > VIEW_SECONDS * 1000) await this.refresh();
        if (!live()) return;
        this.problem = null;
        this.o.onState?.();
        if (!this.view) return;
        if (seq === null) { seq = (await this.call<{ seq: number }>('GET', this.orgPath('/changes'), undefined, this.abort.signal)).seq; continue; }
        const read: { seq: number; changes: Change[] } = await this.call('GET', this.orgPath(`/changes?since=${seq}&wait=${WAIT_SECONDS}`), undefined, this.abort.signal);
        if (!live()) return;
        seq = read.seq;
        if (read.changes.some((c) => c.kind === 'sector.member' || c.kind === 'project.member')) await this.refresh();
        for (const c of read.changes) {
          if (c.kind === 'telegram.message') this.o.onTelegram?.({ kind: 'message', text: String(c.text ?? '') });
          else if (c.kind === 'telegram.linked') this.o.onTelegram?.({ kind: 'linked', name: String(c.telegram ?? '') });
        }
        const notices = read.changes.flatMap((c) => this.notice(c) ?? []);
        if (notices.length) this.o.onNotices(notices);
      } catch (e) {
        if (!live()) return;
        const code = e instanceof TeamError ? e.code : String(e);
        // a token the server no longer knows is a sign-out
        if (code === 'unauthorized') { this.o.storeToken(null); this.user = null; this.view = null; this.o.onState?.(); return; }
        if (this.problem !== code) { this.problem = code; this.o.warn?.(code); this.o.onState?.(); }
        await new Promise((r) => setTimeout(r, RETRY_SECONDS * 1000));
      }
    }
  }

  /** What a log entry tells the person, or null when it is not about them. */
  private notice(c: Change): TeamNotice | null {
    const me = this.user?.username;
    if (!me || !c.actor || c.actor.username === me) return null;
    const actor = c.actor.name;
    if ((c.kind === 'sector.member' || c.kind === 'project.member') && c.member?.username === me) {
      return { kind: 'added', actor, to: c.kind === 'sector.member' ? 'sector' : 'project', name: (c.sector ?? c.project)! };
    }
    const t = c.ticket;
    if (!t) return null;
    const mine = t.assignee?.username === me || t.author?.username === me;
    if (c.kind === 'ticket.created') {
      if (t.assignee?.username === me) return { kind: 'assigned', actor, ticket: t };
      const sectors = new Set(this.view?.sectors.filter((s) => s.members.some((m) => m.username === me)).map((s) => s.name));
      return !t.assignee && t.sector && sectors.has(t.sector) ? { kind: 'sector', actor, ticket: t } : null;
    }
    if (c.kind === 'ticket.updated') {
      if (c.fields?.assignee?.to === me) return { kind: 'assigned', actor, ticket: t };
      return mine ? { kind: 'changed', actor, ticket: t, fields: Object.keys(c.fields ?? {}) } : null;
    }
    if (c.kind === 'ticket.comment' && mine) return { kind: 'comment', actor, ticket: t, excerpt: c.excerpt ?? '' };
    return null;
  }
}

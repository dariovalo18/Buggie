/**
 * The team server: accounts, the companies (orgs) they belong to, and each org's work groups (sectors),
 * projects and tickets, over a JSON HTTP API (team-server/README.md lists the routes). Node's built-in
 * SQLite, no dependencies; Node runs this file as it is (type stripping), so it uses no TypeScript-only syntax.
 *
 * - An account is one person, registered once (`/v1/register`); each device signs in for a token of its own.
 * - Registering, signing in and joining by invite code are limited per client address (RATE_MAX in RATE_WINDOW_MS).
 *   Behind a reverse proxy (`trustProxy`) the address is the last `X-Forwarded-For` entry, the one the proxy writes.
 * - The account that creates an org owns it. Owners and admins add members by username or hand out the org's
 *   invite code, and manage the sectors, the projects and who is in each. Every member reads and works the tickets.
 * - Tickets are numbered per project (`PAY-12`). Every change to a ticket and every addition of a person to a
 *   sector or project is written to the org's activity log, which `/changes` hands out by sequence number,
 *   waiting for the next entry when asked to.
 */
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

const MAX_BODY = 256 * 1024;
const NAME_MAX = 80;
const TITLE_MAX = 200;
const TEXT_MAX = 20_000;
const REPOS_MAX = 20;
const LIST_MAX = 200;
const CHANGES_MAX = 100;
/** The longest a `/changes` request waits for a new entry, in seconds. */
export const WAIT_MAX = 30;
/** Failed sign-ins in a row before an account's sign-in is refused for LOCK_MS. */
const LOGIN_FAILS = 10;
const LOCK_MS = 5 * 60_000;
/** Per client address: registrations, sign-ins and invite codes tried in RATE_WINDOW_MS; addresses tracked at once. */
export const RATE_MAX = 30;
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_TRACKED_MAX = 100_000;

export const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const ROLES = ['owner', 'admin', 'member'] as const;
type Role = typeof ROLES[number];

const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const KEY = /^[A-Z][A-Z0-9]{1,9}$/;
const REF = /^([A-Z][A-Z0-9]{1,9})-(\d{1,9})$/;
const PASSWORD_MIN = 8;

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    salt BLOB NOT NULL, hash BLOB NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tokens (
    hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    label TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orgs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, invite TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS org_members (
    org_id INTEGER NOT NULL REFERENCES orgs ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    role TEXT NOT NULL, PRIMARY KEY (org_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS sectors (
    id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs ON DELETE CASCADE, name TEXT NOT NULL,
    UNIQUE (org_id, name)
  );
  CREATE TABLE IF NOT EXISTS sector_members (
    sector_id INTEGER NOT NULL REFERENCES sectors ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    PRIMARY KEY (sector_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs ON DELETE CASCADE, key TEXT NOT NULL, name TEXT NOT NULL,
    repos TEXT NOT NULL DEFAULT '[]', archived INTEGER NOT NULL DEFAULT 0, next_number INTEGER NOT NULL DEFAULT 1,
    UNIQUE (org_id, key)
  );
  CREATE TABLE IF NOT EXISTS project_sectors (
    project_id INTEGER NOT NULL REFERENCES projects ON DELETE CASCADE, sector_id INTEGER NOT NULL REFERENCES sectors ON DELETE CASCADE,
    PRIMARY KEY (project_id, sector_id)
  );
  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL REFERENCES projects ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE,
    PRIMARY KEY (project_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects ON DELETE CASCADE, number INTEGER NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, priority TEXT NOT NULL,
    sector_id INTEGER REFERENCES sectors ON DELETE SET NULL, assignee_id INTEGER REFERENCES users ON DELETE SET NULL,
    author_id INTEGER NOT NULL REFERENCES users, source TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE (project_id, number)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users, body TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL REFERENCES orgs ON DELETE CASCADE,
    at TEXT NOT NULL, actor_id INTEGER NOT NULL REFERENCES users, kind TEXT NOT NULL,
    ticket_id INTEGER REFERENCES tickets ON DELETE CASCADE, data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_by_org ON activity (org_id, seq);
  CREATE INDEX IF NOT EXISTS tickets_by_assignee ON tickets (assignee_id, status);
`;

class HttpError extends Error {
  status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}
const fail = (status: number, code: string): never => { throw new HttpError(status, code); };

type Row = Record<string, unknown>;
type Body = Record<string, unknown>;
type Person = { username: string; name: string };
interface Ctx {
  req: IncomingMessage;
  /** Closes when the client goes away; a waiting `/changes` stops waiting then. */
  res: ServerResponse;
  params: string[];
  query: URLSearchParams;
  body: Body;
  /** The signed-in account; routes marked open run without one and see 0. */
  userId: number;
}
type Handler = (ctx: Ctx) => unknown;

const now = () => new Date().toISOString();
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const scrypt = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, 32, (e, key) => (e ? reject(e) : resolve(key))));

/** A string field: trimmed, at most `max` characters; `undefined` when absent and not `required`. */
function text(v: unknown, max: number, required: boolean, field: string): string | undefined {
  if (v === undefined || v === null) return required ? fail(400, `${field}_required`) : undefined;
  if (typeof v !== 'string') return fail(400, `${field}_invalid`);
  const s = v.trim();
  if (required && !s) return fail(400, `${field}_required`);
  if (s.length > max) return fail(400, `${field}_too_long`);
  return s;
}
const oneOf = <T extends string>(v: unknown, all: readonly T[], field: string): T | undefined =>
  v === undefined ? undefined : (all as readonly unknown[]).includes(v) ? v as T : fail(400, `${field}_invalid`);

export interface HubOptions {
  /** The SQLite file, or `:memory:`. */
  dbFile: string;
  /** Read the client address from `X-Forwarded-For`, as a reverse proxy in front writes it. */
  trustProxy?: boolean;
}

export interface Hub {
  server: Server;
  close(): Promise<void>;
}

export function createHub(o: HubOptions): Hub {
  const db = new DatabaseSync(o.dbFile);
  db.exec(SCHEMA);
  const one = (sql: string, ...args: unknown[]) => db.prepare(sql).get(...args as never[]) as Row | undefined;
  const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args as never[]) as Row[];
  const run = (sql: string, ...args: unknown[]) => db.prepare(sql).run(...args as never[]);
  const tx = <T>(f: () => T): T => {
    db.exec('BEGIN');
    try { const r = f(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  /** Requests waiting in `/changes`, by org; each is woken by the org's next activity entry. */
  const waiting = new Map<number, Set<() => void>>();
  const loginFails = new Map<string, { fails: number; until: number }>();
  const rates = new Map<string, { n: number; since: number }>();

  function clientAddress(req: IncomingMessage): string {
    const forwarded = o.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1)?.trim() : '';
    const ip = forwarded || req.socket.remoteAddress || '';
    // an IPv6 client is counted per /64, the block one subscriber usually has
    return ip.includes(':') && !ip.startsWith('::ffff:') ? ip.split(':').slice(0, 4).join(':') : ip;
  }
  /** Counts one attempt of the client's; refuses past RATE_MAX in the window. */
  function limit(req: IncomingMessage): void {
    const ip = clientAddress(req), at = Date.now();
    const r = rates.get(ip);
    if (!r || at - r.since > RATE_WINDOW_MS) {
      if (!r && rates.size >= RATE_TRACKED_MAX) {
        for (const [k, v] of rates) if (at - v.since > RATE_WINDOW_MS) rates.delete(k);
        if (rates.size >= RATE_TRACKED_MAX) fail(429, 'too_many_attempts');
      }
      rates.set(ip, { n: 1, since: at });
      return;
    }
    if (++r.n > RATE_MAX) fail(429, 'too_many_attempts');
  }

  function log(orgId: number, actorId: number, kind: string, ticketId: number | null, data: object): void {
    run('INSERT INTO activity (org_id, at, actor_id, kind, ticket_id, data) VALUES (?, ?, ?, ?, ?, ?)', orgId, now(), actorId, kind, ticketId, JSON.stringify(data));
    const wake = waiting.get(orgId);
    if (wake) { waiting.delete(orgId); for (const w of wake) w(); }
  }

  // ---------- accounts ----------

  async function issueToken(userId: number, label: string) {
    const token = `bgt_${randomBytes(24).toString('base64url')}`;
    run('INSERT INTO tokens (hash, user_id, label, created_at) VALUES (?, ?, ?, ?)', sha256(token), userId, label, now());
    return token;
  }
  const person = (id: unknown): Person | null => {
    if (id === null || id === undefined) return null;
    const u = one('SELECT username, name FROM users WHERE id = ?', id);
    return u ? { username: u.username as string, name: u.name as string } : null;
  };
  const userByName = (username: unknown) => {
    const u = typeof username === 'string' ? one('SELECT id FROM users WHERE username = ?', username.trim().toLowerCase()) : undefined;
    return u ? u.id as number : fail(404, 'user_not_found');
  };
  const credentials = (b: Body) => {
    const username = text(b.username, 32, true, 'username')!.toLowerCase();
    if (!USERNAME.test(username)) fail(400, 'username_invalid');
    if (typeof b.password !== 'string' || b.password.length < PASSWORD_MIN || b.password.length > 200) fail(400, 'password_invalid');
    return { username, password: b.password as string, label: text(b.label, NAME_MAX, false, 'label') || 'Buggie' };
  };
  const profile = (userId: number) => ({
    user: person(userId),
    orgs: all('SELECT o.id, o.name, m.role FROM org_members m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY o.name', userId),
  });

  async function register(c: Ctx) {
    limit(c.req);
    const { username, password, label } = credentials(c.body);
    const name = text(c.body.name, NAME_MAX, false, 'name') || username;
    if (one('SELECT 1 FROM users WHERE username = ?', username)) fail(409, 'username_taken');
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt);
    const id = Number(run('INSERT INTO users (username, name, salt, hash, created_at) VALUES (?, ?, ?, ?, ?)', username, name, salt, hash, now()).lastInsertRowid);
    return { token: await issueToken(id, label), ...profile(id) };
  }

  async function login(c: Ctx) {
    limit(c.req);
    const { username, password, label } = credentials(c.body);
    const lock = loginFails.get(username);
    if (lock && lock.until > Date.now()) fail(429, 'too_many_attempts');
    const u = one('SELECT id, salt, hash FROM users WHERE username = ?', username);
    const hash = await scrypt(password, u ? Buffer.from(u.salt as Uint8Array) : randomBytes(16));
    if (!u || !timingSafeEqual(hash, Buffer.from(u.hash as Uint8Array))) {
      const fails = (lock && lock.until <= Date.now() && lock.until ? 0 : lock?.fails ?? 0) + 1;
      loginFails.set(username, { fails, until: fails >= LOGIN_FAILS ? Date.now() + LOCK_MS : 0 });
      return fail(401, 'bad_credentials');
    }
    loginFails.delete(username);
    return { token: await issueToken(u.id as number, label), ...profile(u.id as number) };
  }

  /** A new password ends every other token of the account. */
  async function changePassword(c: Ctx) {
    limit(c.req);
    const u = one('SELECT salt, hash FROM users WHERE id = ?', c.userId)!;
    if (typeof c.body.current !== 'string' || !timingSafeEqual(await scrypt(c.body.current, Buffer.from(u.salt as Uint8Array)), Buffer.from(u.hash as Uint8Array))) fail(401, 'bad_credentials');
    const next = c.body.password;
    if (typeof next !== 'string' || next.length < PASSWORD_MIN || next.length > 200) fail(400, 'password_invalid');
    const salt = randomBytes(16);
    const hash = await scrypt(next as string, salt);
    tx(() => {
      run('UPDATE users SET salt = ?, hash = ? WHERE id = ?', salt, hash, c.userId);
      run('DELETE FROM tokens WHERE user_id = ? AND hash != ?', c.userId, sha256(bearer(c.req)!));
    });
    return { ok: true };
  }

  function updateMe(c: Ctx) {
    const name = text(c.body.name, NAME_MAX, false, 'name');
    if (name) run('UPDATE users SET name = ? WHERE id = ?', name, c.userId);
    return profile(c.userId);
  }

  // ---------- orgs, sectors, projects ----------

  function roleIn(orgId: number, userId: number): Role {
    const m = one('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?', orgId, userId);
    return m ? m.role as Role : fail(404, 'org_not_found');
  }
  const orgOf = (c: Ctx) => { const id = Number(c.params[0]); roleIn(id, c.userId); return id; };
  const adminOrg = (c: Ctx) => {
    const id = Number(c.params[0]);
    if (roleIn(id, c.userId) === 'member') fail(403, 'admin_only');
    return id;
  };
  const memberId = (orgId: number, username: unknown) => {
    const id = userByName(username);
    if (!one('SELECT 1 FROM org_members WHERE org_id = ? AND user_id = ?', orgId, id)) fail(404, 'member_not_found');
    return id;
  };
  /** A sector of the org by id or name. */
  const sectorId = (orgId: number, v: unknown) => {
    const s = typeof v === 'number' ? one('SELECT id FROM sectors WHERE org_id = ? AND id = ?', orgId, v)
      : typeof v === 'string' ? one('SELECT id FROM sectors WHERE org_id = ? AND name = ?', orgId, v.trim()) : undefined;
    return s ? s.id as number : fail(404, 'sector_not_found');
  };
  const projectRow = (orgId: number, key: unknown) => {
    const p = typeof key === 'string' ? one('SELECT * FROM projects WHERE org_id = ? AND key = ?', orgId, key.trim().toUpperCase()) : undefined;
    return p ?? fail(404, 'project_not_found');
  };
  const people = (sql: string, id: unknown) => all(`SELECT u.username, u.name FROM users u JOIN ${sql} ORDER BY u.username`, id) as Person[];

  function orgView(orgId: number, userId: number) {
    const o = one('SELECT id, name, invite FROM orgs WHERE id = ?', orgId)!;
    const role = roleIn(orgId, userId);
    return {
      org: { id: o.id, name: o.name, role, ...(role === 'member' ? {} : { invite: o.invite }) },
      members: all('SELECT u.username, u.name, m.role FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.username', orgId),
      sectors: all('SELECT id, name FROM sectors WHERE org_id = ? ORDER BY name', orgId).map((s) => ({
        ...s, members: people('sector_members x ON x.user_id = u.id WHERE x.sector_id = ?', s.id),
      })),
      projects: all('SELECT id, key, name, repos, archived FROM projects WHERE org_id = ? ORDER BY key', orgId).map((p) => ({
        key: p.key, name: p.name, repos: JSON.parse(p.repos as string), archived: !!p.archived,
        sectors: all('SELECT s.name FROM project_sectors x JOIN sectors s ON s.id = x.sector_id WHERE x.project_id = ? ORDER BY s.name', p.id).map((s) => s.name),
        members: people('project_members x ON x.user_id = u.id WHERE x.project_id = ?', p.id),
      })),
    };
  }

  const invite = () => randomBytes(9).toString('base64url');

  function createOrg(c: Ctx) {
    const name = text(c.body.name, NAME_MAX, true, 'name')!;
    const id = tx(() => {
      const id = Number(run('INSERT INTO orgs (name, invite, created_at) VALUES (?, ?, ?)', name, invite(), now()).lastInsertRowid);
      run('INSERT INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)', id, c.userId, 'owner');
      return id;
    });
    return orgView(id, c.userId);
  }

  function joinOrg(c: Ctx) {
    limit(c.req);
    const code = text(c.body.invite, 40, true, 'invite');
    const o = one('SELECT id FROM orgs WHERE invite = ?', code) ?? fail(404, 'invite_not_found');
    run('INSERT OR IGNORE INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)', o.id, c.userId, 'member');
    return orgView(o.id as number, c.userId);
  }

  function addMember(c: Ctx) {
    const orgId = adminOrg(c);
    const id = userByName(c.body.username);
    const role = oneOf(c.body.role, ROLES, 'role') ?? 'member';
    if (role === 'owner' && roleIn(orgId, c.userId) !== 'owner') fail(403, 'owner_only');
    run('INSERT OR IGNORE INTO org_members (org_id, user_id, role) VALUES (?, ?, ?)', orgId, id, role);
    return orgView(orgId, c.userId);
  }

  /** An org always keeps an owner; only an owner makes or unmakes one. */
  function guardOwner(orgId: number, actor: number, target: number) {
    if (roleIn(orgId, target) !== 'owner') return;
    if (roleIn(orgId, actor) !== 'owner') fail(403, 'owner_only');
    if ((one("SELECT COUNT(*) AS n FROM org_members WHERE org_id = ? AND role = 'owner'", orgId)!.n as number) < 2) fail(409, 'last_owner');
  }

  function setRole(c: Ctx) {
    const orgId = adminOrg(c);
    const id = memberId(orgId, c.params[1]);
    const role = oneOf(c.body.role, ROLES, 'role') ?? fail(400, 'role_required');
    if (role === 'owner' && roleIn(orgId, c.userId) !== 'owner') fail(403, 'owner_only');
    if (role !== 'owner') guardOwner(orgId, c.userId, id);
    run('UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?', role, orgId, id);
    return orgView(orgId, c.userId);
  }

  function removeMember(c: Ctx) {
    const orgId = Number(c.params[0]);
    const id = memberId(orgId, c.params[1]);
    // a member may leave; removing someone else takes an admin
    if (id !== c.userId) adminOrg(c);
    guardOwner(orgId, c.userId, id);
    tx(() => {
      run('DELETE FROM sector_members WHERE user_id = ? AND sector_id IN (SELECT id FROM sectors WHERE org_id = ?)', id, orgId);
      run('DELETE FROM project_members WHERE user_id = ? AND project_id IN (SELECT id FROM projects WHERE org_id = ?)', id, orgId);
      run('DELETE FROM org_members WHERE org_id = ? AND user_id = ?', orgId, id);
    });
    return id === c.userId ? profile(c.userId) : orgView(orgId, c.userId);
  }

  /** An owner deletes the org with everything in it. */
  function deleteOrg(c: Ctx) {
    const id = Number(c.params[0]);
    if (roleIn(id, c.userId) !== 'owner') fail(403, 'owner_only');
    if (c.body.name !== one('SELECT name FROM orgs WHERE id = ?', id)!.name) fail(400, 'name_mismatch');
    run('DELETE FROM orgs WHERE id = ?', id);
    return profile(c.userId);
  }

  function newInvite(c: Ctx) {
    const orgId = adminOrg(c);
    run('UPDATE orgs SET invite = ? WHERE id = ?', invite(), orgId);
    return orgView(orgId, c.userId);
  }

  function createSector(c: Ctx) {
    const orgId = adminOrg(c);
    const name = text(c.body.name, NAME_MAX, true, 'name');
    if (one('SELECT 1 FROM sectors WHERE org_id = ? AND name = ?', orgId, name)) fail(409, 'sector_exists');
    run('INSERT INTO sectors (org_id, name) VALUES (?, ?)', orgId, name);
    return orgView(orgId, c.userId);
  }

  function updateSector(c: Ctx) {
    const orgId = adminOrg(c);
    const id = sectorId(orgId, Number(c.params[1]));
    const name = text(c.body.name, NAME_MAX, true, 'name');
    if (one('SELECT 1 FROM sectors WHERE org_id = ? AND name = ? AND id != ?', orgId, name, id)) fail(409, 'sector_exists');
    run('UPDATE sectors SET name = ? WHERE id = ?', name, id);
    return orgView(orgId, c.userId);
  }

  function deleteSector(c: Ctx) {
    const orgId = adminOrg(c);
    run('DELETE FROM sectors WHERE id = ?', sectorId(orgId, Number(c.params[1])));
    return orgView(orgId, c.userId);
  }

  function sectorMember(add: boolean) {
    return (c: Ctx) => {
      const orgId = adminOrg(c);
      const sector = sectorId(orgId, Number(c.params[1]));
      const id = memberId(orgId, c.params[2]);
      if (add) {
        if (run('INSERT OR IGNORE INTO sector_members (sector_id, user_id) VALUES (?, ?)', sector, id).changes) {
          log(orgId, c.userId, 'sector.member', null, { sector: one('SELECT name FROM sectors WHERE id = ?', sector)!.name, member: person(id) });
        }
      } else run('DELETE FROM sector_members WHERE sector_id = ? AND user_id = ?', sector, id);
      return orgView(orgId, c.userId);
    };
  }

  const repos = (v: unknown) => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.length > REPOS_MAX) return fail(400, 'repos_invalid');
    return [...new Set(v.map((r) => text(r, 200, true, 'repos')!))];
  };
  const setProjectSectors = (orgId: number, projectId: number, v: unknown) => {
    if (v === undefined) return;
    if (!Array.isArray(v)) fail(400, 'sectors_invalid');
    const ids = (v as unknown[]).map((s) => sectorId(orgId, s));
    run('DELETE FROM project_sectors WHERE project_id = ?', projectId);
    for (const s of new Set(ids)) run('INSERT INTO project_sectors (project_id, sector_id) VALUES (?, ?)', projectId, s);
  };

  function createProject(c: Ctx) {
    const orgId = adminOrg(c);
    const key = text(c.body.key, 10, true, 'key')!.toUpperCase();
    if (!KEY.test(key)) fail(400, 'key_invalid');
    const name = text(c.body.name, NAME_MAX, true, 'name');
    if (one('SELECT 1 FROM projects WHERE org_id = ? AND key = ?', orgId, key)) fail(409, 'project_exists');
    tx(() => {
      const id = Number(run('INSERT INTO projects (org_id, key, name, repos) VALUES (?, ?, ?, ?)', orgId, key, name, JSON.stringify(repos(c.body.repos) ?? [])).lastInsertRowid);
      setProjectSectors(orgId, id, c.body.sectors);
    });
    return orgView(orgId, c.userId);
  }

  function updateProject(c: Ctx) {
    const orgId = adminOrg(c);
    const p = projectRow(orgId, c.params[1]);
    const name = text(c.body.name, NAME_MAX, false, 'name');
    const r = repos(c.body.repos);
    tx(() => {
      if (name) run('UPDATE projects SET name = ? WHERE id = ?', name, p.id);
      if (r) run('UPDATE projects SET repos = ? WHERE id = ?', JSON.stringify(r), p.id);
      if (typeof c.body.archived === 'boolean') run('UPDATE projects SET archived = ? WHERE id = ?', c.body.archived ? 1 : 0, p.id);
      setProjectSectors(orgId, p.id as number, c.body.sectors);
    });
    return orgView(orgId, c.userId);
  }

  function projectMember(add: boolean) {
    return (c: Ctx) => {
      const orgId = adminOrg(c);
      const p = projectRow(orgId, c.params[1]);
      const id = memberId(orgId, c.params[2]);
      if (add) {
        if (run('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)', p.id, id).changes) {
          log(orgId, c.userId, 'project.member', null, { project: p.key, member: person(id) });
        }
      } else run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', p.id, id);
      return orgView(orgId, c.userId);
    };
  }

  // ---------- tickets ----------

  const TICKET_SELECT = `
    SELECT t.*, p.key AS project_key, s.name AS sector_name FROM tickets t
    JOIN projects p ON p.id = t.project_id LEFT JOIN sectors s ON s.id = t.sector_id`;

  const summary = (t: Row) => ({
    ref: `${t.project_key}-${t.number}`, project: t.project_key, title: t.title, status: t.status, priority: t.priority,
    sector: t.sector_name ?? null, assignee: person(t.assignee_id), author: person(t.author_id),
    createdAt: t.created_at, updatedAt: t.updated_at,
  });
  const ticketRow = (orgId: number, ref: unknown) => {
    const m = typeof ref === 'string' ? REF.exec(ref.trim().toUpperCase()) : null;
    const t = m ? one(`${TICKET_SELECT} WHERE p.org_id = ? AND p.key = ? AND t.number = ?`, orgId, m[1], Number(m[2])) : undefined;
    return t ?? fail(404, 'ticket_not_found');
  };
  const full = (t: Row) => ({
    ...summary(t), body: t.body, source: t.source ? JSON.parse(t.source as string) : null,
    comments: all('SELECT author_id, body, created_at FROM comments WHERE ticket_id = ? ORDER BY id', t.id)
      .map((k) => ({ author: person(k.author_id), body: k.body, createdAt: k.created_at })),
  });
  /** Where a ticket came from (a failing run, a file and line), as the client sends it; kept as given, size-capped. */
  const source = (v: unknown) => {
    if (v === undefined || v === null) return null;
    const s = JSON.stringify(v);
    return typeof v === 'object' && s.length <= 8_000 ? s : fail(400, 'source_invalid');
  };
  const assignee = (orgId: number, v: unknown) => (v === null || v === '' ? null : memberId(orgId, v));

  function listTickets(c: Ctx) {
    const orgId = orgOf(c);
    const where = ['p.org_id = ?'];
    const args: unknown[] = [orgId];
    const q = c.query;
    if (q.get('project')) { where.push('p.key = ?'); args.push(q.get('project')!.toUpperCase()); }
    if (q.get('sector')) { where.push('s.name = ?'); args.push(q.get('sector')); }
    const statuses = (q.get('status') ?? 'active').split(',').flatMap((s) => (s === 'active' ? ['open', 'in_progress'] : s === 'all' ? [...STATUSES] : [s]));
    where.push(`t.status IN (${statuses.map(() => '?').join(',')})`);
    args.push(...statuses);
    const who = q.get('assignee');
    if (who === 'none') where.push('t.assignee_id IS NULL');
    else if (who) { where.push('t.assignee_id = ?'); args.push(who === 'me' ? c.userId : userByName(who)); }
    const text = q.get('q');
    if (text) { where.push('(t.title LIKE ? OR t.body LIKE ?)'); args.push(`%${text}%`, `%${text}%`); }
    const limit = Math.min(Math.max(Number(q.get('limit')) || 50, 1), LIST_MAX);
    const rows = all(`${TICKET_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC LIMIT ${limit}`, ...args);
    return { tickets: rows.map(summary) };
  }

  function createTicket(c: Ctx) {
    const orgId = orgOf(c);
    const b = c.body;
    const p = projectRow(orgId, b.project);
    if (p.archived) fail(409, 'project_archived');
    const title = text(b.title, TITLE_MAX, true, 'title');
    const body = text(b.body, TEXT_MAX, false, 'body') ?? '';
    const priority = oneOf(b.priority, PRIORITIES, 'priority') ?? 'normal';
    const sector = b.sector === undefined || b.sector === null ? null : sectorId(orgId, b.sector);
    const who = b.assignee === undefined ? null : assignee(orgId, b.assignee);
    const src = source(b.source);
    const ref = tx(() => {
      const number = one('SELECT next_number FROM projects WHERE id = ?', p.id)!.next_number as number;
      run('UPDATE projects SET next_number = ? WHERE id = ?', number + 1, p.id);
      const at = now();
      const id = Number(run(`INSERT INTO tickets (project_id, number, title, body, status, priority, sector_id, assignee_id, author_id, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`, p.id, number, title, body, priority, sector, who, c.userId, src, at, at).lastInsertRowid);
      log(orgId, c.userId, 'ticket.created', id, {});
      return `${p.key}-${number}`;
    });
    return full(ticketRow(orgId, ref));
  }

  function updateTicket(c: Ctx) {
    const orgId = orgOf(c);
    const t = ticketRow(orgId, c.params[1]);
    const b = c.body;
    const next: Row = {};
    const title = text(b.title, TITLE_MAX, false, 'title');
    if (title) next.title = title;
    const body = text(b.body, TEXT_MAX, false, 'body');
    if (body !== undefined) next.body = body;
    const status = oneOf(b.status, STATUSES, 'status');
    if (status) next.status = status;
    const priority = oneOf(b.priority, PRIORITIES, 'priority');
    if (priority) next.priority = priority;
    if (b.sector !== undefined) next.sector_id = b.sector === null || b.sector === '' ? null : sectorId(orgId, b.sector);
    if (b.assignee !== undefined) next.assignee_id = assignee(orgId, b.assignee);
    const changed = Object.keys(next).filter((k) => next[k] !== t[k]);
    if (!changed.length) return full(t);
    tx(() => {
      run(`UPDATE tickets SET ${changed.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...changed.map((k) => next[k]), now(), t.id);
      const shown = (k: string, v: unknown) => (k === 'assignee_id' ? person(v)?.username ?? null : k === 'sector_id' ? (v === null ? null : one('SELECT name FROM sectors WHERE id = ?', v)?.name) : k === 'body' ? undefined : v);
      const fields = Object.fromEntries(changed.map((k) => [k.replace(/_id$/, ''), { from: shown(k, t[k]), to: shown(k, next[k]) }]));
      log(orgId, c.userId, 'ticket.updated', t.id as number, { fields });
    });
    return full(ticketRow(orgId, c.params[1]));
  }

  function comment(c: Ctx) {
    const orgId = orgOf(c);
    const t = ticketRow(orgId, c.params[1]);
    const body = text(c.body.body, TEXT_MAX, true, 'body')!;
    tx(() => {
      const at = now();
      run('INSERT INTO comments (ticket_id, author_id, body, created_at) VALUES (?, ?, ?, ?)', t.id, c.userId, body, at);
      run('UPDATE tickets SET updated_at = ? WHERE id = ?', at, t.id);
      log(orgId, c.userId, 'ticket.comment', t.id as number, { excerpt: body.slice(0, 300) });
    });
    return full(ticketRow(orgId, c.params[1]));
  }

  async function changes(c: Ctx) {
    const orgId = orgOf(c);
    const last = () => (one('SELECT MAX(seq) AS seq FROM activity WHERE org_id = ?', orgId)!.seq as number | null) ?? 0;
    if (!c.query.has('since')) return { seq: last(), changes: [] };
    const since = Number(c.query.get('since')) || 0;
    const read = () => all('SELECT * FROM activity WHERE org_id = ? AND seq > ? ORDER BY seq LIMIT ?', orgId, since, CHANGES_MAX);
    let rows = read();
    const wait = Math.min(Math.max(Number(c.query.get('wait')) || 0, 0), WAIT_MAX);
    if (!rows.length && wait) {
      await new Promise<void>((resolve) => {
        const set = waiting.get(orgId) ?? new Set();
        waiting.set(orgId, set);
        const done = () => { clearTimeout(timer); set.delete(done); c.res.off('close', done); resolve(); };
        const timer = setTimeout(done, wait * 1000);
        set.add(done);
        c.res.on('close', done);
      });
      rows = read();
    }
    return {
      seq: rows.length ? rows.at(-1)!.seq : Math.max(since, 0),
      changes: rows.map((r) => {
        const t = r.ticket_id === null ? undefined : one(`${TICKET_SELECT} WHERE t.id = ?`, r.ticket_id);
        return { seq: r.seq, at: r.at, kind: r.kind, actor: person(r.actor_id), ...(t ? { ticket: summary(t) } : {}), ...JSON.parse(r.data as string) };
      }),
    };
  }

  // ---------- routing ----------

  const ID = '(\\d+)';
  const NAME = '([^/]+)';
  const routes: Array<[string, RegExp, Handler, boolean?]> = [
    ['GET', /^\/v1\/health$/, () => ({ ok: true }), true],
    ['POST', /^\/v1\/register$/, register, true],
    ['POST', /^\/v1\/login$/, login, true],
    ['POST', /^\/v1\/logout$/, (c) => { run('DELETE FROM tokens WHERE hash = ?', sha256(bearer(c.req)!)); return { ok: true }; }],
    ['GET', /^\/v1\/me$/, (c) => profile(c.userId)],
    ['PATCH', /^\/v1\/me$/, updateMe],
    ['POST', /^\/v1\/me\/password$/, changePassword],
    ['POST', /^\/v1\/orgs$/, createOrg],
    ['POST', /^\/v1\/orgs\/join$/, joinOrg],
    ['GET', new RegExp(`^/v1/orgs/${ID}$`), (c) => orgView(orgOf(c), c.userId)],
    ['DELETE', new RegExp(`^/v1/orgs/${ID}$`), deleteOrg],
    ['POST', new RegExp(`^/v1/orgs/${ID}/invite$`), newInvite],
    ['POST', new RegExp(`^/v1/orgs/${ID}/members$`), addMember],
    ['PATCH', new RegExp(`^/v1/orgs/${ID}/members/${NAME}$`), setRole],
    ['DELETE', new RegExp(`^/v1/orgs/${ID}/members/${NAME}$`), removeMember],
    ['POST', new RegExp(`^/v1/orgs/${ID}/sectors$`), createSector],
    ['PATCH', new RegExp(`^/v1/orgs/${ID}/sectors/${ID}$`), updateSector],
    ['DELETE', new RegExp(`^/v1/orgs/${ID}/sectors/${ID}$`), deleteSector],
    ['PUT', new RegExp(`^/v1/orgs/${ID}/sectors/${ID}/members/${NAME}$`), sectorMember(true)],
    ['DELETE', new RegExp(`^/v1/orgs/${ID}/sectors/${ID}/members/${NAME}$`), sectorMember(false)],
    ['POST', new RegExp(`^/v1/orgs/${ID}/projects$`), createProject],
    ['PATCH', new RegExp(`^/v1/orgs/${ID}/projects/${NAME}$`), updateProject],
    ['PUT', new RegExp(`^/v1/orgs/${ID}/projects/${NAME}/members/${NAME}$`), projectMember(true)],
    ['DELETE', new RegExp(`^/v1/orgs/${ID}/projects/${NAME}/members/${NAME}$`), projectMember(false)],
    ['GET', new RegExp(`^/v1/orgs/${ID}/tickets$`), listTickets],
    ['POST', new RegExp(`^/v1/orgs/${ID}/tickets$`), createTicket],
    ['GET', new RegExp(`^/v1/orgs/${ID}/tickets/${NAME}$`), (c) => full(ticketRow(orgOf(c), c.params[1]))],
    ['PATCH', new RegExp(`^/v1/orgs/${ID}/tickets/${NAME}$`), updateTicket],
    ['POST', new RegExp(`^/v1/orgs/${ID}/tickets/${NAME}/comments$`), comment],
    ['GET', new RegExp(`^/v1/orgs/${ID}/changes$`), changes],
  ];

  function bearer(req: IncomingMessage) {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    return m ? m[1] : null;
  }
  const signedIn = (req: IncomingMessage) => {
    const token = bearer(req);
    const row = token ? one('SELECT user_id FROM tokens WHERE hash = ?', sha256(token)) : undefined;
    return row ? row.user_id as number : fail(401, 'unauthorized');
  };

  async function readBody(req: IncomingMessage): Promise<Body> {
    if (req.method === 'GET') return {};
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BODY) fail(413, 'too_large');
      chunks.push(chunk);
    }
    if (!size) return {};
    let v: unknown;
    try { v = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail(400, 'bad_json'); }
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Body : fail(400, 'bad_json');
  }

  function send(res: ServerResponse, status: number, value: unknown) {
    if (res.writableEnded) return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  }

  const server = createServer(async (req, res) => {
    // tokens travel in the Authorization header, never in cookies, so any page may call the API
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    const url = new URL(req.url ?? '/', 'http://hub');
    try {
      let found: { handler: Handler; params: string[]; open?: boolean } | null = null;
      let pathMatched = false;
      for (const [method, re, handler, open] of routes) {
        const m = re.exec(url.pathname);
        if (!m) continue;
        pathMatched = true;
        if (method === req.method) { found = { handler, params: m.slice(1).map(decodeURIComponent), open }; break; }
      }
      if (!found) fail(pathMatched ? 405 : 404, pathMatched ? 'method_not_allowed' : 'not_found');
      const userId = found!.open ? 0 : signedIn(req);
      const body = await readBody(req);
      send(res, 200, await found!.handler({ req, res, params: found!.params, query: url.searchParams, body, userId }));
    } catch (e) {
      if (e instanceof HttpError) send(res, e.status, { error: e.message });
      else { console.error(e); send(res, 500, { error: 'internal' }); }
    }
  });

  return {
    server,
    close: () => new Promise((resolve) => {
      for (const set of waiting.values()) for (const w of set) w();
      server.closeAllConnections();
      server.close(() => { db.close(); resolve(); });
    }),
  };
}

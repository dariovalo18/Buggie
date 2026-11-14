import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createHub, RATE_MAX, type Hub } from '../team-server/hub.ts';

const hubs: Hub[] = [];
afterEach(async () => { for (const h of hubs.splice(0)) await h.close(); });

async function started() {
  const hub = createHub({ dbFile: ':memory:' });
  hubs.push(hub);
  await new Promise<void>((resolve) => hub.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
  const call = async (token: string | null, method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() as any };
  };
  const register = async (username: string, name = username) => {
    const r = await call(null, 'POST', '/v1/register', { username, name, password: 'correct horse' });
    expect(r.status).toBe(200);
    const token = r.json.token as string;
    return { token, as: (method: string, path: string, body?: unknown) => call(token, method, path, body) };
  };
  return { call, register };
}

/** An org owned by ana with bruno in it, a Backend sector and a PAY project. */
async function team() {
  const t = await started();
  const ana = await t.register('ana', 'Ana');
  const bruno = await t.register('bruno', 'Bruno');
  const org = (await ana.as('POST', '/v1/orgs', { name: 'Acme' })).json.org;
  const o = `/v1/orgs/${org.id}`;
  await ana.as('POST', `${o}/members`, { username: 'bruno' });
  await ana.as('POST', `${o}/sectors`, { name: 'Backend' });
  await ana.as('POST', `${o}/projects`, { key: 'pay', name: 'Payments', repos: ['acme/pay'], sectors: ['Backend'] });
  return { ...t, ana, bruno, o, org };
}

describe('team server accounts', () => {
  it('registers a username once, signs in again with its password and refuses a wrong one', async () => {
    const { call, register } = await started();
    await register('Ana.Dev');
    expect((await call(null, 'POST', '/v1/register', { username: 'ana.dev', password: 'another one' })).json).toEqual({ error: 'username_taken' });
    const ok = await call(null, 'POST', '/v1/login', { username: 'ANA.DEV', password: 'correct horse' });
    expect(ok.json.user).toEqual({ username: 'ana.dev', name: 'Ana.Dev' });
    expect((await call(ok.json.token, 'GET', '/v1/me')).status).toBe(200);
    expect((await call(null, 'POST', '/v1/login', { username: 'ana.dev', password: 'wrong password' })).status).toBe(401);
    expect((await call('bgt_nope', 'GET', '/v1/me')).status).toBe(401);
  });

  it('a new password ends the other tokens of the account and keeps the one that changed it', async () => {
    const { call, register } = await started();
    const ana = await register('ana');
    const other = (await call(null, 'POST', '/v1/login', { username: 'ana', password: 'correct horse' })).json.token;
    expect((await ana.as('POST', '/v1/me/password', { current: 'wrong', password: 'battery staple' })).status).toBe(401);
    expect((await ana.as('POST', '/v1/me/password', { current: 'correct horse', password: 'battery staple' })).status).toBe(200);
    expect((await call(other, 'GET', '/v1/me')).status).toBe(401);
    expect((await ana.as('GET', '/v1/me')).status).toBe(200);
    expect((await call(null, 'POST', '/v1/login', { username: 'ana', password: 'battery staple' })).status).toBe(200);
  });

  it('refuses a client address past RATE_MAX attempts in the window', async () => {
    const { call } = await started();
    const tries = await Promise.all(Array.from({ length: RATE_MAX + 1 }, (_, i) => call(null, 'POST', '/v1/login', { username: `nobody${i}`, password: 'whatever1' })));
    expect(tries.filter((r) => r.status === 429)).toHaveLength(1);
  });

  it('a signed-out token stops working', async () => {
    const { register } = await started();
    const ana = await register('ana');
    await ana.as('POST', '/v1/logout');
    expect((await ana.as('GET', '/v1/me')).status).toBe(401);
  });
});

describe('team server orgs', () => {
  it('puts one account in an org by invite code or by username, and in its sectors and projects', async () => {
    const { ana, register, o, org } = await team();
    const carla = await register('carla');
    expect((await carla.as('GET', o)).status).toBe(404);
    const invite = (await ana.as('GET', o)).json.org.invite as string;
    expect((await carla.as('POST', '/v1/orgs/join', { invite })).json.org).toEqual({ id: org.id, name: 'Acme', role: 'member' });
    const sector = (await ana.as('GET', o)).json.sectors[0].id;
    await ana.as('PUT', `${o}/sectors/${sector}/members/carla`);
    const view = (await ana.as('PUT', `${o}/projects/PAY/members/carla`)).json;
    expect(view.members.map((m: any) => [m.username, m.role])).toEqual([['ana', 'owner'], ['bruno', 'member'], ['carla', 'member']]);
    expect(view.sectors).toMatchObject([{ name: 'Backend', members: [{ username: 'carla' }] }]);
    expect(view.projects).toMatchObject([{ key: 'PAY', repos: ['acme/pay'], sectors: ['Backend'], members: [{ username: 'carla' }] }]);
    expect((await carla.as('GET', '/v1/me')).json.orgs).toEqual([{ id: org.id, name: 'Acme', role: 'member' }]);
  });

  it('leaves managing the org to owners and admins, hides the invite from members and keeps an owner', async () => {
    const { ana, bruno, o } = await team();
    expect((await bruno.as('GET', o)).json.org.invite).toBeUndefined();
    expect((await bruno.as('POST', `${o}/sectors`, { name: 'QA' })).status).toBe(403);
    await ana.as('PATCH', `${o}/members/bruno`, { role: 'admin' });
    expect((await bruno.as('POST', `${o}/sectors`, { name: 'QA' })).status).toBe(200);
    expect((await bruno.as('PATCH', `${o}/members/ana`, { role: 'member' })).json).toEqual({ error: 'owner_only' });
    expect((await ana.as('DELETE', `${o}/members/ana`)).json).toEqual({ error: 'last_owner' });
    await bruno.as('DELETE', `${o}/members/bruno`);
    expect((await bruno.as('GET', o)).status).toBe(404);
  });

  it('lets only an owner delete an org, naming it, and takes its tickets with it', async () => {
    const { ana, bruno, o } = await team();
    await ana.as('POST', `${o}/tickets`, { project: 'PAY', title: 'x' });
    expect((await bruno.as('DELETE', o, { name: 'Acme' })).json).toEqual({ error: 'owner_only' });
    expect((await ana.as('DELETE', o, { name: 'acme' })).json).toEqual({ error: 'name_mismatch' });
    expect((await ana.as('DELETE', o, { name: 'Acme' })).json.orgs).toEqual([]);
    expect((await bruno.as('GET', `${o}/tickets`)).status).toBe(404);
  });
});

describe('team server tickets', () => {
  it('numbers tickets per project and filters them by status, sector and assignee', async () => {
    const { ana, o } = await team();
    await ana.as('POST', `${o}/projects`, { key: 'WEB', name: 'Web' });
    const first = (await ana.as('POST', `${o}/tickets`, { project: 'PAY', title: 'Refund fails', sector: 'Backend', assignee: 'bruno', priority: 'high', source: { file: 'src/refund.ts', line: 12 } })).json;
    expect(first).toMatchObject({ ref: 'PAY-1', status: 'open', priority: 'high', sector: 'Backend', assignee: { username: 'bruno' }, author: { username: 'ana' }, source: { file: 'src/refund.ts', line: 12 } });
    expect((await ana.as('POST', `${o}/tickets`, { project: 'web', title: 'Logo' })).json.ref).toBe('WEB-1');
    expect((await ana.as('POST', `${o}/tickets`, { project: 'PAY', title: 'Slow list' })).json.ref).toBe('PAY-2');
    await ana.as('PATCH', `${o}/tickets/pay-2`, { status: 'closed' });
    const refs = async (q: string) => (await ana.as('GET', `${o}/tickets${q}`)).json.tickets.map((t: any) => t.ref).sort();
    expect(await refs('')).toEqual(['PAY-1', 'WEB-1']);
    expect(await refs('?status=all&project=PAY')).toEqual(['PAY-1', 'PAY-2']);
    expect(await refs('?sector=Backend')).toEqual(['PAY-1']);
    expect(await refs('?assignee=bruno')).toEqual(['PAY-1']);
    expect(await refs('?assignee=none&q=log')).toEqual(['WEB-1']);
    expect((await ana.as('POST', `${o}/tickets`, { project: 'PAY', title: 'x', assignee: 'nobody' })).json).toEqual({ error: 'user_not_found' });
  });

  it('hands out each change once by sequence and wakes a waiting reader on the next one', async () => {
    const { ana, bruno, o } = await team();
    const start = (await bruno.as('GET', `${o}/changes`)).json.seq as number;
    const waiting = bruno.as('GET', `${o}/changes?since=${start}&wait=10`);
    await new Promise((r) => setTimeout(r, 100));
    await ana.as('POST', `${o}/tickets`, { project: 'PAY', title: 'Refund fails', assignee: 'bruno' });
    const got = (await waiting).json;
    expect(got.changes).toMatchObject([{ kind: 'ticket.created', actor: { username: 'ana' }, ticket: { ref: 'PAY-1', assignee: { username: 'bruno' } } }]);
    await bruno.as('PATCH', `${o}/tickets/PAY-1`, { status: 'in_progress' });
    await bruno.as('POST', `${o}/tickets/PAY-1/comments`, { body: 'Looking into it' });
    const next = (await ana.as('GET', `${o}/changes?since=${got.seq}`)).json;
    expect(next.changes).toMatchObject([
      { kind: 'ticket.updated', fields: { status: { from: 'open', to: 'in_progress' } } },
      { kind: 'ticket.comment', excerpt: 'Looking into it', actor: { username: 'bruno' } },
    ]);
    expect((await ana.as('GET', `${o}/changes?since=${next.seq}`)).json.changes).toEqual([]);
    expect((await ana.as('GET', `${o}/tickets/PAY-1`)).json.comments).toMatchObject([{ author: { username: 'bruno' }, body: 'Looking into it' }]);
  });

  it('keeps each org to its own members', async () => {
    const { o, register } = await team();
    const eve = await register('eve');
    expect((await eve.as('GET', `${o}/tickets`)).status).toBe(404);
    expect((await eve.as('POST', `${o}/tickets`, { project: 'PAY', title: 'x' })).status).toBe(404);
    expect((await eve.as('GET', `${o}/changes`)).status).toBe(404);
  });
});

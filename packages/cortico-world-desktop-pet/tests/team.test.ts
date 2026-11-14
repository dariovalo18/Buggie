import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../../../team-server/hub.ts';
import { DESKTOP_PET_DEFAULTS, NO_TOKEN } from '../src/config.ts';
import { TeamClient, type TeamNotice } from '../src/team.ts';
import { DesktopPetWorld } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

/** A team server on a local port with an org of ana (owner) and bruno, a Backend sector bruno is in, and a PAY project. */
async function server() {
  const hub = createHub({ dbFile: ':memory:' });
  await new Promise<void>((resolve) => hub.server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => hub.close());
  const url = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
  const call = async (token: string | null, method: string, path: string, body?: unknown) => {
    const res = await fetch(url + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return res.json() as Promise<any>;
  };
  const ana = (await call(null, 'POST', '/v1/register', { username: 'ana', name: 'Ana', password: 'password1' })).token as string;
  const brunoToken = (await call(null, 'POST', '/v1/register', { username: 'bruno', name: 'Bruno', password: 'password2' })).token as string;
  const org = (await call(ana, 'POST', '/v1/orgs', { name: 'Acme' })).org.id as number;
  const o = `/v1/orgs/${org}`;
  await call(ana, 'POST', `${o}/members`, { username: 'bruno' });
  const sector = (await call(ana, 'POST', `${o}/sectors`, { name: 'Backend' })).sectors[0].id;
  await call(ana, 'PUT', `${o}/sectors/${sector}/members/bruno`);
  await call(ana, 'POST', `${o}/projects`, { key: 'PAY', name: 'Payments', repos: ['acme/pay'] });
  return { url, org, o, brunoToken, asAna: (method: string, path: string, body?: unknown) => call(ana, method, path, body) };
}

describe('TeamClient', () => {
  it("tells of what concerns the account, from others only and nothing older than its start", async () => {
    const s = await server();
    await s.asAna('POST', `${s.o}/tickets`, { project: 'PAY', title: 'Before the start', assignee: 'bruno' });
    const got: TeamNotice[] = [];
    let token: string | null = s.brunoToken;
    const client = new TeamClient({
      fetch, enabled: () => true, url: () => s.url, token: () => token, storeToken: (t) => { token = t; },
      org: () => s.org, setOrg: () => {}, onNotices: (n) => got.push(...n),
    });
    client.start();
    cleanup.push(() => client.stop());
    await expect.poll(() => client.ready).toBe(true);
    // the first read takes the current sequence; give it the moment to start waiting
    await new Promise((r) => setTimeout(r, 300));
    await s.asAna('POST', `${s.o}/tickets`, { project: 'PAY', title: 'Refund fails', assignee: 'bruno' });
    await s.asAna('POST', `${s.o}/tickets`, { project: 'PAY', title: 'Slow list', sector: 'Backend' });
    await s.asAna('POST', `${s.o}/tickets`, { project: 'PAY', title: 'Not about bruno' });
    await expect.poll(() => got.map((n) => n.kind)).toEqual(['assigned', 'sector']);
    await client.call('POST', client.orgPath('/tickets/PAY-2/comments'), { body: 'mine, not told' });
    await s.asAna('POST', `${s.o}/tickets/PAY-2/comments`, { body: 'On it?' });
    await expect.poll(() => got.length).toBe(3);
    expect(got[0]).toMatchObject({ kind: 'assigned', actor: 'Ana', ticket: { ref: 'PAY-2', title: 'Refund fails' } });
    expect(got[2]).toMatchObject({ kind: 'comment', actor: 'Ana', excerpt: 'On it?' });
  });
});

/** Writes a config patch into the live section, as Core does with a World's persist. */
const merge = (to: Record<string, unknown>, patch: Record<string, unknown>) => {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) merge(to[k] as Record<string, unknown>, v as Record<string, unknown>);
    else to[k] = v;
  }
};

describe('the team server through the World', () => {
  async function mounted(url: string) {
    const cfg = structuredClone(DESKTOP_PET_DEFAULTS);
    Object.assign(cfg, { enabled: true, port: 0 });
    cfg.window.enabled = false;
    cfg.asr.enabled = false;
    cfg.team.url = url;
    const secrets = { token: '' };
    const dir = mkdtempSync(join(tmpdir(), 'pet-team-'));
    const world = new DesktopPetWorld({
      cfg, timezone: 'UTC', persist: (patch) => merge(cfg as never, patch as never), runtimesRoot: () => join(dir, 'r'), modelsDir: () => join(dir, 'm'),
      teamToken: () => secrets.token, storeTeamToken: (t) => { secrets.token = t; },
    });
    const host = new FakeHost();
    await world.start(host);
    cleanup.push(() => world.stop());
    const panel = (method: string, args: unknown[] = []) => world.webUi().invoke!('pet', method, args) as Promise<Record<string, any>>;
    return { cfg, world, host, panel, secrets };
  }
  const tool = (world: DesktopPetWorld, name: string) => world.tools().find((t) => t.name === name);

  it('signs in from the settings window, keeps the token as a secret and gives the ticket tools while signed in', async () => {
    const s = await server();
    const { cfg, world, panel, secrets } = await mounted(s.url);
    expect(tool(world, 'ticket_create')).toBeUndefined();
    expect((await panel('teamSignIn', [{ username: 'bruno', password: 'wrong one' }])).error).toBe('bad_credentials');
    const state = await panel('teamSignIn', [{ username: 'bruno', password: 'password2' }]);
    expect(state).toMatchObject({ error: null, signedIn: true, enabled: true, org: s.org, user: { username: 'bruno' } });
    expect(state.view.projects).toMatchObject([{ key: 'PAY', repos: ['acme/pay'] }]);
    expect(secrets.token).toMatch(/^bgt_/);
    expect(cfg.team.org).toBe(s.org);
    const created = await tool(world, 'ticket_create')!.handler({ project: 'PAY', title: 'Refund fails', assignee: 'me', source: { file: 'src/refund.ts', line: 3 } }, {} as never);
    expect(JSON.parse((created as { text: string }).text)).toMatchObject({ ref: 'PAY-1', kind: 'bug', missing: ['body', 'expected', 'steps', 'acceptance'], assignee: { username: 'bruno' }, author: { username: 'bruno' } });
    const filled = await tool(world, 'ticket_update')!.handler({ ref: 'PAY-1', body: 'A refund of 0.10 answers 500.', expected: 'It goes through.', steps: 'pnpm refund 0.10', acceptance: 'Small refunds work.' }, {} as never);
    expect(JSON.parse((filled as { text: string }).text)).toMatchObject({ missing: [], expected: 'It goes through.' });
    const listed = await tool(world, 'ticket_list')!.handler({ assignee: 'me' }, {} as never);
    expect(JSON.parse((listed as { text: string }).text).tickets.map((t: any) => t.ref)).toEqual(['PAY-1']);
    await panel('teamSignOut');
    expect(secrets.token).toBe(NO_TOKEN);
    expect(tool(world, 'ticket_create')).toBeUndefined();
  });

  it('wakes the bot with what others did to the person\'s tickets, debounced', async () => {
    const s = await server();
    const { host, panel } = await mounted(s.url);
    await panel('teamSignIn', [{ username: 'bruno', password: 'password2' }]);
    await new Promise((r) => setTimeout(r, 300));
    await s.asAna('POST', `${s.o}/tickets`, { project: 'PAY', title: 'Refund fails', assignee: 'bruno' });
    await expect.poll(() => host.events.map((e) => e.type)).toContain('desktop-pet.team');
    const i = host.events.findIndex((e) => e.type === 'desktop-pet.team');
    expect(host.events[i]!.text).toContain('PAY-1');
    // a ticket with no details yet: the bot hears which ones it still needs
    expect(host.events[i]!.text).toMatch(/expected.+steps.+acceptance/);
    expect(host.pushOpts[i]).toEqual({ trigger: 'debounce' });
  });

  it('runs the org\'s administration from the settings window, under the org only', async () => {
    const s = await server();
    const { panel } = await mounted(s.url);
    await panel('teamSignIn', [{ username: 'bruno', password: 'password2' }]);
    expect((await panel('teamOrg', ['POST', '/sectors', { name: 'QA' }])).error).toBe('admin_only');
    await expect(panel('teamOrg', ['GET', '/../../me'])).rejects.toThrow();
    await expect(panel('teamOrg', ['DELETE', '/members/../../../me'])).rejects.toThrow();
    const created = await panel('teamCreateOrg', ['Side project']);
    expect(created).toMatchObject({ error: null, view: { org: { name: 'Side project', role: 'owner' } } });
    const done = await panel('teamOrg', ['POST', '/sectors', { name: 'QA' }]);
    expect(done.view.sectors.map((x: any) => x.name)).toEqual(['QA']);
  });
});


import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHub } from '../../../team-server/hub.ts';
import { DESKTOP_PET_DEFAULTS, NO_TOKEN } from '../src/config.ts';
import { DesktopPetWorld } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';

const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => { for (const c of cleanup.splice(0).reverse()) await c(); });

/** A stand-in for Telegram's Bot API: one bot, `acme_bot` with token `T1`; the test pushes messages, the sent ones are kept. */
async function fakeTelegram() {
  const updates: any[] = [];
  const sent: Array<{ chat_id: number; text: string }> = [];
  let nextId = 1;
  const wakes = new Set<() => void>();
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
    const answer = (status: number, json: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    if (!m || m[1] !== 'T1') return answer(401, { ok: false });
    if (m[2] === 'getMe') return answer(200, { ok: true, result: { username: 'acme_bot' } });
    if (m[2] === 'sendMessage') { sent.push(body); return answer(200, { ok: true, result: {} }); }
    const ready = () => updates.filter((u) => u.update_id >= (body.offset ?? 0));
    if (!ready().length) await new Promise<void>((r) => { wakes.add(r); setTimeout(r, 300); });
    answer(200, { ok: true, result: ready() });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanup.push(() => new Promise((r) => { server.closeAllConnections(); server.close(r); }));
  return {
    api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    sent,
    say(from: number, username: string, text: string) {
      updates.push({ update_id: nextId++, message: { date: Math.floor(Date.now() / 1000), chat: { id: from, type: 'private' }, from: { id: from, username }, text } });
      for (const w of wakes) w();
      wakes.clear();
    },
  };
}

async function mounted(tgApi: string, team?: { url: string }) {
  const cfg = structuredClone(DESKTOP_PET_DEFAULTS);
  Object.assign(cfg, { enabled: true, port: 0 });
  cfg.window.enabled = false;
  cfg.asr.enabled = false;
  if (team) cfg.team.url = team.url;
  const secrets = { team: '', telegram: '' };
  const dir = mkdtempSync(join(tmpdir(), 'pet-telegram-'));
  const merge = (to: Record<string, unknown>, patch: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) merge(to[k] as Record<string, unknown>, v as Record<string, unknown>);
      else to[k] = v;
    }
  };
  const world = new DesktopPetWorld({
    cfg, timezone: 'UTC', persist: (patch) => merge(cfg as never, patch as never), runtimesRoot: () => join(dir, 'r'), modelsDir: () => join(dir, 'm'),
    teamToken: () => secrets.team, storeTeamToken: (t) => { secrets.team = t; },
    telegramToken: () => secrets.telegram, storeTelegramToken: (t) => { secrets.telegram = t; },
    telegramApi: tgApi,
  });
  const host = new FakeHost();
  await world.start(host);
  cleanup.push(() => world.stop());
  const panel = (method: string, args: unknown[] = []) => world.webUi().invoke!('pet', method, args) as Promise<Record<string, any>>;
  const tool = (name: string) => world.tools().find((t) => t.name === name);
  return { cfg, world, host, panel, secrets, tool };
}

describe('Telegram through the person\'s own bot', () => {
  it('checks the token, links the chat that sends the code, wakes the bot with its messages and answers only it', async () => {
    const tg = await fakeTelegram();
    const { cfg, host, panel, secrets, tool } = await mounted(tg.api);
    expect((await panel('telegramToken', ['wrong'])).error).toBe('telegram_token_invalid');
    const state = await panel('telegramToken', ['T1']);
    expect(state).toMatchObject({ error: null, mode: 'own', own: { hasToken: true, bot: 'acme_bot', linked: null } });
    expect(secrets.telegram).toBe('T1');
    expect(tool('telegram_send')).toBeUndefined();
    const { linkCode } = await panel('telegramLink');
    expect(linkCode.url).toBe(`https://t.me/acme_bot?start=${linkCode.code}`);
    tg.say(501, 'bruno_tg', `/start ${linkCode.code}`);
    await expect.poll(() => cfg.telegram).toEqual({ mode: 'own', chat: 501, name: '@bruno_tg' });
    expect(tg.sent.map((m) => m.chat_id)).toEqual([501]);
    expect(tool('telegram_send')).toBeDefined();
    tg.say(77, 'eve_tg', 'hello?');
    tg.say(501, 'bruno_tg', 'any tickets for me?');
    await expect.poll(() => host.events.map((e) => e.type)).toContain('desktop-pet.telegram');
    const i = host.events.findIndex((e) => e.type === 'desktop-pet.telegram');
    expect(host.events[i]!.text).toContain('any tickets for me?');
    expect(host.pushOpts[i]).toEqual({ trigger: 'preempt' });
    // the stranger got the stranger's answer, and woke nothing
    expect(tg.sent.map((m) => m.chat_id)).toEqual([501, 77]);
    expect(host.events.filter((e) => e.type === 'desktop-pet.telegram')).toHaveLength(1);
    expect(await tool('telegram_send')!.handler({ text: 'Two: PAY-1 and PAY-2.' }, {} as never)).toEqual({ text: 'sent' });
    expect(tg.sent.at(-1)).toEqual({ chat_id: 501, text: 'Two: PAY-1 and PAY-2.' });
    await panel('telegramUnlink');
    expect(tool('telegram_send')).toBeUndefined();
    await panel('telegramToken', ['']);
    expect(secrets.telegram).toBe(NO_TOKEN);
  });
});

describe("Telegram through the company's bot on the team server", () => {
  it('links through the server and carries the messages both ways', async () => {
    const tg = await fakeTelegram();
    const hub = createHub({ dbFile: ':memory:', telegramApi: tg.api, telegramRetryMs: 50 });
    await new Promise<void>((r) => hub.server.listen(0, '127.0.0.1', r));
    cleanup.push(() => hub.close());
    const url = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
    const call = async (token: string | null, method: string, path: string, body?: unknown) =>
      (await fetch(url + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json() as Promise<any>;
    const ana = (await call(null, 'POST', '/v1/register', { username: 'ana', password: 'password1' })).token;
    await call(null, 'POST', '/v1/register', { username: 'bruno', password: 'password2' });
    const org = (await call(ana, 'POST', '/v1/orgs', { name: 'Acme' })).org.id;
    await call(ana, 'POST', `/v1/orgs/${org}/members`, { username: 'bruno' });

    const { host, panel, tool } = await mounted(tg.api, { url });
    await panel('teamSignIn', [{ username: 'bruno', password: 'password2' }]);
    // bruno is a member: the company bot is an admin's to set
    expect((await panel('telegramMode', ['team'])).team).toMatchObject({ ready: true, org: 'Acme', admin: false, bot: null });
    expect((await panel('telegramTeamBot', ['T1'])).error).toBe('admin_only');
    expect((await panel('telegramLink')).error).toBe('telegram_no_bot');
    await call(ana, 'PUT', `/v1/orgs/${org}/telegram`, { token: 'T1' });
    const { linkCode, team } = await panel('telegramLink');
    expect(team.bot).toBe('acme_bot');
    tg.say(501, 'bruno_tg', `/start ${linkCode.code}`);
    await expect.poll(async () => (await panel('telegramState')).team.linked).toBe('@bruno_tg');
    await expect.poll(() => !!tool('telegram_send')).toBe(true);
    tg.say(501, 'bruno_tg', 'any tickets for me?');
    await expect.poll(() => host.events.find((e) => e.type === 'desktop-pet.telegram')?.text ?? '').toContain('any tickets for me?');
    expect(await tool('telegram_send')!.handler({ text: 'None today.' }, {} as never)).toEqual({ text: 'sent' });
    expect(tg.sent.at(-1)).toEqual({ chat_id: 501, text: 'None today.' });
    expect((await panel('telegramNotify', ['always'])).team.notify).toBe('always');
  });
});

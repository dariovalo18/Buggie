import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHub, type Hub } from '../team-server/hub.ts';

const open: Array<{ close(): unknown }> = [];
afterEach(async () => { for (const h of open.splice(0).reverse()) await h.close(); });

/** A stand-in for Telegram's Bot API: one bot, `acme_bot` with token `T1`, updates pushed by the test, messages kept. */
async function fakeTelegram() {
  const updates: unknown[] = [];
  const sent: Array<{ chat_id: number; text: string }> = [];
  let nextId = 1;
  let wake: (() => void) | null = null;
  const server: Server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '');
    const answer = (status: number, json: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    if (!m || m[1] !== 'T1') return answer(401, { ok: false });
    if (m[2] === 'getMe') return answer(200, { ok: true, result: { username: 'acme_bot' } });
    if (m[2] === 'sendMessage') { sent.push(body); return answer(200, { ok: true, result: {} }); }
    if (m[2] === 'getUpdates') {
      const ready = () => updates.filter((u: any) => u.update_id >= (body.offset ?? 0));
      if (!ready().length) await new Promise<void>((r) => { wake = r; setTimeout(r, 300); });
      return answer(200, { ok: true, result: ready() });
    }
    answer(404, { ok: false });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  open.push({ close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) });
  return {
    api: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    sent,
    /** A private message from Telegram user `from` (chat id the same, as Telegram has it for private chats). */
    say(from: number, username: string, text: string) {
      updates.push({ update_id: nextId++, message: { chat: { id: from, type: 'private' }, from: { id: from, username }, text } });
      wake?.();
    },
  };
}

async function setup() {
  const tg = await fakeTelegram();
  const hub: Hub = createHub({ dbFile: ':memory:', telegramApi: tg.api, telegramRetryMs: 50 });
  open.push(hub);
  await new Promise<void>((r) => hub.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(hub.server.address() as AddressInfo).port}`;
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return res.json() as Promise<any>;
  };
  const register = async (username: string, name: string) => {
    const r = await fetch(`${base}/v1/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, name, password: 'correct horse' }) });
    const token = (await r.json() as any).token as string;
    return (method: string, path: string, body?: unknown) => call(token, method, path, body);
  };
  const ana = await register('ana', 'Ana');
  const bruno = await register('bruno', 'Bruno');
  const o = `/v1/orgs/${(await ana('POST', '/v1/orgs', { name: 'Acme' })).org.id}`;
  await ana('POST', `${o}/members`, { username: 'bruno' });
  await ana('POST', `${o}/projects`, { key: 'PAY', name: 'Payments' });
  return { tg, ana, bruno, o };
}

describe("an org's Telegram bot", () => {
  it('is set by an admin, links a member by code and turns away anyone else', async () => {
    const { tg, ana, bruno, o } = await setup();
    expect(await bruno('PUT', `${o}/telegram`, { token: 'T1' })).toEqual({ error: 'admin_only' });
    expect(await ana('PUT', `${o}/telegram`, { token: 'wrong' })).toEqual({ error: 'telegram_token_invalid' });
    expect(await ana('PUT', `${o}/telegram`, { token: 'T1' })).toEqual({ bot: { username: 'acme_bot' }, link: null });
    const { code, url } = await bruno('POST', `${o}/telegram/link`);
    expect(url).toBe(`https://t.me/acme_bot?start=${code}`);
    tg.say(77, 'eve_tg', '/start');
    tg.say(501, 'bruno_tg', `/start ${code}`);
    await expect.poll(() => tg.sent.map((m) => [m.chat_id, m.text.split(':')[0]])).toEqual([[77, 'This bot answers the members of Acme who linked their account'], [501, 'Linked']]);
    expect(await bruno('GET', `${o}/telegram`)).toEqual({ bot: { username: 'acme_bot' }, link: { name: '@bruno_tg', notify: 'offline' } });
    // a code works once
    tg.say(77, 'eve_tg', code);
    await expect.poll(() => tg.sent.length).toBe(3);
    expect(tg.sent[2]!.text).toMatch(/^This bot answers/);
  });

  it("hands a linked person's messages to their Buggie only while it is connected, and sends its answers back", async () => {
    const { tg, ana, bruno, o } = await setup();
    await ana('PUT', `${o}/telegram`, { token: 'T1' });
    const { code } = await bruno('POST', `${o}/telegram/link`);
    tg.say(501, 'bruno_tg', code);
    await expect.poll(() => tg.sent.length).toBe(1);
    tg.say(501, 'bruno_tg', 'any tickets for me?');
    await expect.poll(() => tg.sent.length).toBe(2);
    expect(tg.sent[1]!.text).toMatch(/not connected/);
    const { seq } = await bruno('GET', `${o}/changes`);
    const waiting = bruno('GET', `${o}/changes?since=${seq}&wait=10`);
    await new Promise((r) => setTimeout(r, 100));
    tg.say(501, 'bruno_tg', 'any tickets for me?');
    expect((await waiting).changes).toMatchObject([{ kind: 'telegram.message', actor: { username: 'bruno' }, text: 'any tickets for me?' }]);
    // nobody else reads it
    expect((await ana('GET', `${o}/changes?since=${seq}`)).changes).toEqual([]);
    expect(await bruno('POST', `${o}/telegram/send`, { text: 'Two: PAY-1 and PAY-2.' })).toEqual({ ok: true });
    expect(tg.sent.at(-1)).toEqual({ chat_id: 501, text: 'Two: PAY-1 and PAY-2.' });
    expect(await ana('POST', `${o}/telegram/send`, { text: 'x' })).toEqual({ error: 'telegram_not_linked' });
  });

  it("tells a linked person of their tickets as they chose: always, only while their Buggie is away, or never", async () => {
    const { tg, ana, bruno, o } = await setup();
    await ana('PUT', `${o}/telegram`, { token: 'T1' });
    const { code } = await bruno('POST', `${o}/telegram/link`);
    tg.say(501, 'bruno_tg', code);
    await expect.poll(() => tg.sent.length).toBe(1);
    // bruno's Buggie just read the log: it is connected, and tells him itself
    await bruno('GET', `${o}/changes`);
    await ana('POST', `${o}/tickets`, { project: 'PAY', title: 'Refund fails', assignee: 'bruno' });
    await bruno('PATCH', `${o}/telegram/link`, { notify: 'always' });
    await ana('POST', `${o}/tickets/PAY-1/comments`, { body: 'On it?' });
    await expect.poll(() => tg.sent.length).toBe(2);
    expect(tg.sent[1]).toEqual({ chat_id: 501, text: 'PAY-1 "Refund fails": Ana commented: On it?' });
    await bruno('PATCH', `${o}/telegram/link`, { notify: 'never' });
    await ana('PATCH', `${o}/tickets/PAY-1`, { priority: 'high' });
    await new Promise((r) => setTimeout(r, 200));
    expect(tg.sent).toHaveLength(2);
    // what bruno does himself is not told to him
    await bruno('PATCH', `${o}/telegram/link`, { notify: 'always' });
    await bruno('POST', `${o}/tickets/PAY-1/comments`, { body: 'Yes' });
    await new Promise((r) => setTimeout(r, 200));
    expect(tg.sent).toHaveLength(2);
  });
});

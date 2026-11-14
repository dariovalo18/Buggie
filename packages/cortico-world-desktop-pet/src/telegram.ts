/**
 * Talking to the bot on Telegram, in one of two ways (`telegram.mode`):
 *
 * - `own`: the person's own bot, its token kept as a secret. `OwnBot` reads its private messages with `getUpdates` long
 *   polling (no public address needed) and sends with `sendMessage`. The person links their chat by sending the bot a
 *   code from the settings window (`/start <code>` through the `t.me` link); from then on only that chat is heard, and
 *   anyone else gets `strangers` as the answer.
 * - `team`: the company's bot on the team server (team-server/telegram.ts). The server links the person's Telegram to
 *   their account and hands their messages to this Buggie through its activity log; `TeamClient` passes them on.
 *
 * Messages arrive with `onMessage`; the bot answers with the `telegram_send` tool.
 */

import type { ToolDef } from 'cortico/core/types.ts';

export const TELEGRAM_MODES = ['off', 'own', 'team'] as const;
export type TelegramMode = typeof TELEGRAM_MODES[number];
export const TELEGRAM_API = 'https://api.telegram.org';
/** Seconds a `getUpdates` request waits on Telegram, and the pause after a failed read. */
const POLL_SECONDS = 25, RETRY_SECONDS = 30;
/** Telegram's limit on one message's text. */
const MESSAGE_MAX = 4096;
/** How long a link code stays good. */
export const LINK_CODE_SECONDS = 10 * 60;

/** A failed call: `unauthorized` for a token Telegram does not know, `unreachable`, or `telegram_<status>`. */
export class TelegramError extends Error {
  constructor(readonly code: string) { super(code); }
}

export class TelegramBotApi {
  constructor(private readonly fetchImpl: typeof fetch, private readonly token: string, private readonly api = TELEGRAM_API) {}

  async call<T = any>(method: string, params: object, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.api.replace(/\/+$/, '')}/bot${this.token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new TelegramError('unreachable');
    }
    const json = await res.json().catch(() => ({})) as { ok?: boolean; result?: T };
    if (res.status === 401 || res.status === 404) throw new TelegramError('unauthorized');
    if (!res.ok || !json.ok) throw new TelegramError(`telegram_${res.status}`);
    return json.result as T;
  }

  async send(chat: number, text: string): Promise<void> {
    for (let i = 0; i < text.length; i += MESSAGE_MAX) await this.call('sendMessage', { chat_id: chat, text: text.slice(i, i + MESSAGE_MAX) });
  }
}

export interface OwnLink { chat: number; name: string }

export interface OwnBotOptions {
  fetch: typeof fetch;
  /** On while `telegram.mode` is `own`. */
  enabled(): boolean;
  token(): string | null;
  /** The linked chat; null before the person links one. */
  link(): OwnLink | null;
  setLink(link: OwnLink | null): void;
  onMessage(text: string): void;
  /** What a linked chat and a stranger are told, in the person's language. */
  replies(): { linked: string; strangers: string };
  onState?(): void;
  warn?(message: string): void;
  /** Telegram's Bot API address; absent, the real one. */
  api?: () => string | undefined;
  retrySeconds?: number;
}

export class OwnBot {
  /** The bot's @username once Telegram answered for the token. */
  username: string | null = null;
  /** Why the last read failed; null after one that worked. */
  problem: string | null = null;
  private pending: { code: string; until: number } | null = null;
  private generation = 0;
  private abort: AbortController | null = null;

  constructor(private readonly o: OwnBotOptions) {}

  private bot(): TelegramBotApi | null {
    const token = this.o.token();
    return token ? new TelegramBotApi(this.o.fetch, token, this.o.api?.()) : null;
  }

  /** Reading, with a linked chat to answer. */
  get ready(): boolean { return this.o.enabled() && this.username !== null && this.o.link() !== null; }

  /** A code to send the bot, and the link that sends it; null until the token was checked. */
  linkCode(): { code: string; url: string; expiresIn: number } | null {
    if (!this.username) return null;
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
    this.pending = { code, until: Date.now() + LINK_CODE_SECONDS * 1000 };
    return { code, url: `https://t.me/${this.username}?start=${code}`, expiresIn: LINK_CODE_SECONDS };
  }

  async send(text: string): Promise<void> {
    const bot = this.bot(), link = this.o.link();
    if (!bot || !link) throw new TelegramError('telegram_not_linked');
    await bot.send(link.chat, text);
  }

  stop(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
  }

  /** Starts reading again from the current settings: checks the token, then reads the messages sent from now on. */
  restart(): void {
    this.stop();
    // the token is checked again: neither the old name nor the old failure holds
    this.username = null;
    this.problem = null;
    void this.loop(this.generation);
  }

  private async loop(gen: number): Promise<void> {
    const live = () => gen === this.generation;
    const started = Math.floor(Date.now() / 1000);
    let offset = 0;
    while (live()) {
      const bot = this.o.enabled() ? this.bot() : null;
      if (!bot) { this.problem = null; this.o.onState?.(); return; }
      this.abort = new AbortController();
      try {
        if (!this.username) {
          this.username = String((await bot.call<{ username?: string }>('getMe', {}, this.abort.signal)).username ?? '');
          this.problem = null;
          this.o.onState?.();
        }
        const updates = await bot.call<any[]>('getUpdates', { offset, timeout: POLL_SECONDS, allowed_updates: ['message'] }, this.abort.signal);
        if (!live()) return;
        for (const u of updates) {
          offset = Math.max(offset, Number(u.update_id) + 1);
          const m = u.message;
          // what was sent before this start was for an earlier run
          if (!m || m.chat?.type !== 'private' || typeof m.text !== 'string' || !m.from || Number(m.date) < started) continue;
          await this.heard(bot, Number(m.chat.id), m.from.username ? `@${m.from.username}` : String(m.from.first_name ?? ''), m.text);
        }
      } catch (e) {
        if (!live()) return;
        const code = e instanceof TelegramError ? (e.code === 'unauthorized' ? 'telegram_token_invalid' : e.code) : String(e);
        if (this.problem !== code) { this.problem = code; this.o.warn?.(code); this.o.onState?.(); }
        await new Promise((r) => setTimeout(r, (this.o.retrySeconds ?? RETRY_SECONDS) * 1000));
      }
    }
  }

  private async heard(bot: TelegramBotApi, chat: number, name: string, text: string): Promise<void> {
    const said = text.trim();
    const code = (/^\/start(?:\s+(\S+))?$/.exec(said)?.[1] ?? said).toUpperCase();
    const say = (t: string) => bot.send(chat, t).catch(() => {});
    if (this.pending && code === this.pending.code && Date.now() < this.pending.until) {
      this.pending = null;
      this.o.setLink({ chat, name });
      this.o.onState?.();
      await say(this.o.replies().linked);
      return;
    }
    if (this.o.link()?.chat !== chat) { await say(this.o.replies().strangers); return; }
    if (/^\/start\b/.test(said)) { await say(this.o.replies().linked); return; }
    this.o.onMessage(said);
  }
}

/** Given while a Telegram chat is linked, either way. */
export const TELEGRAM_TOOL_DECLS: Array<Omit<ToolDef, 'handler'>> = [{
  name: 'telegram_send',
  tags: ['act'],
  description: 'Send the person a message on Telegram, where they wrote to you from. Plain text; long text is split.',
  parameters: { type: 'object', properties: { text: { type: 'string', description: 'The message.' } }, required: ['text'] },
}];

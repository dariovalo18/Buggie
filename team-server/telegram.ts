/**
 * Telegram's Bot API, as the team server uses it: an org's bot (its token set by an admin) reads the messages sent to it
 * with `getUpdates` long polling, so the server needs no public address, and answers with `sendMessage`.
 * Only private chats are read. No TypeScript-only syntax: Node runs this file as it is.
 */

export const TELEGRAM_API = 'https://api.telegram.org';
/** Seconds a `getUpdates` request waits on Telegram for a message. */
const POLL_SECONDS = 25;
/** Telegram's limit on one message's text. */
const MESSAGE_MAX = 4096;

export interface TelegramMessage {
  chatId: number;
  userId: number;
  /** The sender's @username, or their first name when they have none. */
  name: string;
  text: string;
}

/** A failed call: `code` is `unauthorized` for a token Telegram does not know, `unreachable`, or `telegram_<status>`. */
export class TelegramError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export class TelegramBot {
  api: string;
  token: string;
  constructor(api: string, token: string) {
    this.api = api.replace(/\/+$/, '');
    this.token = token;
  }

  async call(method: string, params: object, signal?: AbortSignal): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${this.api}/bot${this.token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new TelegramError('unreachable');
    }
    const json = await res.json().catch(() => ({})) as { ok?: boolean; result?: unknown };
    if (res.status === 401 || res.status === 404) throw new TelegramError('unauthorized');
    if (!res.ok || !json.ok) throw new TelegramError(`telegram_${res.status}`);
    return json.result;
  }

  /** The bot's @username; fails with `unauthorized` for a wrong token. */
  async username(): Promise<string> {
    return String((await this.call('getMe', {})).username ?? '');
  }

  /** Sends `text` to a chat, cut into Telegram-sized parts. */
  async send(chatId: number, text: string): Promise<void> {
    for (let i = 0; i < text.length; i += MESSAGE_MAX) await this.call('sendMessage', { chat_id: chatId, text: text.slice(i, i + MESSAGE_MAX) });
  }
}

export interface Poller {
  stop(): void;
}

/**
 * Reads the bot's private messages from update `offset` on, calling `onMessage` for each text one and `onOffset` with
 * the next update to ask for; after a failed read it waits `retryMs`. `onError` hears each failure.
 */
export function poll(bot: TelegramBot, offset: number, o: {
  onMessage(m: TelegramMessage): Promise<void> | void;
  onOffset(next: number): void;
  onError?(code: string): void;
  retryMs: number;
}): Poller {
  const abort = new AbortController();
  let next = offset;
  void (async () => {
    while (!abort.signal.aborted) {
      try {
        const updates = await bot.call('getUpdates', { offset: next, timeout: POLL_SECONDS, allowed_updates: ['message'] }, abort.signal) as any[];
        for (const u of updates) {
          next = Math.max(next, Number(u.update_id) + 1);
          const m = u.message;
          if (!m || m.chat?.type !== 'private' || typeof m.text !== 'string' || !m.from) continue;
          await o.onMessage({ chatId: Number(m.chat.id), userId: Number(m.from.id), name: m.from.username ? `@${m.from.username}` : String(m.from.first_name ?? ''), text: m.text });
        }
        if (updates.length) o.onOffset(next);
      } catch (e) {
        if (abort.signal.aborted) return;
        o.onError?.(e instanceof TelegramError ? e.code : String(e));
        await new Promise((r) => setTimeout(r, o.retryMs));
      }
    }
  })();
  return { stop: () => abort.abort() };
}

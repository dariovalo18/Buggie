/**
 * 「Telegram」: talking to Buggie on Telegram, through the desktop-pet World's pet panel, whose `telegram*` methods keep
 * the settings (src/telegram.ts). The mode picks the way: the person's own bot (its token kept as a secret here, the
 * chat linked by a code sent to it) or the company's bot on the team server (set by an owner or admin; each person
 * links their own Telegram, and picks when the server tells them of their tickets there).
 *
 * Every call answers with the whole Telegram state, which the page draws again; a failed one carries an error code,
 * shown beside the control that sent it. Asking for a link code answers with the code and its t.me link too.
 */

import { actionProblem } from '../../base/ui/problem.ts';
import { invokePanel } from '../../base/api.ts';
import type { Page, PageContext } from '../../base/page.ts';
import { intro } from '../intro.ts';
import { S, fill } from './strings.ts';

const PET_PAGE = 'world:desktop-pet';

interface TelegramState {
  mode: 'off' | 'own' | 'team';
  own: { hasToken: boolean; bot: string | null; problem: string | null; linked: string | null };
  team: { ready: boolean; org: string | null; admin: boolean; bot: string | null; linked: string | null; notify: string | null };
  error?: string | null;
  linkCode?: { code: string; url: string; expiresIn: number } | null;
}

const errorText = (code: string) => (S.errors as Record<string, string>)[code] ?? code;

async function mount(ctx: PageContext): Promise<void> {
  const { ui, root, signal } = ctx;
  const opts = { signal };
  const problem = actionProblem(ui, root.ownerDocument, signal);
  root.classList.add('home');
  root.append(intro(ui, S.nav));

  const row = (label: string, control: HTMLElement, hint?: string) => {
    const r = ui.h('div', 'companion-row');
    const c = ui.h('div', 'companion-control');
    c.append(control);
    if (hint) c.append(ui.h('p', 'home-note', hint));
    r.append(ui.h('div', 'companion-label', label), c);
    return r;
  };
  const box = (...els: HTMLElement[]) => { const b = ui.h('div', 'companion-rangebox'); b.append(...els); return b; };

  async function call(method: string, args: unknown[], anchor: HTMLElement): Promise<TelegramState | null> {
    try {
      const next = await invokePanel<TelegramState>(PET_PAGE, 'pet', method, args, opts);
      draw(next);
      if (next.error) { problem(anchor, errorText(next.error)); return null; }
      return next;
    } catch (err) {
      if (!signal.aborted) problem(anchor, fill(S.failed, { why: err instanceof Error ? err.message : String(err) }));
      return null;
    }
  }

  /* ---------- mode ---------- */
  const modeSheet = ui.sheet({ title: S.modeTitle });
  const mode = ui.select({ options: [{ value: 'off', label: S.off }, { value: 'own', label: S.own }, { value: 'team', label: S.team }] });
  mode.addEventListener('change', () => void call('telegramMode', [mode.value], mode), { signal });
  modeSheet.body.append(row(S.modeLabel, mode, S.modeHint));
  root.append(modeSheet.el);

  /** The chat row both ways share: the link button, the code it got, and the linked chat with its unlink button. */
  function chatRow() {
    const status = ui.msgline('');
    const link = ui.button(S.link, { variant: 'primary' });
    const unlink = ui.button(S.unlink, { size: 'sm' });
    const code = ui.h('p', 'home-note');
    const open = ui.h('a', 'btn', S.openLink) as HTMLAnchorElement;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    const pending = ui.h('div');
    pending.append(code, open);
    pending.hidden = true;
    link.addEventListener('click', async () => {
      const next = await call('telegramLink', [], link);
      if (!next?.linkCode) return;
      code.textContent = fill(S.linkHint, { code: next.linkCode.code });
      open.href = next.linkCode.url;
      pending.hidden = false;
    }, { signal });
    unlink.addEventListener('click', () => void call('telegramUnlink', [], unlink), { signal });
    const el = ui.h('div');
    el.append(box(status, link, unlink), pending);
    return {
      el,
      show(linked: string | null, canLink: boolean) {
        status.textContent = linked ? fill(S.linkedAs, { name: linked }) : S.notLinked;
        link.hidden = !!linked || !canLink;
        unlink.hidden = !linked;
        if (linked) pending.hidden = true;
      },
    };
  }

  /* ---------- own bot ---------- */
  const ownSheet = ui.sheet({ title: S.ownTitle });
  const token = ui.input({ type: 'password' });
  token.placeholder = S.tokenPlaceholder;
  const botStatus = ui.msgline('');
  const save = ui.button(S.save, { onClick: async () => { if (token.value.trim() && await call('telegramToken', [token.value.trim()], save)) token.value = ''; } });
  const remove = ui.button(S.remove, { size: 'sm', onClick: () => void call('telegramToken', [''], remove) });
  const tokenBox = ui.h('div');
  tokenBox.append(box(token, save), box(botStatus, remove));
  const ownChat = chatRow();
  ownSheet.body.append(row(S.tokenLabel, tokenBox, S.tokenHint), row(S.chatLabel, ownChat.el));
  root.append(ownSheet.el);

  /* ---------- company bot ---------- */
  const teamSheet = ui.sheet({ title: S.teamTitle });
  const teamNeeds = ui.h('p', 'home-note', S.teamNeeds);
  const teamBotStatus = ui.msgline('');
  const teamToken = ui.input({ type: 'password' });
  teamToken.placeholder = S.tokenPlaceholder;
  const teamSave = ui.button(S.save, { onClick: async () => { if (teamToken.value.trim() && await call('telegramTeamBot', [teamToken.value.trim()], teamSave)) teamToken.value = ''; } });
  const teamRemove = ui.button(S.remove, { size: 'sm', onClick: () => void call('telegramTeamBot', [''], teamRemove) });
  const teamAdmin = ui.h('div');
  teamAdmin.append(box(teamToken, teamSave), ui.h('p', 'home-note', S.teamBotHint));
  const teamBotBox = ui.h('div');
  teamBotBox.append(box(teamBotStatus, teamRemove), teamAdmin);
  const teamChat = chatRow();
  const notify = ui.select({ options: [{ value: 'always', label: S.always }, { value: 'offline', label: S.offline }, { value: 'never', label: S.never }] });
  notify.addEventListener('change', () => void call('telegramNotify', [notify.value], notify), { signal });
  const botRow = row(S.teamBotLabel, teamBotBox), chatRowEl = row(S.chatLabel, teamChat.el), notifyRow = row(S.notifyLabel, notify, S.notifyHint);
  teamSheet.body.append(teamNeeds, botRow, chatRowEl, notifyRow);
  root.append(teamSheet.el);

  function draw(next: TelegramState): void {
    if (signal.aborted) return;
    mode.value = next.mode;
    ownSheet.el.hidden = next.mode !== 'own';
    teamSheet.el.hidden = next.mode !== 'team';
    const { own, team } = next;
    botStatus.textContent = own.bot ? fill(S.botIs, { bot: own.bot }) : own.problem ? errorText(own.problem) : S.noBot;
    botStatus.classList.toggle('bad', !own.bot && !!own.problem);
    remove.hidden = !own.hasToken;
    ownChat.show(own.linked, !!own.bot);
    teamNeeds.hidden = team.ready;
    for (const r of [botRow, chatRowEl]) r.hidden = !team.ready;
    teamBotStatus.textContent = team.bot ? fill(S.botIs, { bot: team.bot }) : S.teamNoBot;
    teamRemove.hidden = !team.admin || !team.bot;
    teamAdmin.hidden = !team.admin;
    teamChat.show(team.linked, !!team.bot);
    notifyRow.hidden = !team.ready || !team.linked;
    if (team.notify) notify.value = team.notify;
  }

  const first = await invokePanel<TelegramState>(PET_PAGE, 'pet', 'telegramState', [], opts).catch(() => null);
  if (first) draw(first);
}

export const telegramPage: Page = {
  route: 'telegram',
  label: S.nav,
  icon: 'reply',
  mount,
};

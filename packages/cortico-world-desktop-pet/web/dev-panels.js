/**
 * Two of the pet page's own bubbles for programmers, placed over the body like the bot's bubble:
 *
 * - the tool kit (`createKit`, the `kit` action): a text box filled from the clipboard when it opens, the conversions
 *   of dev-kit.js as buttons, and the result with a button that copies it and one that takes it as the new text;
 * - focus blocks (`createFocus`, the `focus` action): the World's clock (src/focus.ts) shown on the action's button,
 *   the body held still through a block and asleep through its break, and a note when the block ends and when the
 *   break does.
 */
import { KIT_TOOLS, runTool } from './dev-kit.js';

const el = (doc, tag, cls, text) => {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const pill = (doc, label, primary, onClick) => {
  const b = Object.assign(el(doc, 'button', `d-pill${primary ? ' primary' : ''}`, label), { type: 'button' });
  b.addEventListener('click', onClick);
  return b;
};

/**
 * `o`: `doc`, `t`, `sfx`, `host` (the window's bridge, or null in a tab), `anchor()` (the body's bubble point, or null)
 * and `place(el, anchor)`.
 */
export function createKit(o) {
  const { doc, t } = o;
  const panel = el(doc, 'div', 'bubble kit');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  doc.body.append(panel);
  let input, out, copy, use, last = null;

  async function clipboardText() {
    try { return String(await (o.host?.readClipboard ? o.host.readClipboard() : navigator.clipboard.readText()) ?? ''); } catch { return ''; }
  }

  function build() {
    panel.innerHTML = '';
    panel.setAttribute('aria-label', t('kit.title'));
    const head = el(doc, 'div', 'kit-head');
    const close = Object.assign(el(doc, 'button', 'kit-close', '×'), { type: 'button' });
    close.setAttribute('aria-label', t('bubble.close'));
    close.addEventListener('click', () => toggle(false));
    head.append(el(doc, 'b', '', t('kit.title')), close);
    input = Object.assign(el(doc, 'textarea', 'kit-in'), { rows: 4, spellcheck: false });
    input.placeholder = t('kit.placeholder');
    input.setAttribute('aria-label', t('kit.placeholder'));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') toggle(false);
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && last) { e.preventDefault(); void run(last); }
    });
    const tools = el(doc, 'div', 'kit-tools');
    for (const id of KIT_TOOLS) {
      const b = pill(doc, t(`kit.${id}`), false, () => void run(id));
      b.dataset.tool = id;
      tools.append(b);
    }
    out = el(doc, 'pre', 'kit-out');
    out.hidden = true;
    out.setAttribute('aria-live', 'polite');
    copy = pill(doc, t('kit.copy'), true, () => {
      if (o.host?.writeClipboard) o.host.writeClipboard(out.textContent);
      else void navigator.clipboard?.writeText(out.textContent).catch(() => {});
      o.sfx.select?.();
      copy.textContent = t('kit.copied');
      setTimeout(() => { copy.textContent = t('kit.copy'); }, 1200);
    });
    use = pill(doc, t('kit.use'), false, () => { input.value = out.textContent; out.hidden = true; row.hidden = true; input.focus(); });
    const row = el(doc, 'div', 'd-row kit-row');
    row.hidden = true;
    row.append(use, copy);
    panel.append(head, input, tools, out, row);
  }

  async function run(id) {
    last = id;
    const { ok, out: text } = await runTool(id, input.value);
    out.textContent = ok ? text : t('kit.failed', { why: text });
    out.classList.toggle('bad', !ok);
    out.hidden = false;
    panel.querySelector('.kit-row').hidden = !ok;
    for (const b of panel.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === id);
  }

  /** Opens the kit with the clipboard's text, or closes it. */
  async function toggle(on = panel.hidden) {
    if (!on) { panel.hidden = true; return; }
    build();
    input.value = (await clipboardText()).slice(0, 20_000);
    panel.hidden = false;
    panel.classList.remove('pop');
    void panel.offsetWidth;
    panel.classList.add('pop');
    o.host?.focus?.();
    setTimeout(() => input.focus(), 30);
  }

  function step() {
    const a = o.anchor();
    if (!panel.hidden && a) o.place(panel, a);
  }

  return { toggle, step, get open() { return !panel.hidden; } };
}

/** Seconds a focus note stays up unanswered. */
const NOTE_SECONDS = 20;

/**
 * `o`: `doc`, `t`, `send`, `sfx`, `words()`, `act(word)` (queues a word of the body's vocabulary, as the bot's do),
 * `anchor()`, `place(el, anchor)`, and `changed()`, called when the button's look changes (a new phase, a new minute left).
 */
export function createFocus(o) {
  const { doc, t } = o;
  const note = el(doc, 'div', 'bubble note');
  note.hidden = true;
  note.setAttribute('role', 'status');
  doc.body.append(note);
  let state = null, noteUntil = 0, shownMinutes = -1;

  const has = (w) => o.words().has(w);
  const act = (...choices) => { const w = choices.find(has); if (w) o.act(w); };

  function showNote(text, buttons = []) {
    note.innerHTML = '';
    note.append(el(doc, 'div', 'b-text', text));
    if (buttons.length) {
      const row = el(doc, 'div', 'd-row');
      for (const [label, primary, run] of buttons) row.append(pill(doc, label, primary, () => { note.hidden = true; run?.(); }));
      note.append(row);
    }
    note.hidden = false;
    note.classList.remove('pop');
    void note.offsetWidth;
    note.classList.add('pop');
    noteUntil = performance.now() + NOTE_SECONDS * 1000;
  }

  /** The World's focus state (`prefs.focus`): a change of phase is shown as it happens. */
  function set(next) {
    const was = state?.phase ?? null, now = next?.phase ?? null;
    state = next && typeof next.endsAt === 'number' && (next.phase === 'focus' || next.phase === 'break') ? next : null;
    if (was === now) { o.changed(); return; }
    if (now === 'focus') {
      note.hidden = true;
      o.sfx.select?.();
      act('determined', 'nod');
    } else if (now === 'break') {
      o.sfx.alert?.();
      showNote(t('focus.break', { minutes: state.minutes }), [[t('focus.skip'), false, () => o.send({ t: 'focus', action: 'stop' })]]);
      act('sleep', 'sit');
    } else if (was === 'break') {
      o.sfx.alert?.();
      act('stand', 'jump');
      showNote(t('focus.over'), [[t('focus.later'), false], [t('focus.again'), true, () => o.send({ t: 'focus', action: 'start' })]]);
    } else if (was === 'focus') {
      note.hidden = true;
      act('stand');
    }
    shownMinutes = -1;
    o.changed();
  }

  /** Whole minutes left in the phase, at least one while it runs. */
  const minutesLeft = () => (state ? Math.max(1, Math.ceil((state.endsAt - Date.now()) / 60_000)) : 0);

  function step() {
    if (!note.hidden && performance.now() > noteUntil) note.hidden = true;
    const a = o.anchor();
    if (!note.hidden && a) o.place(note, a);
    const m = minutesLeft();
    if (m !== shownMinutes) { shownMinutes = m; o.changed(); }
  }

  return {
    set, step,
    /** The body stays where it is through a block and its break. */
    get still() { return !!state; },
    get phase() { return state?.phase ?? null; },
    minutesLeft,
    /** The action's click: starts a block, or stops the one running. */
    toggle() { o.send({ t: 'focus', action: state ? 'stop' : 'start' }); },
  };
}

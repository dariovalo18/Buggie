/**
 * The pet page's bugs and its offers: to explain a copied error, and, while the team server is connected, to explain a
 * clicked bug or open a ticket for it.
 *
 * Bugs: each problem of a failed build or test run (src/bugs.ts) is a pixel ladybug crawling on the floor, coming in
 * from the nearest edge and scurrying off when the body comes close. Clicking one asks the bot to explain it
 * (`{ t: 'bug', id }`). A fixed bug freezes; the body runs to each fixed one in turn, nearest first, and eats it. One
 * not reached within CHASE_SECONDS is eaten where it stands. A body whose vocabulary has `zap` (the Little Star) goes
 * to ZAP_RANGE short of it instead, does `zap` and casts three lights at it: hit, it runs off the screen or burns up.
 *
 * Offer: copied text that looks like an error (dev-errors.js) brings a small bubble over the body, once the body's
 * own bubble is free, with a button that sends the text to the bot (`{ t: 'explain', text }`) and one that drops it.
 * Nothing is sent before the button is pressed.
 */
import { CLIP_MAX, looksLikeError } from './dev-errors.js';

/** Most bugs drawn at once; the World keeps the rest. */
const SHOWN = 12;
/** A bug's side at body scale 1 (`bounds().S` .42), and its crawl speed range, in pixels a second at that scale. */
const SIZE = 26, SPEED = [14, 30];
/** How near the body (past its half width) a live bug scurries off, and how near a fixed one is eaten. */
const SHY = 30, BITE = 18;
const CHASE_SECONDS = 4;
/** How far from a fixed bug a body that zaps stops to cast, in pixels at body scale 1 (`bounds().S` .42). */
const ZAP_RANGE = 150;
/** How far in from its edge a bug comes before it starts to wander, as a share of the stage's width. */
const COME_IN = [.12, .4];
/** Seconds an offer stays up unanswered, and how long a copied error waits for the body's bubble to be free. */
const OFFER_SECONDS = 15, OFFER_WAIT = 30;

// a pixel ladybug, 9 × 8: r red, d dark
const LADYBUG = [
  '..d...d..',
  '...ddd...',
  '.rrrdrrr.',
  'rrdrdrdrr',
  'rrrrdrrrr',
  '.rdrdrdr.',
  '..rrdrr..',
  '.d.....d.',
];
const SPRITE = (() => {
  let rects = '';
  LADYBUG.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '.') rects += `<rect x="${x}" y="${y}" width="1" height="1" class="${c === 'r' ? 'lb-r' : 'lb-d'}"/>`;
  }));
  return `<svg viewBox="0 0 9 8" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
})();

const rnd = (a, b) => a + Math.random() * (b - a);

/**
 * `o`: `doc`, `send(msg)`, `sfx`, `t(key, vars)`, and what it reads of the page each frame: `body()` (body-host.js),
 * `words()` (the body's vocabulary by id), `bounds()` ({ W, floorY, S }), `free()` (no bubble, question or dialog of
 * the bot's is up) and `place(el, anchor)` (puts a bubble over the body's anchor point).
 */
export function createDevBugs(o) {
  const { doc } = o;
  const layer = doc.createElement('div');
  layer.className = 'code-bugs';
  doc.body.append(layer);
  /** id → { id, el, x, dir, speed, fixed, problem } */
  const bugs = new Map();
  let chase = null, ate = 0, T = 0;

  const offer = doc.createElement('div');
  offer.className = 'bubble offer';
  offer.hidden = true;
  offer.setAttribute('role', 'dialog');
  doc.body.append(offer);
  let copied = null, copiedAt = 0, offerUntil = 0;
  /** Signed in to the team server (`prefs.team`): a click asks between explaining and a ticket. */
  let team = false;
  /** The offer up came from a click: it stays while the bot talks. */
  let clicked = false;

  const sizeNow = () => Math.max(14, SIZE * o.bounds().S / .42);
  const say = (p) => (p.file ? `${p.file}${p.line ? `:${p.line}` : ''}\n${p.message}` : p.message);

  function spawn(p) {
    const { W } = o.bounds();
    const fromLeft = Math.random() < .5;
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'code-bug';
    el.innerHTML = SPRITE;
    el.title = say(p);
    el.setAttribute('aria-label', o.t('bugs.label', { problem: say(p).replace('\n', ' ') }));
    const bug = { id: p.id, el, x: fromLeft ? -sizeNow() : W + sizeNow(), dir: fromLeft ? 1 : -1, speed: rnd(...SPEED), fixed: false, until: rnd(1.5, 4), problem: p,
      goal: fromLeft ? rnd(...COME_IN) * W : W - rnd(...COME_IN) * W };
    el.addEventListener('click', () => {
      if (bug.fixed) return;
      if (team) openOffer(o.t('bugs.choose', { problem: bug.problem.message }), [[o.t('bugs.ticket'), false, () => o.send({ t: 'ticket', id: bug.id })], [o.t('clip.explain'), true, () => o.send({ t: 'bug', id: bug.id })]], true);
      else o.send({ t: 'bug', id: bug.id });
      o.sfx.select?.();
      el.classList.remove('picked');
      void el.offsetWidth;
      el.classList.add('picked');
    });
    layer.append(el);
    bugs.set(p.id, bug);
  }

  /** A fixed bug is done with: eaten, burnt up, or run off the screen (`how`, the class its sprite leaves with). */
  function eat(bug, how = 'eaten') {
    bugs.delete(bug.id);
    bug.el.classList.add(how);
    bug.el.disabled = true;
    setTimeout(() => bug.el.remove(), how === 'burnt' ? 1000 : 320);
    if (how !== 'gone') o.sfx.pop?.();
    ate++;
    if (chase === bug) chase = null;
    if (![...bugs.values()].some((b) => b.fixed) && ate) {
      const w = o.words();
      const cheer = ['happy', 'excited', 'jump'].find((x) => w.has(x));
      if (cheer) o.body()?.do(cheer);
      o.sfx.sparkle?.();
      ate = 0;
    }
  }

  /** The World's bugs: those not on the page come in, those `fixed` are hunted, any other one gone leaves at once. */
  function set(list, fixed = []) {
    const want = new Map((Array.isArray(list) ? list : []).slice(0, SHOWN).map((b) => [b.id, b]));
    const doomed = new Set(fixed);
    for (const bug of bugs.values()) {
      if (want.has(bug.id)) continue;
      if (doomed.has(bug.id)) { if (bug.fate) continue; bug.fixed = true; bug.el.classList.add('fixed'); bug.el.title = ''; }
      else { bugs.delete(bug.id); bug.el.remove(); }
    }
    for (const p of want.values()) if (!bugs.has(p.id)) spawn(p);
  }

  function crawl(bug, dt, l, W) {
    const k = sizeNow() / SIZE, margin = sizeNow();
    // coming in from off screen it heads straight in; once in, it wanders, runs from the body and turns at the edges
    if (!bug.entered) {
      bug.dir = bug.x < bug.goal ? 1 : -1;
      bug.x += bug.dir * SPEED[1] * 2 * k * dt;
      if ((bug.dir > 0) === (bug.x >= bug.goal)) bug.entered = true;
      return;
    }
    bug.until -= dt;
    if (bug.until <= 0) { bug.dir = Math.random() < .5 ? -1 : 1; bug.speed = rnd(...SPEED); bug.until = rnd(1.5, 4); }
    let speed = bug.speed;
    if (l) {
      const half = (l.box?.w ?? 100) / 2, d = bug.x - l.x;
      if (Math.abs(d) < half + SHY * k) { bug.dir = d < 0 ? -1 : 1; speed *= 2.6; }
    }
    bug.x += bug.dir * speed * k * dt;
    if (bug.x < margin || bug.x > W - margin) { bug.dir = bug.x < margin ? 1 : -1; bug.x = Math.max(margin, Math.min(W - margin, bug.x)); }
  }

  /** A body with the word `zap` (the Little Star) shoots lights at fixed bugs from ZAP_RANGE away instead of eating them. */
  const zapper = () => o.words().has('zap');
  /** Lights in flight: { el, x0, y0, bug, age, life }. */
  const lights = [];

  function hunt(l) {
    if (chase && !bugs.has(chase.id)) chase = null;
    if (!chase) {
      const doomed = [...bugs.values()].filter((b) => b.fixed && !b.zapped);
      if (!doomed.length || !l || l.busy || !o.free()) return;
      chase = doomed.reduce((a, b) => (Math.abs(b.x - l.x) < Math.abs(a.x - l.x) ? b : a));
      chase.since = T;
      // one fixed before it was all the way in is eaten where the body can reach
      chase.x = Math.max(sizeNow(), Math.min(o.bounds().W - sizeNow(), chase.x));
      const range = zapper() ? ZAP_RANGE * o.bounds().S / .42 : 0;
      const side = l.x < chase.x ? -1 : 1, W = o.bounds().W;
      const to = Math.max(0, Math.min(W, chase.x + side * range));
      o.body()?.walk(to, !range, `bug-${chase.id}`);
      chase.from = to;
      return;
    }
    const near = Math.abs(l.x - chase.from) < (l.box?.w ?? 100) / 4 + BITE;
    if (!near && T - chase.since <= CHASE_SECONDS) return;
    if (!zapper()) { eat(chase); return; }
    zap(chase, l);
    chase = null;
  }

  /** Casts lights at a fixed bug; the first to land sends it off the screen or burns it up. */
  function zap(bug, l) {
    bug.zapped = true;
    o.body()?.do('zap');
    const b = l.box, x0 = l.facing > 0 ? b.x + b.w * .85 : b.x + b.w * .15, y0 = b.y + b.h * .4;
    for (let i = 0; i < 3; i++) {
      const el = doc.createElement('div');
      el.className = 'code-zap';
      el.innerHTML = '<svg viewBox="-10 -10 20 20" aria-hidden="true"><path d="M0 -10L2.8 -2.8L10 0L2.8 2.8L0 10L-2.8 2.8L-10 0L-2.8 -2.8Z"/></svg>';
      layer.append(el);
      lights.push({ el, x0, y0, bug, age: -.55 - i * .12, life: .32, lift: rnd(30, 70) * (i % 2 ? 1 : -.4) });
    }
  }

  function stepLights(dt) {
    const { floorY } = o.bounds(), size = sizeNow();
    for (let i = lights.length - 1; i >= 0; i--) {
      const p = lights[i];
      p.age += dt;
      const k = Math.max(0, p.age) / p.life, x1 = p.bug.x, y1 = floorY - size / 2;
      // an arc from the body's front point down to the bug
      const x = p.x0 + (x1 - p.x0) * k, y = p.y0 + (y1 - p.y0) * k - p.lift * Math.sin(Math.PI * Math.min(1, k));
      p.el.style.opacity = p.age < 0 ? '0' : '1';
      p.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(p.age * 720).toFixed(0)}deg)`;
      if (k < 1) continue;
      p.el.classList.add('hit');
      setTimeout(() => p.el.remove(), 300);
      lights.splice(i, 1);
      const bug = p.bug;
      if (!bugs.has(bug.id) || bug.fate) continue;
      // some run for the nearest edge, the rest burn up where they stand
      bug.fate = Math.random() < .5 ? 'flee' : 'burn';
      if (bug.fate === 'burn') { eat(bug, 'burnt'); continue; }
      bug.el.classList.remove('fixed');
      bug.el.classList.add('fleeing');
      bug.dir = bug.x < o.bounds().W / 2 ? -1 : 1;
    }
  }

  function flee(bug, dt) {
    bug.x += bug.dir * SPEED[1] * 7 * (sizeNow() / SIZE) * dt;
    if (bug.x < -sizeNow() * 2 || bug.x > o.bounds().W + sizeNow() * 2) eat(bug, 'gone');
  }

  function step(dt) {
    T += dt;
    const { W, floorY } = o.bounds(), l = o.body()?.layout ?? null, size = sizeNow();
    for (const bug of bugs.values()) {
      if (bug.fate === 'flee') flee(bug, dt);
      else if (!bug.fixed) crawl(bug, dt, l, W);
      const s = bug.el.style;
      s.width = s.height = `${size}px`;
      s.transform = `translate(${(bug.x - size / 2).toFixed(1)}px, ${(floorY - size).toFixed(1)}px) scaleX(${bug.dir})`;
    }
    hunt(l);
    stepLights(dt);
    stepOffer(l);
  }

  /* ---------- the offer ---------- */

  function clipboard(text) {
    if (!looksLikeError(text)) return;
    copied = text.trim().slice(0, CLIP_MAX);
    copiedAt = T;
    if (!offer.hidden) closeOffer();
  }

  /** Shows `text` with `choices` ([label, primary, act]) and a dismiss button; a choice nods and closes it. */
  function openOffer(text, choices, fromClick = false) {
    clicked = fromClick;
    offer.innerHTML = '';
    const msg = doc.createElement('div');
    msg.className = 'b-text';
    msg.textContent = text;
    const row = doc.createElement('div');
    row.className = 'd-row';
    const button = (label, primary, act) => {
      const b = Object.assign(doc.createElement('button'), { type: 'button', className: `d-pill${primary ? ' primary' : ''}`, textContent: label });
      b.addEventListener('click', act);
      return b;
    };
    row.append(button(o.t('clip.dismiss'), false, closeOffer), ...choices.map(([label, primary, act]) => button(label, primary, () => {
      act();
      if (o.words().has('nod')) o.body()?.do('nod');
      closeOffer();
    })));
    offer.append(msg, row);
    offer.hidden = false;
    offer.classList.remove('pop');
    void offer.offsetWidth;
    offer.classList.add('pop');
    o.sfx.pop?.();
    offerUntil = T + OFFER_SECONDS;
  }

  function offerCopied() {
    const text = copied;
    copied = null;
    openOffer(o.t('clip.offer'), [[o.t('clip.explain'), true, () => o.send({ t: 'explain', text })]]);
  }

  function closeOffer() { offer.hidden = true; }

  function stepOffer(l) {
    if (copied && T - copiedAt > OFFER_WAIT) copied = null;
    if (!offer.hidden && ((!clicked && !o.free()) || T > offerUntil)) closeOffer();
    if (copied && offer.hidden && l && o.free()) offerCopied();
    if (!offer.hidden && l?.bubble) o.place(offer, l.bubble);
  }

  return { set, step, clipboard, closeOffer, setTeam(on) { team = on; } };
}

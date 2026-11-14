/**
 * The Little Star, a built-in figure (pack id `star`): a puffy five-pointed star with a face in the middle and two
 * short legs, in one of a few colours (`SCHEMES`, the pack's one axis). figure.js here builds the kit's body on it;
 * `starSvg` draws a still one for the dressing page's thumbnails (scripts/star-thumbs.mjs).
 *
 * Coordinates: logo units, facing right, ground at y=256 (the kit's space, web/kit/body.js).
 */
import { DROP, LEG_W, STAND, f, heartD } from '../kit/body.js';

/** fill, outline, cheeks, irises, the mouth's inside and the accent (marks over the head, sleep z's). */
export const SCHEMES = {
  gold:  { fill: '#FFD34D', shade: '#F5B92E', line: '#6B3F12', blush: '#FF9A7A', iris: '#3A2412', mouth: '#7A2E1F', accent: '#F2A900' },
  pink:  { fill: '#FFB8D6', shade: '#F592BC', line: '#6E2148', blush: '#FF7FA8', iris: '#4A1630', mouth: '#7A1F45', accent: '#F25C9A' },
  sky:   { fill: '#A6DCFF', shade: '#7EC4F2', line: '#1C3F6E', blush: '#FF9DB8', iris: '#132A4A', mouth: '#5A1F4A', accent: '#2E9BEF' },
  mint:  { fill: '#A8F0CF', shade: '#7EDDB4', line: '#17533D', blush: '#FF9DB0', iris: '#123A2B', mouth: '#5A1F3A', accent: '#1FBF83' },
  night: { fill: '#C2B0FF', shade: '#A28CF2', line: '#2A1C66', blush: '#FF9DD0', iris: '#1E1450', mouth: '#4A1F5A', accent: '#7C5CF0' },
};
export const SCHEME_IDS = Object.keys(SCHEMES);
const schemeOf = (id) => SCHEMES[id] ?? SCHEMES.gold;

/** The star's centre and its outer and inner radii; its lower points end just above the feet. */
const CX = 128, CY = 140, RO = 112, RI = 56;
const EYES = [[106, 138], [152, 138]];
const MOUTH = [130, 166];
/** How the eyes of the kit's faces (made for a bigger head) are scaled. */
const EYE_K = 1.05;

/** The star's outline, points rounded by the stroke and edges bulging a little; `lift` raises the side points (arms). */
function starPath(lift = 0) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? RI : RO;
    const side = i === 2 || i === 8 ? lift * (i === 2 ? 1 : -1) : 0;
    pts.push([CX + r * Math.cos(a + side), CY + r * Math.sin(a + side)]);
  }
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < 10; i++) {
    const p = pts[i], q = pts[(i + 1) % 10];
    // the edge's middle pushed outward from the centre
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, k = 1 + 7 / Math.hypot(mx - CX, my - CY);
    d += `Q${f(CX + (mx - CX) * k)} ${f(CY + (my - CY) * k)} ${f(q[0])} ${f(q[1])}`;
  }
  return d + 'Z';
}

const line = (c, w) => `stroke="${c}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

function eye(e, cx, cy, blink, c, lx, ly) {
  const L = line(c.line, 5);
  if (e.shape === 'ring') {
    const rx = e.rx * EYE_K * .78, ry = e.ry * EYE_K * (1 - blink);
    cx += (e.dx || 0) * EYE_K; cy += (e.dy || 0) * EYE_K;
    if (ry < 2.5) return `<path fill="none" ${line(c.line, 5)} d="M${f(cx - rx)} ${f(cy)}L${f(cx + rx)} ${f(cy)}"/>`;
    const ix = cx + lx * .2, iy = cy + ly * .2;
    return `<ellipse fill="${c.iris}" cx="${f(ix)}" cy="${f(iy)}" rx="${f(rx)}" ry="${f(ry)}"/>` +
      `<circle fill="#FFFFFF" cx="${f(ix - rx * .3)}" cy="${f(iy - ry * .35)}" r="${f(Math.min(rx, ry) * .36)}"/>` +
      `<circle fill="#FFFFFF" cx="${f(ix + rx * .3)}" cy="${f(iy + ry * .3)}" r="${f(Math.min(rx, ry) * .16)}"/>`;
  }
  if (e.shape === 'lid') {
    const R = 12, ry = e.ry * (1 - blink);
    cx += (e.dx || 0); cy += (e.dy || 0);
    const lid = `<path fill="none" ${L} d="M${f(cx - R)} ${f(cy)}L${f(cx + R)} ${f(cy)}"/>`;
    if (ry < 2.5) return lid;
    return `<path fill="${c.iris}" d="M${f(cx - R)} ${f(cy)}A${f(R)} ${f(ry)} 0 0 0 ${f(cx + R)} ${f(cy)}Z"/>` + lid;
  }
  const s = .8;
  const at = (d) => `transform="translate(${f(cx)} ${f(cy)}) scale(${s}) translate(${f(-cx)} ${f(-cy)})"`;
  switch (e.shape) {
    case 'up': return `<path fill="none" ${line(c.line, 6)} ${at()} d="M${f(cx - 14)} ${f(cy + 6)}Q${f(cx)} ${f(cy - 15)} ${f(cx + 14)} ${f(cy + 6)}"/>`;
    case 'down': return `<path fill="none" ${line(c.line, 6)} ${at()} d="M${f(cx - 14)} ${f(cy - 3)}Q${f(cx)} ${f(cy + 13)} ${f(cx + 14)} ${f(cy - 3)}"/>`;
    case 'gt': return `<path fill="none" ${line(c.line, 6)} ${at()} d="M${f(cx - 9)} ${f(cy - 12)}L${f(cx + 10)} ${f(cy)}L${f(cx - 9)} ${f(cy + 12)}"/>`;
    case 'lt': return `<path fill="none" ${line(c.line, 6)} ${at()} d="M${f(cx + 9)} ${f(cy - 12)}L${f(cx - 10)} ${f(cy)}L${f(cx + 9)} ${f(cy + 12)}"/>`;
    case 'heart': return `<path fill="#FF5C8A" ${line(c.line, 3.5)} ${at()} d="${heartD(cx, cy, e.s)}"/>`;
    case 'spiral': {
      let d = '';
      for (let i = 0; i <= 40; i++) {
        const a = Math.PI * 4 * i / 40, r = 2 + 12 * i / 40;
        d += (i ? 'L' : 'M') + f(cx + r * Math.cos(a + e.rot)) + ' ' + f(cy + r * Math.sin(a + e.rot));
      }
      return `<path fill="none" ${line(c.line, 3.5)} d="${d}"/>`;
    }
  }
  return '';
}

function mouth(fc, c) {
  const [MX, MY] = MOUTH;
  const k = Math.max(0, Math.min(1, ((fc.gap[0] + fc.gap[1]) / 2 - 30) / 34));
  const w = 9 + 5 * k, open = Math.max(0, k - .45) * 26;
  if (fc.brows === 'sad' && k < .4) return `<path fill="none" ${line(c.line, 4.5)} d="M${f(MX - w)} ${MY + 4}Q${MX} ${MY - 4} ${f(MX + w)} ${MY + 4}"/>`;
  if (open < 2.5) return `<path fill="none" ${line(c.line, 4.5)} d="M${f(MX - w)} ${MY}Q${MX} ${MY + 9} ${f(MX + w)} ${MY}"/>`;
  return `<path fill="${c.mouth}" ${line(c.line, 4)} d="M${f(MX - w)} ${MY}Q${MX} ${f(MY + 5 + open * 1.5)} ${f(MX + w)} ${MY}Q${MX} ${MY + 2} ${f(MX - w)} ${MY}Z"/>` +
    `<ellipse fill="#FF7A9C" cx="${MX + 1}" cy="${f(MY + 2 + open * .8)}" rx="${f(w * .45)}" ry="${f(open * .3)}"/>`;
}

/** One frame as SVG markup, in logo units; `fc` is the kit's face and `o` the frame. */
export function starFrame(fc, o, scheme) {
  const c = schemeOf(scheme);
  const t = o.t, [lx, ly] = o.look, sw = o.swing || 0;
  let s = '<g>';
  // legs behind the star: outline, then fill
  for (const l of o.legs) {
    const d = `M${f(l[0])} ${f(l[1])}L${f(l[2])} ${f(l[3])}`;
    s += `<path fill="none" stroke="${c.line}" stroke-width="${LEG_W - 2}" stroke-linecap="round" d="${d}"/>`;
    s += `<path fill="none" stroke="${c.shade}" stroke-width="${LEG_W - 12}" stroke-linecap="round" d="${d}"/>`;
  }
  s += `<g transform="translate(0 ${f(o.low)})">`;
  const d = starPath(Math.max(-.12, Math.min(.12, sw * .006)));
  // the outline as a wide stroke under the fill rounds the points
  s += `<path fill="${c.line}" ${line(c.line, 22)} d="${d}"/>`;
  s += `<path fill="${c.fill}" ${line(c.fill, 12)} d="${d}"/>`;
  // shading on the lower right and a shine on the upper left
  s += `<path fill="${c.shade}" opacity=".55" d="M${CX + 8} ${CY + 30}Q${CX + 50} ${CY + 20} ${CX + 62} ${CY - 6}Q${CX + 66} ${CY + 40} ${CX + 30} ${CY + 58}Z"/>`;
  s += `<ellipse fill="#FFFFFF" opacity=".55" transform="translate(${CX - 34} ${CY - 34}) rotate(-35)" rx="15" ry="7"/>`;
  s += `<circle fill="#FFFFFF" opacity=".7" cx="${CX - 10}" cy="${CY - 72}" r="4.5"/>`;
  const blush = .35 + .65 * (fc.blush || 0);
  s += `<g fill="${c.blush}" opacity="${f(blush * .8)}"><ellipse cx="${f(EYES[0][0] - 12 + lx * .5)}" cy="160" rx="10" ry="5.5"/><ellipse cx="${f(EYES[1][0] + 12 + lx * .5)}" cy="160" rx="10" ry="5.5"/></g>`;
  s += `<g transform="translate(${f(lx * .4)} ${f(ly * .3)})">${mouth(fc, c)}</g>`;
  const close = o.eyeClose || 0;
  fc.eyes.forEach((e, i) => {
    const cx = EYES[i][0] + lx * .7, cy = EYES[i][1] + ly * .7;
    const tr = close > .01 ? ` transform="translate(0 ${f(cy)}) scale(1 ${f(Math.max(.08, 1 - close) * 100) / 100}) translate(0 ${f(-cy)})"` : '';
    s += `<g${tr}>${eye(e, cx, cy, o.blink || 0, c, lx, ly)}</g>`;
  });
  if (fc.brows) {
    const bx = lx * .4, by = ly * .3, [[x0, y0], [x1]] = EYES, top = y0 - 22;
    const b = fc.brows === 'angry'
      ? `M${f(x0 - 12 + bx)} ${f(top - 4 + by)}L${f(x0 + 9 + bx)} ${f(top + 3 + by)}M${f(x1 - 9 + bx)} ${f(top + 3 + by)}L${f(x1 + 12 + bx)} ${f(top - 4 + by)}`
      : `M${f(x0 - 12 + bx)} ${f(top + 2 + by)}L${f(x0 + 9 + bx)} ${f(top - 4 + by)}M${f(x1 - 9 + bx)} ${f(top - 4 + by)}L${f(x1 + 12 + bx)} ${f(top + 2 + by)}`;
    s += `<path fill="none" ${line(c.line, 5.5)} d="${b}"/>`;
  }
  const A = c.accent, mark = (w) => `fill="none" stroke="${A}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
  if (fc.orbit) {
    for (let i = 0; i < 3; i++) {
      const a = t * 3.2 + i * 2.094, sn = Math.sin(a);
      s += `<circle ${mark(4)} cx="${f(128 + 56 * Math.cos(a))}" cy="${f(14 + 10 * sn)}" r="${sn < 0 ? 4 : 6}" opacity="${sn < 0 ? .55 : 1}"/>`;
    }
  }
  if (fc.listen) {
    for (let i = 0; i < 3; i++) {
      const p = (t * .9 + i / 3) % 1, r = 40 - 26 * p;
      s += `<path ${mark(6)} opacity="${f(Math.sin(Math.PI * p))}" d="M${f(200 + r * Math.cos(-.55))} ${f(116 + r * Math.sin(-.55))}A${f(r)} ${f(r)} 0 0 1 ${f(200 + r * Math.cos(.55))} ${f(116 + r * Math.sin(.55))}"/>`;
    }
  }
  if (fc.think) {
    for (let i = 0; i < 3; i++) {
      const k = (t * .8 + i / 3) % 1;
      s += `<circle ${mark(4.5)} cx="${f(196 + 10 * i)}" cy="${f(52 - 18 * i - 5 * k)}" r="${3 + 3 * i}" opacity="${f(.4 + .6 * Math.sin(Math.PI * k))}"/>`;
    }
  }
  if (fc.sweat) s += `<path class="tearf" transform="translate(70 ${f(96 + 3 * Math.sin(t * 7))}) scale(1.2)" d="${DROP}"/>`;
  if (fc.anger) {
    const k = 1 + .12 * Math.sin(t * 10);
    s += `<g class="angry" transform="translate(196 52) scale(${f(k * 10) / 10})" fill="none" stroke-width="6" stroke-linecap="round"><path d="M-12 -4Q-4 -4 -4 -12M4 -12Q4 -4 12 -4M12 4Q4 4 4 12M-4 12Q-4 4 -12 4"/></g>`;
  }
  if (fc.bang) s += `<g transform="translate(204 40)"><path fill="none" stroke="${c.line}" stroke-width="10" stroke-linecap="round" d="M0 -16V4"/><circle fill="${c.line}" cx="0" cy="17" r="5"/></g>`;
  if (fc.question) s += `<g transform="translate(204 40)"><path fill="none" stroke="${c.line}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" d="M-9 -11Q-9 -22 0 -22Q10 -22 10 -12Q10 -5 0 -1V5"/><circle fill="${c.line}" cx="0" cy="17" r="5"/></g>`;
  if (fc.sparkle) {
    EYES.forEach(([ex, ey], i) => {
      const k = .7 + .3 * Math.sin(t * 7 + i * 2);
      s += `<path fill="#FFFFFF" transform="translate(${f(ex + lx * .7)} ${f(ey + ly * .7)}) scale(${f(k)})" d="M0 -9L2.5 -2.5L9 0L2.5 2.5L0 9L-2.5 2.5L-9 0L-2.5 -2.5Z"/>`;
    });
  }
  if (fc.streams) {
    EYES.forEach(([ex, ey], i) => {
      const w = 2 * Math.sin(t * 6 + i), x = ex + lx * .7;
      s += `<path class="tearf" opacity=".75" d="M${f(x - 4)} ${f(ey + 5)}Q${f(x - 6 + w)} ${f(ey + 24)} ${f(x - 3)} ${f(ey + 42)}L${f(x + 4)} ${f(ey + 42)}Q${f(x + 3 + w)} ${f(ey + 24)} ${f(x + 4)} ${f(ey + 5)}Z"/>`;
    });
  }
  // a small twinkle that comes and goes beside the top point
  const tw = Math.max(0, Math.sin(t * 1.3)) ** 6;
  if (tw > .05) s += `<path fill="${A}" opacity="${f(tw)}" transform="translate(172 34) scale(${f(.5 + .5 * tw)})" d="M0 -10L3 -3L10 0L3 3L0 10L-3 3L-10 0L-3 -3Z"/>`;
  if (o.zmark) s += `<path ${mark(5.5)} d="M196 30H210L196 48H210M216 12H225L216 23H225"/>`;
  return s + '</g></g>';
}

/** A still star standing in `scheme`, as a whole SVG document: the thumbnails. */
export function starSvg(scheme) {
  const face = { gap: [58, 58], eyes: [{ shape: 'ring', rx: 16, ry: 16 }, { shape: 'ring', rx: 16, ry: 16 }], blush: .45 };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 8 248 252" width="248" height="252">${starFrame(face, { look: [0, 0], legs: STAND, low: 0, t: 0, blink: 0 }, scheme)}</svg>\n`;
}

/** The star as the kit's figure (createBody's `opts.figure`). */
export function starFigure(scheme) {
  let current = SCHEMES[scheme] ? scheme : 'gold';
  let drawn = '';
  return {
    draw(petG, face, frame) {
      const s = starFrame(face, frame, current);
      if (s === drawn && petG.firstChild) return;
      petG.innerHTML = s;
      drawn = s;
    },
    setScheme(id) { if (SCHEMES[id]) current = id; },
    get colors() { return { z: schemeOf(current).accent }; },
    get anchors() { return { tears: [[EYES[0][0], 150], [EYES[1][0], 150]], bubble: [146, 16] }; },
    get extent() { return [12, 18, 244, 256]; },
  };
}

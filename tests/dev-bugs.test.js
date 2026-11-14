import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createDevBugs } from '../packages/cortico-world-desktop-pet/web/dev-bugs.js';

const problem = { id: 'b1', file: 'src/a.ts', line: 3, message: 'x is not a function' };

/** The bugs on a bare page, with a body that is wherever it was last sent and knows `words`. */
function bugsWith(words) {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const did = [], walked = [];
  const body = {
    layout: { x: 200, facing: 1, busy: false, box: { x: 150, y: 250, w: 100, h: 150 } },
    walk(x, run) { walked.push({ x, run }); body.layout.x = x; },
    do(w) { did.push(w); },
  };
  const dev = createDevBugs({
    doc, send() {}, sfx: {}, t: (k) => k, body: () => body, words: () => new Set(words), place() {},
    bounds: () => ({ W: 1000, floorY: 400, S: .42 }), free: () => true,
  });
  const run = (seconds) => { for (let i = 0; i < seconds * 60; i++) dev.step(1 / 60); };
  return { doc, dev, did, walked, run, bug: () => doc.querySelector('.code-bug') };
}

afterEach(() => vi.restoreAllMocks());

describe('fixed bugs', () => {
  it('a body that eats runs up to a fixed bug and eats it', () => {
    const s = bugsWith(['happy']);
    s.dev.set([problem]);
    s.run(3);
    s.dev.set([], ['b1']);
    s.run(.2);
    expect(s.walked.at(-1).run).toBe(true);
    expect(s.bug().classList.contains('eaten')).toBe(true);
    expect(s.did).toContain('happy');
  });

  it('the Little Star stops short of a fixed bug, casts lights at it, and the bug runs off the screen or burns up', () => {
    for (const [roll, ends] of [[.2, 'gone'], [.8, 'burnt']]) {
      const s = bugsWith(['happy', 'zap']);
      s.dev.set([problem]);
      s.run(3);
      s.dev.set([], ['b1']);
      s.run(.1);
      const at = s.walked.at(-1);
      expect(at.run).toBe(false);
      expect(s.did).toEqual(['zap']);
      expect(s.doc.querySelectorAll('.code-zap')).toHaveLength(3);
      vi.spyOn(Math, 'random').mockReturnValue(roll);
      s.run(4);
      expect(s.bug().classList.contains(ends), ends).toBe(true);
      // the cheer once no fixed bug is left
      expect(s.did).toEqual(['zap', 'happy']);
      vi.restoreAllMocks();
    }
  });
});

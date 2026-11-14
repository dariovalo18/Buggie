/**
 * The Little Star pack's entry (figure.json here): the kit's body (web/kit/body.js) drawn by starFigure, in the
 * colour the pack's one axis picks (`scheme`). Its own words `zap` (casting a light) and `soar` (rising straight up
 * and coming back down) are gestures the figure draws (frame.gesture).
 */
import { starFigure } from './star.js';

export function createStarBody(base, { kit, host, scheme }) {
  return kit.createBody(host, {
    figure: starFigure(scheme),
    words: {
      zap: { motion: { seconds: 1.1, face: 'determined', sound: 'sparkle' } },
      soar: { motion: { seconds: 3.4, face: 'happy', sound: 'whoosh' } },
    },
  });
}

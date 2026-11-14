/**
 * The Little Star pack's entry (figure.json here): the kit's body (web/kit/body.js) drawn by starFigure, in the
 * colour the pack's one axis picks (`scheme`).
 */
import { starFigure } from './star.js';

export function createStarBody(base, { kit, host, scheme }) {
  return kit.createBody(host, { figure: starFigure(scheme), hunt: true, words: { hunt: { motion: { seconds: 8 } } } });
}

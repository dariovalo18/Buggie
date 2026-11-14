// Writes the Little Star's thumbnails (web/star/thumbs/<colour>.svg) from its drawing: run after changing web/star/star.js.
import { mkdirSync, writeFileSync } from 'node:fs';
import { SCHEME_IDS, starSvg } from '../web/star/star.js';

const dir = new URL('../web/star/thumbs/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const id of SCHEME_IDS) writeFileSync(new URL(`${id}.svg`, dir), starSvg(id));
console.log(`thumbs: ${SCHEME_IDS.join(' ')}`);

import type { en } from './strings.ts';

export const S: Partial<typeof en> = {
  title: 'Wecker',
  desc: 'Wecker, die Buggie gestellt hat. Buggie erfährt es, wenn du hier einen löschst.',
  setAt: 'Gestellt am',
  daily: 'Täglich',
  empty: 'Buggie hat keine Wecker gestellt.',
  remove: 'Löschen',
  confirmTitle: (when) => `Wecker für ${when} löschen?`,
  failed: (msg) => `Löschen fehlgeschlagen: ${msg}`,
  loadFailed: (msg) => `Laden fehlgeschlagen: ${msg}`,
  search: 'Notiz oder Uhrzeit suchen',
  noMatch: 'Kein Wecker passt.',
  perPage: 'Pro Seite',
  shown: (from: number, to: number, total: number) => `${from}–${to} von ${total}`,
  prevPage: '‹ Zurück',
  nextPage: 'Weiter ›',
};

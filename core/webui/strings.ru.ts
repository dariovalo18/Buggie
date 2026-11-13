import type { en } from './strings.ts';

export const S: Partial<typeof en> = {
  title: 'Будильники',
  desc: 'Будильники, которые поставил Buggie. Если удалить будильник здесь, Buggie получит уведомление.',
  setAt: 'Поставлен',
  daily: 'Каждый день',
  empty: 'У Buggie нет будильников.',
  remove: 'Удалить',
  confirmTitle: (when) => `Удалить будильник на ${when}?`,
  failed: (msg) => `Не удалось удалить: ${msg}`,
  loadFailed: (msg) => `Не удалось загрузить: ${msg}`,
  search: 'Поиск по тексту или времени',
  noMatch: 'Подходящих будильников нет.',
  perPage: 'На странице',
  shown: (from: number, to: number, total: number) => `${from}–${to} из ${total}`,
  prevPage: '‹ Назад',
  nextPage: 'Вперёд ›',
};

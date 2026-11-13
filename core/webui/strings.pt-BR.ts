import type { en } from './strings.ts';

export const S: Partial<typeof en> = {
  title: 'Alarmes',
  desc: 'Alarmes que o Buggie definiu. O Buggie é avisado quando você exclui um aqui.',
  setAt: 'Criado em',
  daily: 'Diário',
  empty: 'O Buggie não tem alarmes.',
  remove: 'Excluir',
  confirmTitle: (when) => `Excluir o alarme de ${when}?`,
  failed: (msg) => `Não foi possível excluir: ${msg}`,
  loadFailed: (msg) => `Não foi possível carregar: ${msg}`,
  search: 'Buscar notas ou horários',
  noMatch: 'Nenhum alarme corresponde.',
  perPage: 'Por página',
  shown: (from: number, to: number, total: number) => `${from}–${to} de ${total}`,
  prevPage: '‹ Anterior',
  nextPage: 'Próxima ›',
};

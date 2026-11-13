import { buggieLettering } from '../branding.ts';
import { buggieMark, christmasHat } from '../base/ui/icons.ts';

/** Buggie's mark and the lettering beside it; the folded rail keeps the mark alone. */
export function sidebarBrand(doc: Document, signal: AbortSignal): HTMLDivElement {
  const lockup = doc.createElement('div');
  lockup.className = 'companion-lockup';
  lockup.setAttribute('role', 'img');
  lockup.setAttribute('aria-label', 'Buggie');

  const mark = buggieMark(doc, 'companion-brand');
  const lettering = buggieLettering(doc);
  lettering.classList.add('companion-brand-tail');
  lockup.append(mark, lettering);

  const hat = christmasHat(doc);
  hat.classList.add('companion-brand-hat');

  // Rechecked at local midnight and on focus or visibility changes.
  const win = doc.defaultView!;
  let midnightTimer: ReturnType<typeof setTimeout> | undefined;
  const refresh = (): void => {
    clearTimeout(midnightTimer);
    const now = new Date();
    if (now.getMonth() === 11 && (now.getDate() === 24 || now.getDate() === 25)) mark.append(hat);
    else hat.remove();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    midnightTimer = setTimeout(refresh, midnight.getTime() - now.getTime());
  };
  refresh();
  win.addEventListener('focus', refresh, { signal });
  doc.addEventListener('visibilitychange', refresh, { signal });
  signal.addEventListener('abort', () => clearTimeout(midnightTimer), { once: true });
  return lockup;
}

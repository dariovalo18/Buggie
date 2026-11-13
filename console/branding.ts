/**
 * "Buggie" in the stroke lettering of Cortico's wordmark: x-height 86–134, capitals from 50, descenders to 162,
 * strokes 16 wide. The two g's take the accent colour, as the mark's eyes do.
 */
export function buggieLettering(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '-8 34 428 144');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '16');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('wordmark-lettering');
  const g = (cx: number) =>
    `<g class="accent"><path d="M${cx} 86A24 24 0 1 1 ${cx} 134A24 24 0 1 1 ${cx} 86"/><path d="M${cx + 24} 86V140A22 22 0 0 1 ${cx + 2} 162H${cx - 14}"/></g>`;
  svg.innerHTML =
    '<path d="M8 50V134M8 50H30A21 21 0 0 1 30 92H8M8 92H34A21 21 0 0 1 34 134H8"/>' +
    '<path d="M86 86V110A24 24 0 0 0 134 110M134 86V134"/>' +
    g(189) + g(268) +
    '<path d="M323 86V134"/><circle cx="323" cy="58" r="9" fill="currentColor" stroke="none"/>' +
    '<path d="M354 110H402A24 24 0 1 0 395 127"/>';
  return svg;
}

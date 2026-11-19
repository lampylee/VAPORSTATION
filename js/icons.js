// Small inline stroke icons for the panel (currentColor, no assets, works offline).
const P = {
  show: '<path d="M8 1.5l1.9 4.6h4.6l-3.7 2.9 1.5 5-4.3-3.2-4.3 3.2 1.5-5L1.5 6.1h4.6z"/>',
  list: '<path d="M2 4h12M2 8h12M2 12h7"/>',
  palette: '<rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5" fill="currentColor"/><rect x="2" y="9" width="5" height="5" fill="currentColor"/><rect x="9" y="9" width="5" height="5"/>',
  worlds: '<path d="M1 13l4-6 3 3.5 3-4.5 4 7z" stroke-linejoin="round"/>',
  gear: '<circle cx="8" cy="8" r="2.4"/><path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15M3 3l1.6 1.6M11.4 11.4L13 13M3 13l1.6-1.6M11.4 4.6L13 3"/>',
  hold: '<path d="M3 11h10M3 8h10M3 5h10"/>',
  freeze: '<path d="M8 1v14M2 4.5l12 7M14 4.5l-12 7"/>',
  blackout: '<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 0 0 12z" fill="currentColor"/>',
  flash: '<path d="M9 1L3 9h4.5l-1 6L13 7H8.5z" stroke-linejoin="round"/>',
  prev: '<path d="M10 3L5 8l5 5"/>',
  next: '<path d="M6 3l5 5-5 5"/>',
  chevron: '<path d="M6 4l4 4-4 4"/>',
  input: '<rect x="5.5" y="1.5" width="5" height="8" rx="2.5"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15"/>',
  midi: '<circle cx="8" cy="8" r="6.5"/><circle cx="5" cy="7" r=".9" fill="currentColor"/><circle cx="8" cy="5" r=".9" fill="currentColor"/><circle cx="11" cy="7" r=".9" fill="currentColor"/><path d="M6.5 11.5h3"/>',
};

/** Returns an <svg> element for the named icon (16 px by default). */
export function icon(name, size = 16) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.5');
  s.classList.add('ic');
  s.innerHTML = P[name] || '';
  return s;
}

const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  kids.forEach((k) => k != null && e.append(k));
  return e;
};

/**
 * A panel card: <section class="card"> with an icon heading. Returns the section;
 * section.status is the right-aligned status span in the heading.
 * The heading carries data-title so other modules can find the card by name.
 */
export function card(title, iconName, ...kids) {
  const status = el('span', { className: 'card-status' });
  const h2 = el('h2', {}, icon(iconName), el('span', { textContent: title }), status);
  h2.dataset.title = title;
  const sec = el('section', { className: 'card' }, h2, ...kids);
  sec.status = status;
  return sec;
}

/** A "Fine-tune: …" fold-out (native <details>, keyboard accessible). */
export function fold(label, ...kids) {
  return el('details', { className: 'fold' }, el('summary', {}, icon('chevron', 12), el('span', { textContent: label })), ...kids);
}

/**
 * Text cut off with an ellipsis (Tailwind's `truncate` or `line-clamp-*`) keeps its full text in the
 * page, so screen readers, copying and find-in-page get all of it. For the eye, hovering shows it
 * too: while the pointer is over clipped text, the text is its own title. One listener covers every
 * clipped text in the app, whoever drew it. On touch, each clipped label has a fuller view a tap
 * away (a row opens its detail; the list picker its menu).
 */
const CLIPS = '.truncate, [class*="line-clamp-"]:not(.line-clamp-none)';
const MARK = 'clipTitle';

const isClipped = (element: HTMLElement) =>
  element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1;

const onPointerOver = (event: PointerEvent) => {
  const element = event.target instanceof Element ? event.target.closest<HTMLElement>(CLIPS) : null;
  // A title someone set on purpose is left alone.
  if (!element || (element.title && element.dataset[MARK] === undefined)) return;
  const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (text && isClipped(element)) {
    element.title = text;
    element.dataset[MARK] = '';
  } else if (element.dataset[MARK] !== undefined) {
    element.removeAttribute('title');
    delete element.dataset[MARK];
  }
};

/** Starts showing clipped text in full on hover; returns how to stop. */
export const showClippedText = (): (() => void) => {
  document.addEventListener('pointerover', onPointerOver);
  return () => document.removeEventListener('pointerover', onPointerOver);
};

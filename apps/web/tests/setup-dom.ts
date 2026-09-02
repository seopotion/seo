import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when Vitest globals are on. They aren't (tests
// import from 'vitest' explicitly), so unmount between tests by hand — otherwise
// mounted dialogs leak into the next test's `document`.
afterEach(cleanup);

/**
 * jsdom has no layout engine, so `getClientRects()` is empty for *every* element,
 * even a plainly visible one. Code that uses a non-empty rect list as a proxy for
 * "is rendered" — `isElementFocusable` in `components/ui/modal.tsx` does — then
 * treats the whole document as unfocusable, and focus tests silently assert
 * nothing. Stand in for layout with the one thing jsdom can answer: whether the
 * element or an ancestor is display:none / visibility:hidden.
 *
 * jsdom does not cascade `display` to descendants in `getComputedStyle`, hence
 * the manual walk up the tree.
 *
 * Limitation: this cannot model off-screen or zero-size elements. A test that
 * needs "visible but has no box" is not expressible here.
 */
const EMPTY_RECT_LIST = toRectList([]);
const SINGLE_RECT_LIST = toRectList([new DOMRect(0, 0, 100, 20)]);

Element.prototype.getClientRects = function getClientRects(this: Element) {
  return isRendered(this) ? SINGLE_RECT_LIST : EMPTY_RECT_LIST;
};

function isRendered(element: Element) {
  if (!element.isConnected) {
    return false;
  }

  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);

    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }
  }

  return true;
}

function toRectList(rects: DOMRect[]) {
  return Object.assign(rects.slice(), {
    item: (index: number) => rects[index] ?? null,
  }) as unknown as DOMRectList;
}

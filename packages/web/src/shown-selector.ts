/**
 * The selector engine a `visible` query narrows through inside Playwright's
 * own chain, before an index, a filter, or an enclosing scope runs. It keeps
 * the query root when the reader's `hidden` state is false, so a node the
 * chain retains is one `toBeVisible()` accepts by construction. Playwright's
 * `filter({ visible: true })` could not stand in for it: it reads text under
 * a `display: contents` element with `visibility: hidden` as visible, which
 * paints nothing.
 */

import { readSemanticsFunction } from './in-page/read-semantics.ts';
import { SECURE_FIELD_SELECTOR } from './read-node.ts';

/** Playwright selector engine name; `e2e-shown=` resolves to the query root when it reads as shown. */
export const SHOWN_SELECTOR_ENGINE = 'e2e-shown';

/** The selector step that keeps a match only when it reads as shown. */
export const SHOWN_SELECTOR = `${SHOWN_SELECTOR_ENGINE}=`;

/**
 * The engine behind `e2e-shown=`: the query root itself when the reader's
 * `hidden` mode answers false, else nothing. The reader is embedded as source
 * because a selector engine, like the reader, is one self-contained page
 * function.
 */
export const SHOWN_SELECTOR_ENGINE_SOURCE = `() => {
  const read = (${readSemanticsFunction.toString()});
  const options = { testIdAttribute: '', secureFieldSelector: ${JSON.stringify(SECURE_FIELD_SELECTOR)}, mode: { kind: 'hidden' } };
  const queryAll = (root) => (read(root, options) ? [] : [root]);
  return { queryAll, query: (root) => queryAll(root)[0] ?? null };
}`;

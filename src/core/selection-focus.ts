import type { TextFocus } from './types.ts';

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
const SOURCE_LEVEL_ATTRIBUTE = 'data-context-reader-heading-level';

export function selectionScopeForElement(
  element: Element | null,
): Pick<TextFocus, 'scope' | 'headingLevel'> {
  const heading = element?.closest(HEADING_SELECTOR);
  if (!heading) return {};

  const sourceLevel = Number(heading.getAttribute(SOURCE_LEVEL_ATTRIBUTE));
  const renderedLevel = Number(heading.tagName.slice(1));
  const headingLevel = sourceLevel || renderedLevel;
  return Number.isInteger(headingLevel) && headingLevel >= 1 && headingLevel <= 6
    ? { scope: 'section', headingLevel }
    : {};
}

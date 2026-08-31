import { describe, expect, it } from 'vitest';

import { selectionScopeForElement } from '../../src/core/selection-focus.ts';

describe('selectionScopeForElement', () => {
  it('marks text inside a heading as a section reference', () => {
    document.body.innerHTML = `
      <h2 id="progressive-disclosure">
        <span>Understanding Progressive Disclosure</span>
      </h2>
    `;

    expect(
      selectionScopeForElement(document.querySelector('h2 span')),
    ).toEqual({
      scope: 'section',
      headingLevel: 2,
    });
  });

  it('uses the preserved source level for reconstructed headings', () => {
    document.body.innerHTML = `
      <h2 data-context-reader-heading-level="1">Paper title</h2>
    `;

    expect(selectionScopeForElement(document.querySelector('h2'))).toEqual({
      scope: 'section',
      headingLevel: 1,
    });
  });

  it('leaves ordinary selected text as a normal text reference', () => {
    document.body.innerHTML = '<p><span>Selected explanation</span></p>';

    expect(
      selectionScopeForElement(document.querySelector('p span')),
    ).toEqual({});
  });
});

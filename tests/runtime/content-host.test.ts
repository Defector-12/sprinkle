// @vitest-environment node
/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { expect, it } from 'vitest';

it('uses a defined HTML element for the assistant shadow host', () => {
  const contentScript = readFileSync(
    new URL('../../entrypoints/content.ts', import.meta.url),
    'utf8',
  );

  expect(contentScript).toContain(
    "const host = document.createElement('div');",
  );
  expect(contentScript).not.toContain(
    "document.createElement('context-reader-assistant')",
  );
});

it('provides compact selection actions and a draggable translation bubble', () => {
  const contentScript = readFileSync(
    new URL('../../entrypoints/content.ts', import.meta.url),
    'utf8',
  );

  expect(contentScript).toContain("createSelectionAction('提问')");
  expect(contentScript).toContain("createSelectionAction('翻译', true)");
  expect(contentScript).toContain("height: '28px'");
  expect(contentScript).toContain('makeDraggable(');
  expect(contentScript).toContain('translationMoved = true');
  expect(contentScript).toContain("type: 'translate'");
  expect(contentScript).toMatch(
    /document\.addEventListener\(\s*'pointerdown',\s*onDocumentPointerDown,\s*true,\s*\)/,
  );
  expect(contentScript).toMatch(
    /document\.removeEventListener\(\s*'pointerdown',\s*onDocumentPointerDown,\s*true,\s*\)/,
  );
  expect(contentScript).toContain('removeTranslationDrag?.()');
  expect(contentScript).toContain('translation?.remove()');
});

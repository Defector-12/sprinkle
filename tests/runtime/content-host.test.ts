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

// @vitest-environment node
/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('floating assistant visual surface', () => {
  it('keeps a short conversation packed at the top', () => {
    const assistantCss = readFileSync(
      new URL('../../src/styles/floating-assistant.css', import.meta.url),
      'utf8',
    );
    const messagesRule =
      assistantCss.match(/(?:^|\n)\.cr-messages\s*\{([\s\S]*?)\}/)?.[1] ??
      '';

    expect(messagesRule).toContain('display: grid');
    expect(messagesRule).toContain('align-content: start');
  });
});

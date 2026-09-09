// @vitest-environment node
/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('shared message content visual surface', () => {
  it('lets question diagnostics follow the available message width', () => {
    const responsiveCss = readFileSync(
      new URL(
        '../../src/styles/responsive-question-trace.css',
        import.meta.url,
      ),
      'utf8',
    );
    const traceRule =
      responsiveCss.match(/\.question-trace\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    expect(traceRule).toContain('width: 100%');
    expect(traceRule).toContain('max-width: 100%');
    expect(traceRule).not.toContain('560px');
  });
});

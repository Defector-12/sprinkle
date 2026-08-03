// @vitest-environment node
/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('study workspace visual surface', () => {
  it('keeps the chat pane free of repeated horizontal rules', () => {
    const studyCss = readFileSync(
      new URL('../../src/styles/study.css', import.meta.url),
      'utf8',
    );
    expect(studyCss).toContain('.study-chat');
    expect(studyCss).not.toMatch(/linear-gradient/);
    expect(studyCss).not.toMatch(/background-size/);
  });
});

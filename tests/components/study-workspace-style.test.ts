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

  it('keeps short user messages compact instead of stretching across the pane', () => {
    const studyCss = readFileSync(
      new URL('../../src/styles/study.css', import.meta.url),
      'utf8',
    );
    const userMessageRule =
      studyCss.match(/\.study-message--user\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    expect(userMessageRule).toContain('width: fit-content');
    expect(userMessageRule).toMatch(/max-width:\s*min\(/);
  });

  it('keeps expanded question history inside a narrow chat pane', () => {
    const studyCss = readFileSync(
      new URL('../../src/styles/study.css', import.meta.url),
      'utf8',
    );
    const historyRule =
      studyCss.match(
        /\.study-conversation \.question-history\[data-expanded="true"\]\s*\{([\s\S]*?)\}/,
      )?.[1] ?? '';

    expect(historyRule).toContain('width: min(200px, calc(100% - 12px))');
    expect(studyCss).toContain(
      '.study-chat--composer-maximized .study-conversation',
    );
  });
});

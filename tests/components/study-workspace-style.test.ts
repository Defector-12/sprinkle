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
    const historyPositionRule =
      studyCss.match(
        /\.study-conversation \.question-history\s*\{([\s\S]*?)\}/,
      )?.[1] ?? '';

    expect(historyPositionRule).toContain('right: 10px');
    expect(historyRule).toContain('width: min(200px, calc(100% - 20px))');
    expect(studyCss).toContain(
      '.study-chat--composer-maximized .study-conversation',
    );
  });

  it('fits both panes to the available viewport and stacks on narrow screens', () => {
    const studyCss = readFileSync(
      new URL('../../src/styles/study.css', import.meta.url),
      'utf8',
    );
    const bodyRule =
      studyCss.match(/(?:^|\n)body\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const workspaceRule =
      studyCss.match(/\.study-workspace\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const narrowLayout =
      studyCss.match(
        /@media \(max-width: 900px\)\s*\{([\s\S]*?)\n\}/,
      )?.[1] ?? '';

    expect(bodyRule).toContain('min-width: 0');
    expect(workspaceRule).toContain('max-width: 100dvw');
    expect(workspaceRule).toContain('clamp(420px');
    expect(narrowLayout).toContain(
      'grid-template-columns: minmax(0, 1fr)',
    );
    expect(narrowLayout).toContain('.study-divider');
    expect(narrowLayout).toContain('display: none');
  });

  it('keeps the conversation content inside a right-side safe area', () => {
    const studyCss = readFileSync(
      new URL('../../src/styles/study.css', import.meta.url),
      'utf8',
    );
    const conversationRule =
      studyCss.match(/\.study-conversation\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const messagesRule =
      studyCss.match(/\.study-messages\s*\{([\s\S]*?)\}/)?.[1] ?? '';

    expect(conversationRule).toContain('max-width: 100%');
    expect(conversationRule).toContain('overflow: hidden');
    expect(messagesRule).toContain('max-width: 100%');
    expect(messagesRule).toContain('overflow-x: hidden');
    expect(messagesRule).toContain('padding: 34px 42px 44px 26px');
  });

  it('keeps reconstructed content inside its pane while preserving code lines', () => {
    const studyCss = readFileSync(
      new URL('../../src/styles/study.css', import.meta.url),
      'utf8',
    );
    const bodyRule =
      studyCss.match(
        /\.study-document__body\s*\{([\s\S]*?)\}/,
      )?.[1] ?? '';
    const preRule =
      studyCss.match(
        /\.study-document__body > pre\s*\{([\s\S]*?)\}/,
      )?.[1] ?? '';

    expect(bodyRule).toContain('max-width: 100%');
    expect(bodyRule).toContain('overflow-wrap: anywhere');
    expect(preRule).toContain('max-width: 100%');
    expect(preRule).toContain('overflow-x: auto');
    expect(preRule).toContain('overflow-wrap: anywhere');
    expect(preRule).toContain('white-space: pre-wrap');
  });
});

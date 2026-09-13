// @vitest-environment node
/// <reference types="node" />

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('shared message content visual surface', () => {
  it('uses compact block spacing without preserving Markdown source whitespace', () => {
    const messageCss = readFileSync(
      new URL('../../src/styles/message-content.css', import.meta.url),
      'utf8',
    );
    const markdownRule =
      messageCss.match(/\.message-markdown\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    const listParagraphRule =
      messageCss.match(
        /\.message-markdown li > p\s*\{([\s\S]*?)\}/,
      )?.[1] ?? '';

    expect(markdownRule).toContain('white-space: normal');
    expect(listParagraphRule).toContain('margin: 0');
  });

  it('preserves user line breaks without applying pre-wrap to parsed answers', () => {
    const surfaces = [
      {
        css: readFileSync(
          new URL('../../src/styles/floating-assistant.css', import.meta.url),
          'utf8',
        ),
        combined:
          /\.cr-message > \.message-plain,\s*\.cr-message > \.message-markdown\s*\{([\s\S]*?)\}/,
        plain: /\.cr-message > \.message-plain\s*\{([\s\S]*?)\}/,
      },
      {
        css: readFileSync(
          new URL('../../src/styles/study.css', import.meta.url),
          'utf8',
        ),
        combined:
          /\.study-message > \.message-plain,\s*\.study-message > \.message-markdown\s*\{([\s\S]*?)\}/,
        plain: /\.study-message > \.message-plain\s*\{([\s\S]*?)\}/,
      },
    ];

    for (const surface of surfaces) {
      expect(surface.css.match(surface.combined)?.[1] ?? '').not.toContain(
        'white-space',
      );
      expect(surface.css.match(surface.plain)?.[1] ?? '').toContain(
        'white-space: pre-wrap',
      );
    }
  });

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

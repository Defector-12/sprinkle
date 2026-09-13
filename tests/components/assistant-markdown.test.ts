import { describe, expect, it } from 'vitest';

import { normalizeAssistantMarkdown } from '../../src/components/assistant-markdown.ts';

describe('normalizeAssistantMarkdown', () => {
  it('collapses repeated blank lines and trims blank edges', () => {
    expect(
      normalizeAssistantMarkdown('\n第一段\r\n\r\n\r\n第二段\n\n'),
    ).toBe('第一段\n\n第二段');
  });

  it('preserves meaningful Markdown hard line breaks', () => {
    expect(normalizeAssistantMarkdown('第一行  \n第二行')).toBe(
      '第一行  \n第二行',
    );
  });

  it('repairs detached list markers and compacts sibling list items', () => {
    expect(
      normalizeAssistantMarkdown(
        [
          '1.',
          '',
          '   **harness 的第一项工作：控制入口**',
          '',
          '   - 第一项',
          '',
          '   - 第二项',
        ].join('\n'),
      ),
    ).toBe(
      [
        '1. **harness 的第一项工作：控制入口**',
        '',
        '   - 第一项',
        '   - 第二项',
      ].join('\n'),
    );
  });

  it('preserves whitespace inside fenced code blocks', () => {
    expect(
      normalizeAssistantMarkdown(
        [
          '示例：',
          '',
          '',
          '```ts',
          'const first = 1;',
          '',
          '',
          'const second = 2;',
          '```',
          '',
          '',
          '完成。',
        ].join('\n'),
      ),
    ).toBe(
      [
        '示例：',
        '',
        '```ts',
        'const first = 1;',
        '',
        '',
        'const second = 2;',
        '```',
        '',
        '完成。',
      ].join('\n'),
    );
  });
});

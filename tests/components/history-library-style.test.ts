import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('history library visual surface', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/styles/library.css'),
    'utf8',
  );

  it('uses a resizable three-track layout without decorative gradients', () => {
    expect(css).toContain(
      'var(--library-index-width, 340px)',
    );
    expect(css).toContain('.library-divider::before');
    expect(css).toContain('cursor: col-resize');
    expect(css).toContain('.library-layout--index-collapsed');
    expect(css).toContain('@media (max-width: 760px)');
    expect(css).not.toMatch(/(?:linear|radial)-gradient/);
  });

  it('uses whitespace and soft surfaces instead of hard section rules', () => {
    expect(css).toContain('max-width: min(78%, 620px)');
    expect(css).toContain('width: min(820px, calc(100% - 40px))');
    expect(css).toContain('min-width: 112px');
    expect(css).not.toMatch(
      /\.library-index\s*\{[^}]*border-right:/s,
    );
    expect(css).not.toMatch(
      /\.library-message--assistant\s*\{[^}]*border-left:/s,
    );
  });
});

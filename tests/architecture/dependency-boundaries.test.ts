// @vitest-environment node
/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe('architecture boundaries', () => {
  it('keeps runtime adapters independent from React components', () => {
    const runtimeFiles = sourceFiles(`${projectRoot}/src/runtime`);
    const violations = runtimeFiles.filter((path) =>
      /from ['"]\.\.\/components\//.test(readFileSync(path, 'utf8')),
    );

    expect(violations).toEqual([]);
  });

  it('keeps model system prompts in the prompt module', () => {
    const source = sourceFiles(`${projectRoot}/src`).filter(
      (path) => !path.endsWith('/core/prompts.ts'),
    );
    const violations = source.filter((path) =>
      /role:\s*['"]system['"]\s*,/.test(readFileSync(path, 'utf8')),
    );

    expect(violations).toEqual([]);
  });
});

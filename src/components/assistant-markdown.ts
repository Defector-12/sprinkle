interface MarkdownFence {
  character: '`' | '~';
  length: number;
}

const BARE_LIST_MARKER = /^(\s*)([-+*]|\d+[.)])\s*$/;
const FENCE_MARKER = /^\s*(`{3,}|~{3,})/;
const CLOSING_FENCE_MARKER = /^\s*(`{3,}|~{3,})\s*$/;
const LIST_ITEM = /^(\s*)(?:[-+*]|\d+[.)])\s+\S/;

function fenceFromLine(line: string): MarkdownFence | null {
  const marker = line.match(FENCE_MARKER)?.[1];
  if (!marker) return null;
  return {
    character: marker[0] as MarkdownFence['character'],
    length: marker.length,
  };
}

function closesFence(line: string, fence: MarkdownFence): boolean {
  const marker = line.match(CLOSING_FENCE_MARKER)?.[1];
  return Boolean(
    marker &&
      marker[0] === fence.character &&
      marker.length >= fence.length,
  );
}

function continuationForBareMarker(
  lines: string[],
  markerIndex: number,
  markerIndent: number,
): { index: number; content: string } | null {
  let index = markerIndex + 1;
  while (index < lines.length && !lines[index]?.trim()) index += 1;
  const line = lines[index];
  if (!line || fenceFromLine(line) || BARE_LIST_MARKER.test(line)) return null;

  const indentation = line.match(/^[ \t]*/)?.[0] ?? '';
  if (indentation.includes('\t') || indentation.length - markerIndent > 3) {
    return null;
  }
  return { index, content: line.trimStart() };
}

function nextNonBlankLine(lines: string[], startIndex: number): string {
  let index = startIndex;
  while (index < lines.length && !lines[index]?.trim()) index += 1;
  return lines[index] ?? '';
}

function separatesSiblingListItems(previous: string, next: string): boolean {
  const previousItem = previous.match(LIST_ITEM);
  const nextItem = next.match(LIST_ITEM);
  return Boolean(
    previousItem &&
      nextItem &&
      previousItem[1]?.length === nextItem[1]?.length,
  );
}

export function normalizeAssistantMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const normalized: string[] = [];
  let fence: MarkdownFence | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    if (fence) {
      normalized.push(line);
      if (closesFence(line, fence)) fence = null;
      continue;
    }

    const openingFence = fenceFromLine(line);
    if (openingFence) {
      fence = openingFence;
      normalized.push(line);
      continue;
    }

    if (!line.trim()) {
      const previous = normalized.at(-1) ?? '';
      const next = nextNonBlankLine(lines, index + 1);
      if (
        normalized.length &&
        previous !== '' &&
        !separatesSiblingListItems(previous, next)
      ) {
        normalized.push('');
      }
      continue;
    }

    const bareMarker = line.match(BARE_LIST_MARKER);
    if (bareMarker) {
      const continuation = continuationForBareMarker(
        lines,
        index,
        bareMarker[1]?.length ?? 0,
      );
      if (continuation) {
        normalized.push(
          `${bareMarker[1] ?? ''}${bareMarker[2]} ${continuation.content}`,
        );
        index = continuation.index;
        continue;
      }
    }

    normalized.push(line);
  }

  while (normalized[0] === '') normalized.shift();
  while (normalized.at(-1) === '') normalized.pop();
  return normalized.join('\n');
}

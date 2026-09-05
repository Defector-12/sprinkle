import type { PageContext } from './types.ts';
import { createPageKey, normalizePageUrl } from './url.ts';

export function createPageContext(
  tabId: number,
  url: string,
  title: string,
): PageContext {
  return {
    key: createPageKey(tabId, url),
    tabId,
    url,
    normalizedUrl: normalizePageUrl(url),
    title,
    status: 'unactivated',
    article: null,
    focus: null,
    messages: [],
    warning: null,
    warningDetail: null,
    updatedAt: Date.now(),
  };
}

export function canAskPage(context: PageContext | null): boolean {
  return Boolean(
    context?.article &&
      (context.status === 'ready' || context.status === 'partial'),
  );
}

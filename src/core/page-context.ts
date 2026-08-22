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
    updatedAt: Date.now(),
  };
}

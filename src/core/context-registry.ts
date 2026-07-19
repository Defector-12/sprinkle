import type {
  ArticleDocument,
  ChatMessage,
  FocusContext,
  PageContext,
  PageStatus,
} from './types.ts';
import { createPageKey, normalizePageUrl } from './url.ts';

function createContext(
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

export class ContextRegistry {
  private readonly contexts = new Map<string, PageContext>();

  getOrCreate(tabId: number, url: string, title: string): PageContext {
    const key = createPageKey(tabId, url);
    const existing = this.contexts.get(key);
    if (existing) return existing;

    const context = createContext(tabId, url, title);
    this.contexts.set(key, context);
    return context;
  }

  get(tabId: number, url: string): PageContext | null {
    return this.contexts.get(createPageKey(tabId, url)) ?? null;
  }

  upsert(context: PageContext): PageContext {
    this.contexts.set(context.key, context);
    return context;
  }

  setStatus(
    tabId: number,
    url: string,
    title: string,
    status: PageStatus,
    warning: string | null = null,
  ): PageContext {
    const context = this.getOrCreate(tabId, url, title);
    return this.upsert({
      ...context,
      status,
      warning,
      updatedAt: Date.now(),
    });
  }

  setArticle(tabId: number, article: ArticleDocument): PageContext {
    const context = this.getOrCreate(tabId, article.url, article.title);
    return this.upsert({
      ...context,
      title: article.title,
      article,
      status: article.isPartial ? 'partial' : 'ready',
      warning: article.isPartial ? '当前页面只读取到部分内容' : null,
      updatedAt: Date.now(),
    });
  }

  setFocus(
    tabId: number,
    url: string,
    title: string,
    focus: FocusContext | null,
  ): PageContext {
    const context = this.getOrCreate(tabId, url, title);
    return this.upsert({
      ...context,
      focus,
      updatedAt: Date.now(),
    });
  }

  appendMessage(
    tabId: number,
    url: string,
    message: ChatMessage,
  ): PageContext {
    const context = this.get(tabId, url);
    if (!context) {
      throw new Error('Page context does not exist');
    }

    return this.upsert({
      ...context,
      messages: [...context.messages, message],
      updatedAt: Date.now(),
    });
  }

  replaceMessages(
    tabId: number,
    url: string,
    messages: ChatMessage[],
  ): PageContext {
    const context = this.get(tabId, url);
    if (!context) {
      throw new Error('Page context does not exist');
    }

    return this.upsert({
      ...context,
      messages,
      updatedAt: Date.now(),
    });
  }

  clearPage(tabId: number, url: string, title: string): PageContext {
    const context = createContext(tabId, url, title);
    this.contexts.set(context.key, context);
    return context;
  }

  listForTab(tabId: number): PageContext[] {
    return [...this.contexts.values()].filter(
      (context) => context.tabId === tabId,
    );
  }

  list(): PageContext[] {
    return [...this.contexts.values()];
  }

  disposeTab(tabId: number): PageContext[] {
    const disposed = this.listForTab(tabId);
    for (const context of disposed) {
      this.contexts.delete(context.key);
    }
    return disposed;
  }
}

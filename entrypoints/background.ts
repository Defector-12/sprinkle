import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { ContextRegistry } from '../src/core/context-registry.ts';
import { buildModelRequest } from '../src/core/model-request.ts';
import {
  createArticleChunks,
  retrieveRelevantChunks,
} from '../src/core/retrieval.ts';
import type {
  ArticleDocument,
  ChatMessage,
  FocusContext,
  PageContext,
} from '../src/core/types.ts';
import {
  ConversationArchive,
  SessionContextRepository,
} from '../src/runtime/context-repository.ts';
import type {
  ContentRequest,
  ExtensionRequest,
  RuntimeResult,
} from '../src/runtime/messages.ts';
import { OpenAiCompatibleModelClient } from '../src/runtime/model-client.ts';
import {
  loadSettings,
  localStorageArea,
  sessionStorageArea,
} from '../src/runtime/settings-store.ts';

const environment = import.meta.env;
const modelClient = new OpenAiCompatibleModelClient({
  endpoint: environment.VITE_MODEL_API_URL?.trim() ?? '',
  model: environment.VITE_MODEL_ID?.trim() ?? '',
  supportsVision: environment.VITE_MODEL_SUPPORTS_VISION === 'true',
});
const contexts = new SessionContextRepository(sessionStorageArea());
const conversations = new ConversationArchive(localStorageArea());

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败，请重试。';
}

function success<T>(data: T): RuntimeResult<T> {
  return { ok: true, data };
}

function failure<T>(cause: unknown): RuntimeResult<T> {
  return { ok: false, error: errorMessage(cause) };
}

function isSupportedUrl(url: string | undefined): url is string {
  return Boolean(url && /^https?:\/\//.test(url));
}

interface PageTab {
  id: number;
  url: string;
  title: string;
  windowId: number;
}

async function activeTab(): Promise<PageTab> {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id || !isSupportedUrl(tab.url)) {
    throw new Error('当前页面不支持读取，请打开一个普通网页。');
  }
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title || new URL(tab.url).hostname,
    windowId: tab.windowId,
  };
}

async function notify(context: PageContext): Promise<void> {
  await browser.runtime
    .sendMessage({ type: 'context:changed', context })
    .catch(() => undefined);
}

async function getOrCreateContext(tab: {
  id: number;
  url: string;
  title: string;
}): Promise<PageContext> {
  const stored = await contexts.get(tab.id, tab.url);
  if (stored) return stored;

  const registry = new ContextRegistry();
  let context = registry.getOrCreate(tab.id, tab.url, tab.title);
  const settings = await loadSettings();
  if (settings.retainConversations) {
    const messages = await conversations.load(tab.url);
    if (messages.length) context = { ...context, messages };
  }
  await contexts.save(context);
  return context;
}

async function activatePage(tab: PageTab): Promise<PageContext> {
  const current = await getOrCreateContext(tab);
  const parsing: PageContext = {
    ...current,
    status: 'parsing',
    warning: null,
    updatedAt: Date.now(),
  };
  await contexts.save(parsing);
  await notify(parsing);

  try {
    const article = (await browser.tabs.sendMessage(tab.id, {
      type: 'page:extract',
    } satisfies ContentRequest)) as ArticleDocument;
    const ready: PageContext = {
      ...parsing,
      title: article.title,
      article,
      status: article.isPartial ? 'partial' : 'ready',
      warning: article.isPartial ? '当前页面只读取到部分内容' : null,
      updatedAt: Date.now(),
    };
    await contexts.save(ready);
    await notify(ready);
    return ready;
  } catch (cause) {
    const failed: PageContext = {
      ...parsing,
      status: 'failed',
      warning: errorMessage(cause),
      updatedAt: Date.now(),
    };
    await contexts.save(failed);
    await notify(failed);
    throw new Error('页面读取失败，请刷新页面后重试。');
  }
}

async function activateCurrentPage(): Promise<PageContext> {
  return activatePage(await activeTab());
}

function message(
  role: ChatMessage['role'],
  content: string,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
}

async function askCurrentPage(question: string): Promise<PageContext> {
  const tab = await activeTab();
  const current = await getOrCreateContext(tab);
  if (!current.article || !['ready', 'partial'].includes(current.status)) {
    throw new Error('请先读取当前页面，再发送问题。');
  }

  const settings = await loadSettings();
  if (!settings.apiKey.trim()) {
    throw new Error('请先在设置中填写 API Key。');
  }

  const chunks = createArticleChunks(current.article.blocks);
  const relevantChunks = retrieveRelevantChunks(chunks, {
    question,
    focusText: current.focus?.text,
    limit: 6,
  });
  const request = buildModelRequest({
    article: current.article,
    question,
    relevantChunks,
    history: current.messages,
    focus: current.focus,
  });
  const withQuestion: PageContext = {
    ...current,
    status: 'answering',
    messages: [...current.messages, message('user', question)],
    updatedAt: Date.now(),
  };
  await contexts.save(withQuestion);
  await notify(withQuestion);

  try {
    const answer = await modelClient.complete(settings.apiKey, request);
    const completed: PageContext = {
      ...withQuestion,
      status: current.article.isPartial ? 'partial' : 'ready',
      messages: [...withQuestion.messages, message('assistant', answer)],
      updatedAt: Date.now(),
    };
    await contexts.save(completed);
    if (settings.retainConversations) {
      await conversations.save(completed);
    }
    await notify(completed);
    return completed;
  } catch (cause) {
    const recovered: PageContext = {
      ...withQuestion,
      status: current.article.isPartial ? 'partial' : 'ready',
      updatedAt: Date.now(),
    };
    await contexts.save(recovered);
    await notify(recovered);
    throw cause;
  }
}

async function clearCurrentPage(): Promise<PageContext> {
  const tab = await activeTab();
  await contexts.deletePage(tab.id, tab.url);
  await conversations.delete(tab.url);
  return getOrCreateContext(tab);
}

async function startPicker(type: ContentRequest['type']): Promise<void> {
  const tab = await activeTab();
  const context = await getOrCreateContext(tab);
  if (!['ready', 'partial'].includes(context.status)) {
    throw new Error('请先读取当前页面。');
  }
  await browser.tabs.sendMessage(tab.id, { type } satisfies ContentRequest);
}

async function setFocusFromPage(
  focus: FocusContext,
  sender: Browser.runtime.MessageSender,
): Promise<PageContext> {
  if (!sender.tab?.id || !isSupportedUrl(sender.tab.url)) {
    throw new Error('无法识别内容所在页面。');
  }
  const current = await getOrCreateContext({
    id: sender.tab.id,
    url: sender.tab.url,
    title: sender.tab.title || new URL(sender.tab.url).hostname,
  });
  const updated: PageContext = {
    ...current,
    focus,
    updatedAt: Date.now(),
  };
  await contexts.save(updated);
  await notify(updated);
  await browser.sidePanel
    .open({ tabId: sender.tab.id })
    .catch(() => undefined);
  return updated;
}

async function handleRequest(
  request: ExtensionRequest,
  sender: Browser.runtime.MessageSender,
): Promise<RuntimeResult<unknown>> {
  try {
    switch (request.type) {
      case 'context:get': {
        return success(await getOrCreateContext(await activeTab()));
      }
      case 'context:activate':
        return success(await activateCurrentPage());
      case 'context:clear':
        return success(await clearCurrentPage());
      case 'chat:ask':
        return success(await askCurrentPage(request.question));
      case 'picker:image:start':
        await startPicker('picker:image:start');
        return success(undefined);
      case 'picker:region:start':
        await startPicker('picker:region:start');
        return success(undefined);
      case 'focus:set':
        return success(await setFocusFromPage(request.focus, sender));
      case 'capture:visible': {
        if (!sender.tab) throw new Error('无法识别当前标签页。');
        return success(
          await browser.tabs.captureVisibleTab(sender.tab.windowId, {
            format: 'png',
          }),
        );
      }
    }
  } catch (cause) {
    return failure(cause);
  }
}

export default defineBackground(() => {
  void browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => undefined);

  browser.runtime.onMessage.addListener(
    (request: ExtensionRequest, sender) => handleRequest(request, sender),
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const tabContexts = await contexts.listForTab(tabId);
      const settings = await loadSettings();
      if (settings.retainConversations) {
        await Promise.all(
          tabContexts
            .filter((context) => context.messages.length > 0)
            .map((context) => conversations.save(context)),
        );
      }
      await contexts.deleteTab(tabId);
    })();
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !isSupportedUrl(tab.url)) return;
    const url = tab.url;
    void (async () => {
      const existing = await contexts.get(tabId, url);
      if (!existing || existing.status === 'unactivated') return;
      await activatePage({
        id: tabId,
        url,
        title: tab.title || new URL(url).hostname,
        windowId: tab.windowId,
      }).catch(() => undefined);
    })();
  });
});

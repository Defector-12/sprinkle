import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { ContextRegistry } from '../src/core/context-registry.ts';
import { completeQuestionTurn } from '../src/core/conversation-turn.ts';
import { buildModelRequest } from '../src/core/model-request.ts';
import {
  createArticleChunks,
  retrieveRelevantChunks,
} from '../src/core/retrieval.ts';
import type {
  AnswerModel,
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
import {
  ArkResponsesModelClient,
  OpenAiCompatibleModelClient,
  RoutedModelClient,
  requestContainsImage,
} from '../src/runtime/model-client.ts';
import {
  loadSettings,
  localStorageArea,
  sessionStorageArea,
} from '../src/runtime/settings-store.ts';

const environment = import.meta.env;
const modelClient = new RoutedModelClient(
  new OpenAiCompatibleModelClient({
    endpoint: environment.VITE_MODEL_API_URL?.trim() ?? '',
    model: environment.VITE_MODEL_ID?.trim() ?? '',
    supportsVision: false,
  }),
  new ArkResponsesModelClient({
    endpoint:
      environment.VITE_VISION_MODEL_API_URL?.trim() ||
      'https://ark.cn-beijing.volces.com/api/v3/responses',
    model:
      environment.VITE_VISION_MODEL_ID?.trim() ||
      'doubao-seed-2-0-mini-260428',
    supportsVision: true,
  }),
);
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

function senderTab(sender: Browser.runtime.MessageSender): PageTab | null {
  const tab = sender.tab;
  if (tab?.id == null || !isSupportedUrl(tab.url)) return null;
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title || new URL(tab.url).hostname,
    windowId: tab.windowId,
  };
}

async function requestTab(
  sender: Browser.runtime.MessageSender,
): Promise<PageTab> {
  return senderTab(sender) ?? activeTab();
}

async function notify(context: PageContext): Promise<void> {
  const event = { type: 'context:changed', context } as const;
  await Promise.all([
    browser.runtime.sendMessage(event).catch(() => undefined),
    browser.tabs.sendMessage(context.tabId, event).catch(() => undefined),
  ]);
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

function message(
  role: ChatMessage['role'],
  content: string,
  answeredBy?: AnswerModel,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
    ...(answeredBy ? { answeredBy } : {}),
  };
}

async function askPage(
  question: string,
  tab: PageTab,
): Promise<PageContext> {
  const current = await getOrCreateContext(tab);
  if (!current.article || !['ready', 'partial'].includes(current.status)) {
    throw new Error('请先读取当前页面，再发送问题。');
  }

  const settings = await loadSettings();

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
  const containsImage = requestContainsImage(request);
  const missingKey = containsImage
    ? !settings.visionApiKey.trim()
    : !settings.apiKey.trim();
  if (missingKey) {
    throw new Error(
      containsImage
        ? '请先在设置中填写 Doubao API Key。'
        : '请先在设置中填写 DeepSeek API Key。',
    );
  }
  const withQuestion: PageContext = {
    ...current,
    status: 'answering',
    messages: [...current.messages, message('user', question)],
    updatedAt: Date.now(),
  };
  await contexts.save(withQuestion);
  await notify(withQuestion);

  try {
    const answer = await modelClient.complete(
      {
        textApiKey: settings.apiKey,
        visionApiKey: settings.visionApiKey,
      },
      request,
    );
    const completed = completeQuestionTurn(
      withQuestion,
      message('assistant', answer.content, answer.model),
    );
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

async function clearPage(tab: PageTab): Promise<PageContext> {
  await contexts.deletePage(tab.id, tab.url);
  await conversations.delete(tab.url);
  const cleared = await getOrCreateContext(tab);
  await notify(cleared);
  return cleared;
}

async function startPicker(
  type: ContentRequest['type'],
  tab: PageTab,
): Promise<void> {
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
  return updated;
}

async function clearFocus(tab: PageTab): Promise<PageContext> {
  const current = await getOrCreateContext(tab);
  const updated: PageContext = {
    ...current,
    focus: null,
    updatedAt: Date.now(),
  };
  await contexts.save(updated);
  await notify(updated);
  return updated;
}

async function handleRequest(
  request: ExtensionRequest,
  sender: Browser.runtime.MessageSender,
): Promise<RuntimeResult<unknown>> {
  try {
    switch (request.type) {
      case 'context:get': {
        return success(await getOrCreateContext(await requestTab(sender)));
      }
      case 'context:activate':
        return success(await activatePage(await requestTab(sender)));
      case 'context:clear':
        return success(await clearPage(await requestTab(sender)));
      case 'chat:ask':
        return success(
          await askPage(request.question, await requestTab(sender)),
        );
      case 'picker:image:start':
        await startPicker('picker:image:start', await requestTab(sender));
        return success(undefined);
      case 'picker:region:start':
        await startPicker('picker:region:start', await requestTab(sender));
        return success(undefined);
      case 'focus:set':
        return success(await setFocusFromPage(request.focus, sender));
      case 'focus:clear':
        return success(await clearFocus(await requestTab(sender)));
      case 'capture:visible': {
        if (!sender.tab) throw new Error('无法识别当前标签页。');
        return success(
          await browser.tabs.captureVisibleTab(sender.tab.windowId, {
            format: 'png',
          }),
        );
      }
      case 'settings:open':
        await browser.runtime.openOptionsPage();
        return success(undefined);
      case 'settings:has-key':
        return success(Boolean((await loadSettings()).apiKey.trim()));
      case 'settings:has-vision-key':
        return success(Boolean((await loadSettings()).visionApiKey.trim()));
    }
  } catch (cause) {
    return failure(cause);
  }
}

async function openAssistant(tab: Browser.tabs.Tab): Promise<void> {
  if (tab.id == null || !isSupportedUrl(tab.url)) return;

  const request = { type: 'assistant:open' } satisfies ContentRequest;
  try {
    await browser.tabs.sendMessage(tab.id, request);
  } catch {
    await browser.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['/content-scripts/content.js'],
    });
    await browser.tabs.sendMessage(tab.id, request);
  }
}

export default defineBackground(() => {
  browser.action.onClicked.addListener((tab) => {
    void openAssistant(tab);
  });

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

});

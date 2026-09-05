import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

import { OperationVersionTracker } from '../src/application/operation-version.ts';
import { SerialTaskQueue } from '../src/application/serial-task-queue.ts';
import {
  completeQuestionTurn,
  failQuestionTurn,
  recoverInterruptedQuestionTurn,
  snapshotMessageReference,
} from '../src/core/conversation-turn.ts';
import {
  buildModelRequest,
  buildTranslationRequest,
  shouldRetryUnchangedTranslation,
} from '../src/core/model-request.ts';
import { createPageContext } from '../src/core/page-context.ts';
import {
  planRetrievalQueries,
  QUERY_PLANNER_TIMEOUT_MS,
  shouldPlanRetrieval,
} from '../src/core/query-planner.ts';
import {
  articleContentBlocks,
  createArticleChunks,
  DEFAULT_RELEVANT_CHUNK_LIMIT,
  selectArticleContext,
} from '../src/core/retrieval.ts';
import { createPageKey, normalizePageUrl } from '../src/core/url.ts';
import type {
  AnswerModel,
  ArticleDocument,
  ChatMessage,
  FocusContext,
  MessageReference,
  PageContext,
} from '../src/core/types.ts';
import {
  ConversationArchive,
  mergeConversationMessages,
  SessionContextRepository,
} from '../src/runtime/context-repository.ts';
import { extensionUrl } from '../src/runtime/extension-url.ts';
import type {
  ContentRequest,
  ExtensionRequest,
  RuntimeResult,
} from '../src/runtime/messages.ts';
import { OpenAiCompatibleModelClient } from '../src/runtime/model-client.ts';
import {
  loadSettings,
  localStorageArea,
  SETTINGS_KEY,
  sessionStorageArea,
} from '../src/runtime/settings-store.ts';
import { captureVisibleTabForSender } from '../src/runtime/screenshot.ts';

const environment = import.meta.env;
const modelClient = new OpenAiCompatibleModelClient({
  endpoint:
    environment.VITE_MODEL_API_URL?.trim() ||
    'https://api.deepseek.com/chat/completions',
  model:
    environment.VITE_MODEL_ID?.trim() ||
    'deepseek-v4-flash-vision-exp',
});
const storageMutations = new SerialTaskQueue();
const contexts = new SessionContextRepository(
  sessionStorageArea(),
  storageMutations,
);
const conversations = new ConversationArchive(
  localStorageArea(),
  storageMutations,
);
const pageGenerations = new Map<string, number>();
const answeringPages = new Map<string, symbol>();
const historyOperations = new OperationVersionTracker<string>();

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

class StalePageContextError extends Error {}
class StalePageOperationError extends Error {}

function currentPageGeneration(key: string): number {
  return pageGenerations.get(key) ?? 0;
}

function invalidatePageOperations(key: string): number {
  const generation = currentPageGeneration(key) + 1;
  pageGenerations.set(key, generation);
  answeringPages.delete(key);
  return generation;
}

function requireCurrentPageOperation(key: string, generation: number): void {
  if (currentPageGeneration(key) !== generation) {
    throw new StalePageOperationError('页面状态已更新，已忽略过期操作。');
  }
}

function historyKey(url: string): string {
  return normalizePageUrl(url);
}

async function tabMatchesUrl(tabId: number, url: string): Promise<boolean> {
  try {
    const tab = await browser.tabs.get(tabId);
    return (
      isSupportedUrl(tab.url) &&
      normalizePageUrl(tab.url) === normalizePageUrl(url)
    );
  } catch {
    return false;
  }
}

async function requireMatchingTab(tabId: number, url: string): Promise<void> {
  if (!(await tabMatchesUrl(tabId, url))) {
    throw new StalePageContextError(
      '原页面已关闭或跳转，请在当前页面重新打开 Context Reader。',
    );
  }
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
  const tasks: Promise<unknown>[] = [
    browser.runtime.sendMessage(event).catch(() => undefined),
  ];
  if (await tabMatchesUrl(context.tabId, context.url)) {
    tasks.push(
      browser.tabs.sendMessage(context.tabId, event).catch(() => undefined),
    );
  }
  await Promise.all(tasks);
}

async function notifyHistoryChanged(): Promise<void> {
  await browser.runtime
    .sendMessage({ type: 'history:changed' })
    .catch(() => undefined);
}

async function getOrCreateContext(tab: {
  id: number;
  url: string;
  title: string;
}): Promise<PageContext> {
  const stored = await contexts.get(tab.id, tab.url);
  if (stored) {
    if (stored.status !== 'answering' || answeringPages.has(stored.key)) {
      return stored;
    }
    const recovered = recoverInterruptedQuestionTurn(stored);
    await contexts.save(recovered);
    return recovered;
  }

  let context = createPageContext(tab.id, tab.url, tab.title);
  const messages = await conversations.load(tab.url);
  if (messages.length) context = { ...context, messages };
  await contexts.save(context);
  return context;
}

async function activatePage(tab: PageTab): Promise<PageContext> {
  const operationKey = createPageKey(tab.id, tab.url);
  const generation = invalidatePageOperations(operationKey);
  const current = await getOrCreateContext(tab);
  const parsing: PageContext = {
    ...current,
    status: 'parsing',
    warning: null,
    warningDetail: null,
    updatedAt: Date.now(),
  };
  requireCurrentPageOperation(operationKey, generation);
  await contexts.save(parsing);
  await notify(parsing);

  try {
    const article = (await browser.tabs.sendMessage(tab.id, {
      type: 'page:extract',
    } satisfies ContentRequest)) as ArticleDocument;
    requireCurrentPageOperation(operationKey, generation);
    await requireMatchingTab(tab.id, tab.url);
    requireCurrentPageOperation(operationKey, generation);
    const ready: PageContext = {
      ...parsing,
      title: article.title,
      article,
      status: article.isPartial ? 'partial' : 'ready',
      warning: article.isPartial ? '当前页面只读取到部分内容' : null,
      warningDetail: null,
      updatedAt: Date.now(),
    };
    await contexts.save(ready);
    await notify(ready);
    return ready;
  } catch (cause) {
    if (cause instanceof StalePageOperationError) throw cause;
    if (cause instanceof StalePageContextError) {
      await contexts.deletePage(tab.id, tab.url);
      throw cause;
    }
    requireCurrentPageOperation(operationKey, generation);
    const detail = errorMessage(cause);
    const failed: PageContext = {
      ...parsing,
      status: 'failed',
      warning: detail,
      warningDetail: detail,
      updatedAt: Date.now(),
    };
    await contexts.save(failed);
    await notify(failed);
    throw new Error(`页面读取失败：${detail}`);
  }
}

function message(
  role: ChatMessage['role'],
  content: string,
  answeredBy?: AnswerModel,
  reference?: MessageReference,
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
    ...(reference ? { reference } : {}),
    ...(answeredBy ? { answeredBy } : {}),
  };
}

async function performAskPage(
  question: string,
  tab: PageTab,
  operationKey: string,
  generation: number,
): Promise<PageContext> {
  const archiveVersion = historyOperations.snapshot(historyKey(tab.url));
  const current = await getOrCreateContext(tab);
  if (!current.article || !['ready', 'partial'].includes(current.status)) {
    throw new Error('请先读取当前页面，再发送问题。');
  }

  const settings = await loadSettings();
  if (!settings.apiKey.trim()) {
    throw new Error('请先在设置中填写 DeepSeek API Key。');
  }

  const chunks = createArticleChunks(articleContentBlocks(current.article));
  let selectedContext = selectArticleContext(chunks, {
    question,
    focusText: current.focus?.text,
    focusSection: current.focus?.section,
    focusScope:
      current.focus?.type === 'text' ? current.focus.scope : undefined,
    focusHeadingLevel:
      current.focus?.type === 'text'
        ? current.focus.headingLevel
        : undefined,
    limit: DEFAULT_RELEVANT_CHUNK_LIMIT,
  });
  const userMessage = message(
    'user',
    question,
    undefined,
    snapshotMessageReference(current.focus),
  );
  const withQuestion: PageContext = {
    ...current,
    status: 'answering',
    messages: [...current.messages, userMessage],
    updatedAt: Date.now(),
  };
  await requireMatchingTab(tab.id, tab.url);
  requireCurrentPageOperation(operationKey, generation);
  await contexts.save(withQuestion);
  await notify(withQuestion);

  try {
    if (
      !current.focus &&
      selectedContext.mode === 'relevant' &&
      shouldPlanRetrieval({
        question,
        hasEvidence: selectedContext.chunks.length > 0,
        hasHistory: current.messages.some(
          (item) => item.role === 'assistant' && !item.error,
        ),
      })
    ) {
      const plan = await planRetrievalQueries(
        {
          article: current.article,
          question,
          history: current.messages,
        },
        (request) =>
          modelClient.complete(settings.apiKey, request, {
            timeoutMs: QUERY_PLANNER_TIMEOUT_MS,
          }),
      );
      requireCurrentPageOperation(operationKey, generation);
      await requireMatchingTab(tab.id, tab.url);
      if (plan) {
        selectedContext = selectArticleContext(chunks, {
          question,
          searchQueries: [plan.rewrittenQuestion, ...plan.queries],
          limit: DEFAULT_RELEVANT_CHUNK_LIMIT,
        });
      }
    }
    const request = buildModelRequest({
      article: current.article,
      question,
      relevantChunks: selectedContext.chunks,
      history: current.messages,
      focus: current.focus,
      contextMode: selectedContext.mode,
      contextTruncated: selectedContext.isTruncated,
    });
    const answer = await modelClient.complete(settings.apiKey, request);
    requireCurrentPageOperation(operationKey, generation);
    await requireMatchingTab(tab.id, tab.url);
    const completed = await contexts.update(
      tab.id,
      tab.url,
      (latest) => {
        requireCurrentPageOperation(operationKey, generation);
        if (
          !latest.article ||
          latest.status !== 'answering' ||
          !latest.messages.some((item) => item.id === userMessage.id)
        ) {
          throw new StalePageOperationError(
            '页面状态已更新，已忽略过期回答。',
          );
        }
        return completeQuestionTurn(
          latest,
          message('assistant', answer, 'deepseek'),
        );
      },
    );
    if (!completed) {
      throw new StalePageOperationError(
        '页面状态已更新，已忽略过期回答。',
      );
    }
    let finalized = completed;
    if (settings.retainConversations) {
      try {
        requireCurrentPageOperation(operationKey, generation);
        if (historyOperations.isCurrent(historyKey(tab.url), archiveVersion)) {
          await conversations.save(completed);
          await notifyHistoryChanged();
        }
      } catch (cause) {
        if (cause instanceof StalePageOperationError) throw cause;
        finalized =
          (await contexts.update(tab.id, tab.url, (latest) => ({
            ...latest,
            warning: [latest.warning, '回答已生成，但本地对话归档失败。']
              .filter(Boolean)
              .join('；'),
            warningDetail: errorMessage(cause),
            updatedAt: Date.now(),
          }))) ?? completed;
      }
    }
    await notify(finalized);
    return finalized;
  } catch (cause) {
    if (cause instanceof StalePageOperationError) throw cause;
    requireCurrentPageOperation(operationKey, generation);
    if (!(await tabMatchesUrl(tab.id, tab.url))) {
      await contexts.deletePage(tab.id, tab.url);
      throw new StalePageContextError(
        '原页面已关闭或跳转，请在当前页面重新打开 Context Reader。',
      );
    }
    const recovered = await contexts.update(tab.id, tab.url, (latest) => {
      requireCurrentPageOperation(operationKey, generation);
      if (!latest.messages.some((item) => item.id === userMessage.id)) {
        throw new StalePageOperationError(
          '页面状态已更新，已忽略过期回答。',
        );
      }
      return failQuestionTurn(latest, userMessage.id);
    });
    if (!recovered) {
      throw new StalePageOperationError(
        '页面状态已更新，已忽略过期回答。',
      );
    }
    await notify(recovered);
    throw cause;
  }
}

async function askPage(
  question: string,
  tab: PageTab,
): Promise<PageContext> {
  const operationKey = createPageKey(tab.id, tab.url);
  if (answeringPages.has(operationKey)) {
    throw new Error('当前页面正在生成回答，请稍候。');
  }
  const answerToken = Symbol(operationKey);
  answeringPages.set(operationKey, answerToken);
  const generation = currentPageGeneration(operationKey);
  try {
    return await performAskPage(question, tab, operationKey, generation);
  } finally {
    if (answeringPages.get(operationKey) === answerToken) {
      answeringPages.delete(operationKey);
    }
  }
}

async function translateSelection(
  text: string,
  section: string,
  tab: PageTab,
): Promise<string> {
  const selectedText = text.replace(/\s+/g, ' ').trim().slice(0, 4_000);
  if (!selectedText) throw new Error('请先选择需要翻译的文字。');

  const current = await getOrCreateContext(tab);
  if (
    !current.article ||
    !['ready', 'partial', 'answering'].includes(current.status)
  ) {
    throw new Error('请先读取当前页面，再翻译所选文字。');
  }

  const settings = await loadSettings();
  if (!settings.apiKey.trim()) {
    throw new Error('请先在设置中填写 DeepSeek API Key。');
  }

  const chunks = createArticleChunks(articleContentBlocks(current.article));
  const selectedContext = selectArticleContext(chunks, {
    question: selectedText,
    focusText: selectedText,
    focusSection: section,
    limit: 3,
  });
  const translationInput = {
    article: current.article,
    text: selectedText,
    section: section.trim() || current.article.title,
    relevantChunks: selectedContext.chunks,
  };
  let translation = await modelClient.complete(
    settings.apiKey,
    buildTranslationRequest(translationInput),
  );
  if (shouldRetryUnchangedTranslation(selectedText, translation)) {
    translation = await modelClient.complete(
      settings.apiKey,
      buildTranslationRequest({
        ...translationInput,
        forceTranslation: true,
      }),
    );
  }
  await requireMatchingTab(tab.id, tab.url);
  return translation;
}

async function clearPage(tab: PageTab): Promise<PageContext> {
  invalidatePageOperations(createPageKey(tab.id, tab.url));
  await contexts.deletePage(tab.id, tab.url);
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
  await getOrCreateContext({
    id: sender.tab.id,
    url: sender.tab.url,
    title: sender.tab.title || new URL(sender.tab.url).hostname,
  });
  const updated = await contexts.update(
    sender.tab.id,
    sender.tab.url,
    (current) => {
      if (
        !current.article ||
        !['ready', 'partial', 'answering'].includes(current.status)
      ) {
        throw new Error('请先读取当前页面。');
      }
      return {
        ...current,
        focus,
        updatedAt: Date.now(),
      };
    },
  );
  if (!updated) throw new Error('当前页面上下文已失效，请重新理解页面。');
  await notify(updated);
  return updated;
}

async function clearFocus(tab: PageTab): Promise<PageContext> {
  await getOrCreateContext(tab);
  const updated = await contexts.update(tab.id, tab.url, (current) => ({
    ...current,
    focus: null,
    updatedAt: Date.now(),
  }));
  if (!updated) throw new Error('当前页面上下文已失效，请重新理解页面。');
  await notify(updated);
  return updated;
}

async function studyContext(
  tabId: number,
  url: string,
): Promise<PageContext> {
  await requireMatchingTab(tabId, url);
  const context = await contexts.get(tabId, url);
  if (!context?.article || !['ready', 'partial', 'answering'].includes(context.status)) {
    throw new Error('原页面上下文已失效，请返回原页面重新打开学习工作台。');
  }
  return context;
}

async function setStudyFocus(
  tabId: number,
  url: string,
  focus: FocusContext | null,
): Promise<PageContext> {
  await studyContext(tabId, url);
  const updated = await contexts.update(tabId, url, (current) => {
    if (
      !current.article ||
      !['ready', 'partial', 'answering'].includes(current.status)
    ) {
      throw new Error('原页面上下文已失效，请返回原页面重新打开学习工作台。');
    }
    return {
      ...current,
      focus,
      updatedAt: Date.now(),
    };
  });
  if (!updated) {
    throw new Error('原页面上下文已失效，请返回原页面重新打开学习工作台。');
  }
  await notify(updated);
  return updated;
}

async function openStudy(tab: PageTab): Promise<void> {
  await studyContext(tab.id, tab.url);
  const params = new URLSearchParams({
    tabId: String(tab.id),
    url: tab.url,
  });
  await browser.tabs.create({
    url: extensionUrl(`/study.html?${params.toString()}`),
  });
}

async function openHistory(): Promise<void> {
  await browser.tabs.create({
    url: extensionUrl('/library.html'),
  });
}

async function clearArchivedConversation(url: string): Promise<void> {
  historyOperations.invalidate(historyKey(url));
  const matching = await contexts.listForUrl(url);
  for (const context of matching) {
    invalidatePageOperations(createPageKey(context.tabId, context.url));
  }
  const updated = await contexts.replaceMessagesForUrl(url, []);
  await conversations.delete(url);
  await Promise.all(updated.map(notify));
  await notifyHistoryChanged();
}

async function clearArchivedConversations(): Promise<void> {
  historyOperations.invalidateAll();
  const activeContexts = await contexts.listAll();
  for (const context of activeContexts) {
    invalidatePageOperations(createPageKey(context.tabId, context.url));
  }
  const updated = await contexts.clearAllMessages();
  await conversations.clear();
  await Promise.all(updated.map(notify));
  await notifyHistoryChanged();
}

async function hydrateArchivedMessages(
  context: PageContext,
): Promise<PageContext> {
  const key = historyKey(context.url);
  const version = historyOperations.snapshot(key);
  const archived = await conversations.load(context.url);
  if (
    !archived.length ||
    context.status === 'answering' ||
    !historyOperations.isCurrent(key, version)
  ) {
    return context;
  }
  const updated = await contexts.update(
    context.tabId,
    context.url,
    (latest) => {
      if (
        latest.status === 'answering' ||
        !historyOperations.isCurrent(key, version)
      ) {
        return latest;
      }
      return {
        ...latest,
        messages: mergeConversationMessages(archived, latest.messages),
        updatedAt: Date.now(),
      };
    },
  );
  if (!updated) return context;
  await notify(updated);
  return updated;
}

function asPageTab(tab: Browser.tabs.Tab): PageTab | null {
  if (tab.id == null || !isSupportedUrl(tab.url)) return null;
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title || new URL(tab.url).hostname,
    windowId: tab.windowId,
  };
}

async function focusTab(tab: Browser.tabs.Tab): Promise<void> {
  if (tab.id == null) return;
  await browser.tabs.update(tab.id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
}

async function waitForTabComplete(
  tabId: number,
  timeoutMs = 30_000,
): Promise<Browser.tabs.Tab> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (tab: Browser.tabs.Tab) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve(tab);
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      browser.tabs.onUpdated.removeListener(onUpdated);
      reject(cause);
    };
    const timeout = setTimeout(() => {
      fail(new Error('原网页加载超时，请稍后重试。'));
    }, timeoutMs);
    const onUpdated = (
      updatedTabId: number,
      changeInfo: Browser.tabs.OnUpdatedInfo,
      tab: Browser.tabs.Tab,
    ) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
      finish(tab);
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    void browser.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') finish(tab);
      })
      .catch(fail);
  });
}

async function continueConversation(url: string): Promise<void> {
  const archived = await conversations.get(url);
  if (!archived) throw new Error('这条学习记录不存在或已被删除。');

  const matchingTabs = (await browser.tabs.query({})).filter(
    (tab) =>
      isSupportedUrl(tab.url) &&
      normalizePageUrl(tab.url) === archived.normalizedUrl,
  );
  for (const tab of matchingTabs) {
    const pageTab = asPageTab(tab);
    if (!pageTab) continue;
    const context = await contexts.get(pageTab.id, pageTab.url);
    if (
      context?.article &&
      ['ready', 'partial', 'answering'].includes(context.status)
    ) {
      await hydrateArchivedMessages(context);
      await focusTab(tab);
      await openAssistant(tab, false);
      return;
    }
  }

  const existingTab = matchingTabs[0];
  if (existingTab) {
    await focusTab(existingTab);
    await openAssistant(existingTab, true);
    return;
  }

  const created = await browser.tabs.create({
    url: archived.normalizedUrl,
    active: true,
  });
  if (created.id == null) throw new Error('无法打开原网页。');
  const loaded = await waitForTabComplete(created.id);
  await openAssistant(loaded, true);
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
      case 'translate':
        return success(
          await translateSelection(
            request.text,
            request.section,
            await requestTab(sender),
          ),
        );
      case 'study:open':
        await openStudy(await requestTab(sender));
        return success(undefined);
      case 'study:context:get':
        return success(await studyContext(request.tabId, request.url));
      case 'study:chat:ask':
        return success(
          await askPage(request.question, {
            id: request.tabId,
            url: request.url,
            title: (await studyContext(request.tabId, request.url)).title,
            windowId: sender.tab?.windowId ?? 0,
          }),
        );
      case 'study:translate':
        return success(
          await translateSelection(request.text, request.section, {
            id: request.tabId,
            url: request.url,
            title: (await studyContext(request.tabId, request.url)).title,
            windowId: sender.tab?.windowId ?? 0,
          }),
        );
      case 'study:focus:set':
        return success(
          await setStudyFocus(request.tabId, request.url, request.focus),
        );
      case 'study:focus:clear':
        return success(
          await setStudyFocus(request.tabId, request.url, null),
        );
      case 'study:source:open':
        await studyContext(request.tabId, request.url);
        {
          const sourceTab = await browser.tabs.update(request.tabId, {
            active: true,
          });
          if (sourceTab?.windowId != null) {
            await browser.windows.update(sourceTab.windowId, {
              focused: true,
            });
          }
        }
        return success(undefined);
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
        if (sender.tab?.id == null) throw new Error('无法识别当前标签页。');
        return success(
          await captureVisibleTabForSender(
            sender.tab.id,
            sender.tab.windowId,
            { format: 'png' },
          ),
        );
      }
      case 'history:list':
        return success(await conversations.list(request.query));
      case 'history:get':
        return success(await conversations.get(request.url));
      case 'history:delete':
        await clearArchivedConversation(request.url);
        return success(undefined);
      case 'history:clear':
        await clearArchivedConversations();
        return success(undefined);
      case 'history:usage':
        return success(await conversations.usage());
      case 'history:open':
        await openHistory();
        return success(undefined);
      case 'history:continue':
        await continueConversation(request.url);
        return success(undefined);
      case 'settings:open':
        await browser.runtime.openOptionsPage();
        return success(undefined);
      case 'settings:has-key':
        return success(Boolean((await loadSettings()).apiKey.trim()));
    }
  } catch (cause) {
    return failure(cause);
  }
}

async function openAssistant(
  tab: Browser.tabs.Tab,
  activate = true,
): Promise<void> {
  if (tab.id == null || !isSupportedUrl(tab.url)) return;

  const request = {
    type: 'assistant:open',
    activate,
  } satisfies ContentRequest;
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
  void browser.storage.local
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch(() => undefined);

  browser.action.onClicked.addListener((tab) => {
    void openAssistant(tab);
  });

  browser.runtime.onMessage.addListener(
    (request: ExtensionRequest, sender) => handleRequest(request, sender),
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    const archiveCheckpoint = historyOperations.checkpoint();
    void (async () => {
      try {
        const tabContexts = await contexts.listForTab(tabId);
        const settings = await loadSettings();
        const archivable = tabContexts.filter((context) => {
          if (!settings.retainConversations || !context.messages.length) {
            return false;
          }
          return historyOperations.isCheckpointCurrent(
            historyKey(context.url),
            archiveCheckpoint,
          );
        });
        if (archivable.length) {
          await Promise.all(
            archivable.map((context) => conversations.save(context)),
          );
          await notifyHistoryChanged();
        }
      } finally {
        await contexts.deleteTab(tabId);
      }
    })().catch(() => undefined);
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const settingsChange = changes[SETTINGS_KEY];
    const previous = settingsChange?.oldValue as
      | { retainConversations?: boolean }
      | undefined;
    const next = settingsChange?.newValue as
      | { retainConversations?: boolean }
      | undefined;
    if (previous?.retainConversations || !next?.retainConversations) return;
    const archiveCheckpoint = historyOperations.checkpoint();
    void (async () => {
      const activeContexts = await contexts.listAll();
      const archivable = activeContexts.filter((context) => {
        if (!context.messages.length) return false;
        return historyOperations.isCheckpointCurrent(
          historyKey(context.url),
          archiveCheckpoint,
        );
      });
      if (!archivable.length) return;
      await Promise.all(
        archivable.map((context) => conversations.save(context)),
      );
      await notifyHistoryChanged();
    })().catch(() => undefined);
  });
});

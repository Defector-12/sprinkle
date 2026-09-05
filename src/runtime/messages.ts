import type {
  ArchivedConversation,
  ArticleDocument,
  ConversationArchiveUsage,
  ConversationSummary,
  FocusContext,
  PageContext,
} from '../core/types.ts';

interface ExtensionRequestPayloadMap {
  'context:get': Record<never, never>;
  'context:activate': Record<never, never>;
  'context:clear': Record<never, never>;
  'chat:ask': { question: string };
  translate: { text: string; section: string };
  'study:open': Record<never, never>;
  'study:context:get': { tabId: number; url: string };
  'study:chat:ask': { tabId: number; url: string; question: string };
  'study:translate': {
    tabId: number;
    url: string;
    text: string;
    section: string;
  };
  'study:focus:set': {
    tabId: number;
    url: string;
    focus: FocusContext;
  };
  'study:focus:clear': { tabId: number; url: string };
  'study:source:open': { tabId: number; url: string };
  'picker:image:start': Record<never, never>;
  'picker:region:start': Record<never, never>;
  'focus:set': { focus: FocusContext };
  'focus:clear': Record<never, never>;
  'capture:visible': Record<never, never>;
  'history:list': { query?: string };
  'history:get': { url: string };
  'history:delete': { url: string };
  'history:clear': Record<never, never>;
  'history:usage': Record<never, never>;
  'history:open': Record<never, never>;
  'history:continue': { url: string };
  'settings:has-key': Record<never, never>;
  'settings:open': Record<never, never>;
}

export interface ExtensionResponseMap {
  'context:get': PageContext;
  'context:activate': PageContext;
  'context:clear': PageContext;
  'chat:ask': PageContext;
  translate: string;
  'study:open': void;
  'study:context:get': PageContext;
  'study:chat:ask': PageContext;
  'study:translate': string;
  'study:focus:set': PageContext;
  'study:focus:clear': PageContext;
  'study:source:open': void;
  'picker:image:start': void;
  'picker:region:start': void;
  'focus:set': PageContext;
  'focus:clear': PageContext;
  'capture:visible': string;
  'history:list': ConversationSummary[];
  'history:get': ArchivedConversation | null;
  'history:delete': void;
  'history:clear': void;
  'history:usage': ConversationArchiveUsage;
  'history:open': void;
  'history:continue': void;
  'settings:has-key': boolean;
  'settings:open': void;
}

export type ExtensionRequestType = keyof ExtensionRequestPayloadMap;

export type ExtensionRequest<
  Type extends ExtensionRequestType = ExtensionRequestType,
> = Type extends ExtensionRequestType
  ? { type: Type } & ExtensionRequestPayloadMap[Type]
  : never;

export type ExtensionResponse<Request extends ExtensionRequest> =
  ExtensionResponseMap[Request['type']];

export type ContentRequest =
  | { type: 'page:extract' }
  | { type: 'assistant:open'; activate?: boolean }
  | { type: 'picker:image:start' }
  | { type: 'picker:region:start' };

export type ContentResponse =
  | ArticleDocument
  | {
      ok: true;
    };

export type RuntimeResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

export interface ContextChangedEvent {
  type: 'context:changed';
  context: PageContext;
}

export interface HistoryChangedEvent {
  type: 'history:changed';
}

export interface HistoryApi {
  list(query?: string): Promise<ConversationSummary[]>;
  get(url: string): Promise<ArchivedConversation | null>;
  delete(url: string): Promise<void>;
  clear(): Promise<void>;
  usage(): Promise<ConversationArchiveUsage>;
  continue(url: string): Promise<void>;
}

export function isContextChangedEvent(
  value: unknown,
): value is ContextChangedEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ContextChangedEvent>;
  return candidate.type === 'context:changed' && Boolean(candidate.context);
}

export function isHistoryChangedEvent(
  value: unknown,
): value is HistoryChangedEvent {
  if (!value || typeof value !== 'object') return false;
  return (value as Partial<HistoryChangedEvent>).type === 'history:changed';
}

import type {
  ArchivedConversation,
  ArticleDocument,
  ConversationArchiveUsage,
  ConversationSummary,
  FocusContext,
  PageContext,
} from '../core/types.ts';

export interface StudyCaptureRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ExtensionRequest =
  | { type: 'context:get' }
  | { type: 'context:activate' }
  | { type: 'context:clear' }
  | { type: 'chat:ask'; question: string }
  | { type: 'translate'; text: string; section: string }
  | { type: 'study:open' }
  | { type: 'study:context:get'; tabId: number; url: string }
  | {
      type: 'study:chat:ask';
      tabId: number;
      url: string;
      question: string;
    }
  | {
      type: 'study:translate';
      tabId: number;
      url: string;
      text: string;
      section: string;
    }
  | {
      type: 'study:focus:set';
      tabId: number;
      url: string;
      focus: FocusContext;
    }
  | { type: 'study:focus:clear'; tabId: number; url: string }
  | { type: 'study:source:open'; tabId: number; url: string }
  | { type: 'picker:image:start' }
  | { type: 'picker:region:start' }
  | { type: 'focus:set'; focus: FocusContext }
  | { type: 'focus:clear' }
  | { type: 'capture:visible' }
  | { type: 'history:list'; query?: string }
  | { type: 'history:get'; url: string }
  | { type: 'history:delete'; url: string }
  | { type: 'history:clear' }
  | { type: 'history:usage' }
  | { type: 'history:open' }
  | { type: 'history:continue'; url: string }
  | { type: 'settings:has-key' }
  | { type: 'settings:open' };

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

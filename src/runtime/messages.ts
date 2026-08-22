import type {
  ArticleDocument,
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
  | { type: 'study:open' }
  | { type: 'study:context:get'; tabId: number; url: string }
  | {
      type: 'study:chat:ask';
      tabId: number;
      url: string;
      question: string;
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
  | { type: 'settings:has-key' }
  | { type: 'settings:open' };

export type ContentRequest =
  | { type: 'page:extract' }
  | { type: 'assistant:open' }
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

export function isContextChangedEvent(
  value: unknown,
): value is ContextChangedEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ContextChangedEvent>;
  return candidate.type === 'context:changed' && Boolean(candidate.context);
}

import type {
  ArticleDocument,
  FocusContext,
  PageContext,
} from '../core/types.ts';

export type ExtensionRequest =
  | { type: 'context:get' }
  | { type: 'context:activate' }
  | { type: 'context:clear' }
  | { type: 'chat:ask'; question: string }
  | { type: 'picker:image:start' }
  | { type: 'picker:region:start' }
  | { type: 'focus:set'; focus: FocusContext }
  | { type: 'capture:visible' };

export type ContentRequest =
  | { type: 'page:extract' }
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

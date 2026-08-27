import { browser } from 'wxt/browser';

import type {
  ArchivedConversation,
  ConversationArchiveUsage,
  ConversationSummary,
} from '../core/types.ts';
import { isHistoryChangedEvent } from './messages.ts';
import { sendRuntimeRequest } from './runtime-client.ts';

export interface HistoryLibraryBridgeContract {
  list(query?: string): Promise<ConversationSummary[]>;
  get(url: string): Promise<ArchivedConversation | null>;
  delete(url: string): Promise<void>;
  clear(): Promise<void>;
  usage(): Promise<ConversationArchiveUsage>;
  continue(url: string): Promise<void>;
  openSettings(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export class HistoryLibraryBridge implements HistoryLibraryBridgeContract {
  list(query = ''): Promise<ConversationSummary[]> {
    return sendRuntimeRequest<ConversationSummary[]>({
      type: 'history:list',
      query,
    });
  }

  get(url: string): Promise<ArchivedConversation | null> {
    return sendRuntimeRequest<ArchivedConversation | null>({
      type: 'history:get',
      url,
    });
  }

  async delete(url: string): Promise<void> {
    await sendRuntimeRequest<void>({ type: 'history:delete', url });
  }

  async clear(): Promise<void> {
    await sendRuntimeRequest<void>({ type: 'history:clear' });
  }

  usage(): Promise<ConversationArchiveUsage> {
    return sendRuntimeRequest<ConversationArchiveUsage>({
      type: 'history:usage',
    });
  }

  async continue(url: string): Promise<void> {
    await sendRuntimeRequest<void>({ type: 'history:continue', url });
  }

  async openSettings(): Promise<void> {
    await sendRuntimeRequest<void>({ type: 'settings:open' });
  }

  subscribe(listener: () => void): () => void {
    const onMessage = (message: unknown) => {
      if (isHistoryChangedEvent(message)) listener();
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }
}

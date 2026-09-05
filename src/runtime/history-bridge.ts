import { browser } from 'wxt/browser';

import type { HistoryLibraryBridgeContract } from '../application/ports.ts';
import { isHistoryChangedEvent } from './messages.ts';
import { sendRuntimeRequest } from './runtime-client.ts';

export class HistoryLibraryBridge implements HistoryLibraryBridgeContract {
  list(query = '') {
    return sendRuntimeRequest({
      type: 'history:list',
      query,
    });
  }

  get(url: string) {
    return sendRuntimeRequest({
      type: 'history:get',
      url,
    });
  }

  async delete(url: string): Promise<void> {
    await sendRuntimeRequest({ type: 'history:delete', url });
  }

  async clear(): Promise<void> {
    await sendRuntimeRequest({ type: 'history:clear' });
  }

  usage() {
    return sendRuntimeRequest({
      type: 'history:usage',
    });
  }

  async continue(url: string): Promise<void> {
    await sendRuntimeRequest({ type: 'history:continue', url });
  }

  async openSettings(): Promise<void> {
    await sendRuntimeRequest({ type: 'settings:open' });
  }

  subscribe(listener: () => void): () => void {
    const onMessage = (message: unknown) => {
      if (isHistoryChangedEvent(message)) listener();
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }
}

import { browser } from 'wxt/browser';

import type { ExtensionBridge } from '../components/SidePanelApp.tsx';
import type { PageContext } from '../core/types.ts';
import {
  isContextChangedEvent,
  type ExtensionRequest,
  type RuntimeResult,
} from './messages.ts';

async function send<T>(message: ExtensionRequest): Promise<T> {
  const response = (await browser.runtime.sendMessage(
    message,
  )) as RuntimeResult<T>;
  if (!response) throw new Error('扩展后台没有响应');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

export class BrowserExtensionBridge implements ExtensionBridge {
  getActiveContext(): Promise<PageContext> {
    return send<PageContext>({ type: 'context:get' });
  }

  activatePage(): Promise<PageContext> {
    return send<PageContext>({ type: 'context:activate' });
  }

  ask(question: string): Promise<PageContext> {
    return send<PageContext>({ type: 'chat:ask', question });
  }

  clearContext(): Promise<PageContext> {
    return send<PageContext>({ type: 'context:clear' });
  }

  async startImagePicker(): Promise<void> {
    await send<void>({ type: 'picker:image:start' });
  }

  async startRegionPicker(): Promise<void> {
    await send<void>({ type: 'picker:region:start' });
  }

  async openSettings(): Promise<void> {
    await browser.runtime.openOptionsPage();
  }

  subscribe(listener: (context: PageContext) => void): () => void {
    let stopped = false;

    const refresh = () => {
      void this.getActiveContext()
        .then((context) => {
          if (!stopped) listener(context);
        })
        .catch(() => undefined);
    };
    const onRuntimeMessage = (message: unknown) => {
      if (isContextChangedEvent(message)) refresh();
    };
    const onTabActivated = () => refresh();
    const onTabUpdated = (
      _tabId: number,
      changeInfo: { status?: string; url?: string },
    ) => {
      if (changeInfo.status === 'complete' || changeInfo.url) refresh();
    };

    browser.runtime.onMessage.addListener(onRuntimeMessage);
    browser.tabs.onActivated.addListener(onTabActivated);
    browser.tabs.onUpdated.addListener(onTabUpdated);

    return () => {
      stopped = true;
      browser.runtime.onMessage.removeListener(onRuntimeMessage);
      browser.tabs.onActivated.removeListener(onTabActivated);
      browser.tabs.onUpdated.removeListener(onTabUpdated);
    };
  }
}

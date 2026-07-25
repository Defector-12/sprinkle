import { browser } from 'wxt/browser';

import type { FloatingAssistantBridge } from '../components/FloatingAssistant.tsx';
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

export class ContentAssistantBridge implements FloatingAssistantBridge {
  initialize(): Promise<PageContext> {
    return send<PageContext>({ type: 'context:get' });
  }

  activate(): Promise<PageContext> {
    return send<PageContext>({ type: 'context:activate' });
  }

  deactivate(): Promise<PageContext> {
    return send<PageContext>({ type: 'context:clear' });
  }

  hasApiKey(): Promise<boolean> {
    return send<boolean>({ type: 'settings:has-key' });
  }

  ask(question: string): Promise<PageContext> {
    return send<PageContext>({ type: 'chat:ask', question });
  }

  async openSettings(): Promise<void> {
    await send<void>({ type: 'settings:open' });
  }

  subscribe(listener: (context: PageContext) => void): () => void {
    const onMessage = (message: unknown) => {
      if (isContextChangedEvent(message)) listener(message.context);
    };

    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }
}

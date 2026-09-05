import { browser } from 'wxt/browser';

import type { FloatingAssistantBridge } from '../application/ports.ts';
import type { ImageFocus, PageContext } from '../core/types.ts';
import { normalizePageUrl } from '../core/url.ts';
import { isContextChangedEvent } from './messages.ts';
import { sendRuntimeRequest } from './runtime-client.ts';

export class ContentAssistantBridge implements FloatingAssistantBridge {
  initialize(): Promise<PageContext> {
    return sendRuntimeRequest({ type: 'context:get' });
  }

  activate(): Promise<PageContext> {
    return sendRuntimeRequest({ type: 'context:activate' });
  }

  deactivate(): Promise<PageContext> {
    return sendRuntimeRequest({ type: 'context:clear' });
  }

  hasApiKey(): Promise<boolean> {
    return sendRuntimeRequest({ type: 'settings:has-key' });
  }

  ask(question: string): Promise<PageContext> {
    return sendRuntimeRequest({ type: 'chat:ask', question });
  }

  async startImagePicker(): Promise<void> {
    await sendRuntimeRequest({ type: 'picker:image:start' });
  }

  async startRegionPicker(): Promise<void> {
    await sendRuntimeRequest({ type: 'picker:region:start' });
  }

  setImageFocus(focus: ImageFocus): Promise<PageContext> {
    return sendRuntimeRequest({ type: 'focus:set', focus });
  }

  clearFocus(): Promise<PageContext> {
    return sendRuntimeRequest({ type: 'focus:clear' });
  }

  async openStudy(): Promise<void> {
    await sendRuntimeRequest({ type: 'study:open' });
  }

  async openHistory(): Promise<void> {
    await sendRuntimeRequest({ type: 'history:open' });
  }

  async openSettings(): Promise<void> {
    await sendRuntimeRequest({ type: 'settings:open' });
  }

  subscribe(listener: (context: PageContext) => void): () => void {
    const onMessage = (message: unknown) => {
      if (
        isContextChangedEvent(message) &&
        normalizePageUrl(message.context.url) ===
          normalizePageUrl(location.href)
      ) {
        listener(message.context);
      }
    };

    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }
}

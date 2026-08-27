import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage, openOptionsPage, addListener, removeListener } =
  vi.hoisted(() => ({
    sendMessage: vi.fn(),
    openOptionsPage: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage,
      openOptionsPage,
      onMessage: { addListener, removeListener },
    },
  },
}));

import { ContentAssistantBridge } from '../../src/runtime/content-assistant-bridge.ts';
import type { ImageFocus, PageContext } from '../../src/core/types.ts';

describe('ContentAssistantBridge', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    openOptionsPage.mockReset();
    addListener.mockReset();
    removeListener.mockReset();
  });

  it('opens settings through the background instead of the unavailable content API', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });

    await new ContentAssistantBridge().openSettings();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'settings:open' });
    expect(openOptionsPage).not.toHaveBeenCalled();
  });

  it('opens the workspace and learning records through background', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });
    const bridge = new ContentAssistantBridge();

    await bridge.openStudy();
    await bridge.openHistory();

    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'study:open' });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'history:open',
    });
  });

  it('loads dormant context without starting page extraction', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });

    await new ContentAssistantBridge().initialize();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'context:get' });
  });

  it('routes explicit activation, deactivation, and API key status through background', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });
    const bridge = new ContentAssistantBridge();

    await bridge.activate();
    await bridge.deactivate();
    await bridge.hasApiKey();

    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'context:activate',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'context:clear',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(3, {
      type: 'settings:has-key',
    });
  });

  it('routes image tools and focus clearing through background', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });
    const bridge = new ContentAssistantBridge();
    const focus: ImageFocus = {
      type: 'image',
      imageUrl: 'data:image/png;base64,cGl4ZWxz',
      alt: 'local.png',
      text: 'local.png',
      section: '本地上传',
      source: 'upload',
    };

    await bridge.startImagePicker();
    await bridge.startRegionPicker();
    await bridge.setImageFocus(focus);
    await bridge.clearFocus();

    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'picker:image:start',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'picker:region:start',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(3, {
      type: 'focus:set',
      focus,
    });
    expect(sendMessage).toHaveBeenNthCalledWith(4, {
      type: 'focus:clear',
    });
  });

  it('surfaces a background failure when settings cannot open', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: '无法打开设置' });

    await expect(new ContentAssistantBridge().openSettings()).rejects.toThrow(
      '无法打开设置',
    );
  });

  it('ignores context updates for a previous page in the same tab', () => {
    const bridge = new ContentAssistantBridge();
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    const onMessage = addListener.mock.calls[0]?.[0] as (
      message: unknown,
    ) => void;
    const context = {
      key: '7:https://example.com/previous',
      tabId: 7,
      url: 'https://example.com/previous',
      normalizedUrl: 'https://example.com/previous',
      title: 'Previous page',
      status: 'ready',
      article: null,
      focus: null,
      messages: [],
      warning: null,
      updatedAt: 1,
    } satisfies PageContext;

    onMessage({ type: 'context:changed', context });
    expect(listener).not.toHaveBeenCalled();

    onMessage({
      type: 'context:changed',
      context: {
        ...context,
        key: `7:${location.href}`,
        url: location.href,
        normalizedUrl: location.href,
      },
    });
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(onMessage);
  });
});

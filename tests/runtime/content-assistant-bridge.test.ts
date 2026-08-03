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

describe('ContentAssistantBridge', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    openOptionsPage.mockReset();
  });

  it('opens settings through the background instead of the unavailable content API', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });

    await new ContentAssistantBridge().openSettings();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'settings:open' });
    expect(openOptionsPage).not.toHaveBeenCalled();
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

  it('routes image tools, image-key status, and focus clearing through background', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });
    const bridge = new ContentAssistantBridge();

    await bridge.startImagePicker();
    await bridge.startRegionPicker();
    await bridge.hasVisionApiKey();
    await bridge.clearFocus();

    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'picker:image:start',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'picker:region:start',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(3, {
      type: 'settings:has-vision-key',
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
});

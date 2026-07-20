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

  it('surfaces a background failure when settings cannot open', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: '无法打开设置' });

    await expect(new ContentAssistantBridge().openSettings()).rejects.toThrow(
      '无法打开设置',
    );
  });
});

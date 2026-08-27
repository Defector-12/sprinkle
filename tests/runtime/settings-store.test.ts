import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, set, remove, sendMessage } = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage },
    storage: {
      local: { get, set, remove },
      session: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    },
  },
}));

import {
  BrowserSettingsStore,
  loadSettings,
} from '../../src/runtime/settings-store.ts';

describe('settings store', () => {
  beforeEach(() => {
    get.mockReset();
    set.mockReset();
    remove.mockReset();
    sendMessage.mockReset();
  });

  it('loads existing DeepSeek settings without requiring a vision key', async () => {
    get.mockResolvedValue({
      'context-reader:settings': {
        apiKey: 'deepseek-key',
        visionApiKey: 'legacy-doubao-key',
        retainConversations: true,
      },
    });

    await expect(loadSettings()).resolves.toEqual({
      apiKey: 'deepseek-key',
      retainConversations: true,
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('stores the DeepSeek key only in extension local storage', async () => {
    set.mockResolvedValue(undefined);
    const settings = {
      apiKey: 'deepseek-key',
      retainConversations: false,
    };

    await new BrowserSettingsStore().save(settings);

    expect(set).toHaveBeenCalledWith({
      'context-reader:settings': settings,
    });
  });

  it('clears conversations through background so active sessions are updated', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });

    await new BrowserSettingsStore().clearConversations();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'history:clear' });
  });
});

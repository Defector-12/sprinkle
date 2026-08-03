import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, set, remove } = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
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
  });

  it('migrates existing text-only settings with an empty Doubao key', async () => {
    get.mockResolvedValue({
      'context-reader:settings': {
        apiKey: 'deepseek-key',
        retainConversations: true,
      },
    });

    await expect(loadSettings()).resolves.toEqual({
      apiKey: 'deepseek-key',
      visionApiKey: '',
      retainConversations: true,
    });
  });

  it('stores both provider keys only in extension local storage', async () => {
    set.mockResolvedValue(undefined);
    const settings = {
      apiKey: 'deepseek-key',
      visionApiKey: 'doubao-key',
      retainConversations: false,
    };

    await new BrowserSettingsStore().save(settings);

    expect(set).toHaveBeenCalledWith({
      'context-reader:settings': settings,
    });
  });
});

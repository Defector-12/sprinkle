import { browser } from 'wxt/browser';

import type { SettingsStore } from '../application/ports.ts';
import { DEFAULT_SETTINGS } from '../application/settings.ts';
import type { UserSettings } from '../core/types.ts';
import type { StorageArea } from './context-repository.ts';
import { sendRuntimeRequest } from './runtime-client.ts';

export const SETTINGS_KEY = 'context-reader:settings';

export { DEFAULT_SETTINGS } from '../application/settings.ts';

export function localStorageArea(): StorageArea {
  return {
    get: async (keys) => browser.storage.local.get(keys),
    set: async (items) => browser.storage.local.set(items),
    remove: async (keys) => browser.storage.local.remove(keys),
    getBytesInUse: async (keys) =>
      browser.storage.local.getBytesInUse(keys ?? null),
  };
}

export function sessionStorageArea(): StorageArea {
  return {
    get: async (keys) => browser.storage.session.get(keys),
    set: async (items) => browser.storage.session.set(items),
    remove: async (keys) => browser.storage.session.remove(keys),
  };
}

export async function loadSettings(): Promise<UserSettings> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY] as Partial<UserSettings> | undefined;
  return {
    apiKey:
      typeof stored?.apiKey === 'string'
        ? stored.apiKey
        : DEFAULT_SETTINGS.apiKey,
    retainConversations:
      typeof stored?.retainConversations === 'boolean'
        ? stored.retainConversations
        : DEFAULT_SETTINGS.retainConversations,
  };
}

export class BrowserSettingsStore implements SettingsStore {
  async load(): Promise<UserSettings> {
    return loadSettings();
  }

  async save(settings: UserSettings): Promise<void> {
    await browser.storage.local.set({
      [SETTINGS_KEY]: settings,
    });
  }

  async clearConversations(): Promise<void> {
    await sendRuntimeRequest({ type: 'history:clear' });
  }
}

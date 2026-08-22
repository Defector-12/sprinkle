import { browser } from 'wxt/browser';

import type { SettingsStore } from '../components/SettingsApp.tsx';
import type { UserSettings } from '../core/types.ts';
import {
  ConversationArchive,
  type StorageArea,
} from './context-repository.ts';

const SETTINGS_KEY = 'context-reader:settings';

interface StoredUserSettings extends Partial<UserSettings> {
  visionApiKey?: unknown;
}

export const DEFAULT_SETTINGS: UserSettings = {
  apiKey: '',
  retainConversations: false,
};

export function localStorageArea(): StorageArea {
  return {
    get: async (keys) => browser.storage.local.get(keys),
    set: async (items) => browser.storage.local.set(items),
    remove: async (keys) => browser.storage.local.remove(keys),
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
  const stored = result[SETTINGS_KEY] as StoredUserSettings | undefined;
  const settings: UserSettings = {
    apiKey: typeof stored?.apiKey === 'string' ? stored.apiKey : '',
    retainConversations:
      typeof stored?.retainConversations === 'boolean'
        ? stored.retainConversations
        : false,
  };
  if (stored && 'visionApiKey' in stored) {
    await browser.storage.local.set({ [SETTINGS_KEY]: settings });
  }
  return settings;
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
    await new ConversationArchive(localStorageArea()).clear();
  }
}

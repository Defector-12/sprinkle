import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage, addListener, removeListener } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage,
      onMessage: { addListener, removeListener },
    },
  },
}));

import { HistoryLibraryBridge } from '../../src/runtime/history-bridge.ts';

describe('HistoryLibraryBridge', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    addListener.mockReset();
    removeListener.mockReset();
  });

  it('routes history operations through background', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });
    const bridge = new HistoryLibraryBridge();

    await bridge.list('memory');
    await bridge.get('https://example.com/article');
    await bridge.delete('https://example.com/article');
    await bridge.clear();
    await bridge.usage();
    await bridge.continue('https://example.com/article');
    await bridge.openSettings();

    expect(sendMessage.mock.calls.map(([message]) => message.type)).toEqual([
      'history:list',
      'history:get',
      'history:delete',
      'history:clear',
      'history:usage',
      'history:continue',
      'settings:open',
    ]);
  });

  it('notifies subscribers only for history changes', () => {
    const bridge = new HistoryLibraryBridge();
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    const onMessage = addListener.mock.calls[0]?.[0] as (
      message: unknown,
    ) => void;

    onMessage({ type: 'context:changed' });
    onMessage({ type: 'history:changed' });

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(onMessage);
  });
});

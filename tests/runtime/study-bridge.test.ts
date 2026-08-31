import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage, createTab, addListener, removeListener } = vi.hoisted(
  () => ({
    sendMessage: vi.fn(),
    createTab: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }),
);

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage,
      getURL: vi.fn((path: string) => `chrome-extension://id${path}`),
      onMessage: { addListener, removeListener },
    },
    tabs: {
      create: createTab,
    },
  },
}));

import { StudyWorkspaceBridge } from '../../src/runtime/study-bridge.ts';

describe('StudyWorkspaceBridge', () => {
  beforeEach(() => {
    sendMessage.mockReset();
    createTab.mockReset();
  });

  it('loads and updates the exact source context instead of the active tab', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });
    const bridge = new StudyWorkspaceBridge({
      tabId: 7,
      url: 'https://example.com/paper',
    });

    await bridge.initialize();
    await bridge.ask('这个结论如何得到？');
    await bridge.translate('working memory', 'Architecture');
    await bridge.setTextFocus('selected theorem', 'Proof');

    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'study:context:get',
      tabId: 7,
      url: 'https://example.com/paper',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'study:chat:ask',
      tabId: 7,
      url: 'https://example.com/paper',
      question: '这个结论如何得到？',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(3, {
      type: 'study:translate',
      tabId: 7,
      url: 'https://example.com/paper',
      text: 'working memory',
      section: 'Architecture',
    });
    expect(sendMessage).toHaveBeenNthCalledWith(4, {
      type: 'study:focus:set',
      tabId: 7,
      url: 'https://example.com/paper',
      focus: {
        type: 'text',
        text: 'selected theorem',
        section: 'Proof',
      },
    });
  });

  it('opens the workspace with an encoded source identity', async () => {
    createTab.mockResolvedValue(undefined);
    const bridge = new StudyWorkspaceBridge({
      tabId: 7,
      url: 'https://example.com/paper?lang=zh',
    });

    await bridge.open();

    expect(createTab).toHaveBeenCalledWith({
      url:
        'chrome-extension://id/study.html?tabId=7&url=https%3A%2F%2Fexample.com%2Fpaper%3Flang%3Dzh',
    });
  });

  it('opens learning records through background', async () => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });
    const bridge = new StudyWorkspaceBridge({
      tabId: 7,
      url: 'https://example.com/paper',
    });

    await bridge.openHistory();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'history:open' });
  });
});

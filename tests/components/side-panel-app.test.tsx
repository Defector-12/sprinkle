import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  SidePanelApp,
  type ExtensionBridge,
} from '../../src/components/SidePanelApp.tsx';
import type { PageContext } from '../../src/core/types.ts';

const unactivatedContext: PageContext = {
  key: '7:https://example.com/post',
  tabId: 7,
  url: 'https://example.com/post',
  normalizedUrl: 'https://example.com/post',
  title: 'Example post',
  status: 'unactivated',
  article: null,
  focus: null,
  messages: [],
  warning: null,
  updatedAt: 1,
};

const readyContext: PageContext = {
  ...unactivatedContext,
  status: 'ready',
  article: {
    title: 'Understanding agent memory',
    url: 'https://example.com/post',
    blocks: [],
    images: [],
    isPartial: false,
  },
};

function createBridge(
  context: PageContext,
  overrides: Partial<ExtensionBridge> = {},
): ExtensionBridge {
  return {
    getActiveContext: vi.fn().mockResolvedValue(context),
    activatePage: vi.fn().mockResolvedValue(readyContext),
    ask: vi.fn().mockResolvedValue(readyContext),
    clearContext: vi.fn().mockResolvedValue(unactivatedContext),
    startImagePicker: vi.fn().mockResolvedValue(undefined),
    startRegionPicker: vi.fn().mockResolvedValue(undefined),
    openSettings: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

describe('SidePanelApp', () => {
  it('requires manual activation before showing the composer', async () => {
    const bridge = createBridge(unactivatedContext);
    render(<SidePanelApp bridge={bridge} />);

    expect(
      await screen.findByRole('heading', { name: '还没有读取这个页面' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: '向当前文章提问' }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: '读取当前页面' }),
    );

    expect(bridge.activatePage).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole('textbox', { name: '向当前文章提问' }),
    ).toBeVisible();
  });

  it('supports text questions and image tools without source UI', async () => {
    const bridge = createBridge(readyContext);
    render(<SidePanelApp bridge={bridge} />);

    const composer = await screen.findByRole('textbox', {
      name: '向当前文章提问',
    });
    await userEvent.type(composer, '这篇文章里的短期记忆是什么？');
    await userEvent.click(screen.getByRole('button', { name: '发送问题' }));

    await waitFor(() => {
      expect(bridge.ask).toHaveBeenCalledWith(
        '这篇文章里的短期记忆是什么？',
      );
    });
    expect(
      screen.getByRole('button', { name: '选择文章图片' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: '框选页面区域' })).toBeVisible();
    expect(screen.queryByText('原文出处')).not.toBeInTheDocument();
  });

  it('offers a retry action after page extraction fails', async () => {
    const failedContext: PageContext = {
      ...unactivatedContext,
      status: 'failed',
      warning: '页面没有可读取的正文',
    };
    const bridge = createBridge(failedContext);
    render(<SidePanelApp bridge={bridge} />);

    expect(
      await screen.findByRole('heading', { name: '页面读取失败' }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: '重新读取页面' }),
    );

    expect(bridge.activatePage).toHaveBeenCalledOnce();
  });
});

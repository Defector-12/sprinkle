import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  FloatingAssistant,
  type FloatingAssistantBridge,
} from '../../src/components/FloatingAssistant.tsx';
import type { PageContext } from '../../src/core/types.ts';

const readyContext: PageContext = {
  key: '7:https://example.com/post',
  tabId: 7,
  url: 'https://example.com/post',
  normalizedUrl: 'https://example.com/post',
  title: 'Understanding agent memory',
  status: 'ready',
  article: {
    title: 'Understanding agent memory',
    url: 'https://example.com/post',
    blocks: [],
    images: [],
    isPartial: false,
  },
  focus: null,
  messages: [],
  warning: null,
  updatedAt: 1,
};

function createBridge(
  context: PageContext = readyContext,
  overrides: Partial<FloatingAssistantBridge> = {},
): FloatingAssistantBridge {
  return {
    initialize: vi.fn().mockResolvedValue(context),
    ask: vi.fn().mockResolvedValue(context),
    openSettings: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

describe('FloatingAssistant', () => {
  it('automatically initializes the page while rendering only a floating button', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);

    expect(
      screen.getByRole('button', { name: '打开 Context Reader' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('dialog', { name: 'Context Reader 对话' }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(bridge.initialize).toHaveBeenCalledOnce());
  });

  it('opens a compact dialog from the floating button and closes with Escape', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      screen.getByRole('button', { name: '打开 Context Reader' }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Context Reader 对话' }),
    ).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: '向当前文章提问' }),
    ).toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: 'Context Reader 对话' }),
    ).not.toBeInTheDocument();
  });

  it('opens from a selection event and shows the selected text as context', async () => {
    const bridge = createBridge({
      ...readyContext,
      focus: {
        type: 'text',
        text: 'Mixture of Experts',
        section: 'Architecture',
      },
    });
    render(<FloatingAssistant bridge={bridge} />);

    act(() => {
      window.dispatchEvent(new CustomEvent('context-reader:open'));
    });

    expect(
      await screen.findByRole('dialog', { name: 'Context Reader 对话' }),
    ).toBeVisible();
    expect(screen.getByText('Mixture of Experts')).toBeVisible();
  });

  it('sends a question and renders the answer inside the same card', async () => {
    const answeredContext: PageContext = {
      ...readyContext,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          content: '这里的 MoE 是什么意思？',
          createdAt: 1,
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '这里指模型按输入选择部分专家网络参与计算。',
          createdAt: 2,
        },
      ],
    };
    const bridge = createBridge(readyContext, {
      ask: vi.fn().mockResolvedValue(answeredContext),
    });
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      screen.getByRole('button', { name: '打开 Context Reader' }),
    );
    const input = screen.getByRole('textbox', { name: '向当前文章提问' });
    await userEvent.type(input, '这里的 MoE 是什么意思？');
    await userEvent.keyboard('{Enter}');

    expect(bridge.ask).toHaveBeenCalledWith('这里的 MoE 是什么意思？');
    expect(
      await screen.findByText('这里指模型按输入选择部分专家网络参与计算。'),
    ).toBeVisible();
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  HistoryLibrary,
  type HistoryLibraryProps,
} from '../../src/components/HistoryLibrary.tsx';
import type {
  ArchivedConversation,
  ConversationSummary,
} from '../../src/core/types.ts';

const url = 'https://example.com/agent-memory';
const conversation: ArchivedConversation = {
  schemaVersion: 2,
  normalizedUrl: url,
  title: 'Agent memory',
  createdAt: 1,
  updatedAt: 2,
  messages: [
    {
      id: 'question-1',
      role: 'user',
      content: 'What is durable memory?',
      createdAt: 1,
      reference: {
        type: 'text',
        text: 'Durable state',
        section: 'Memory',
      },
    },
    {
      id: 'answer-1',
      role: 'assistant',
      content: '**Durable memory** survives the current session.',
      createdAt: 2,
      answeredBy: 'deepseek',
    },
  ],
};
const summary: ConversationSummary = {
  normalizedUrl: url,
  title: conversation.title,
  createdAt: 1,
  updatedAt: 2,
  questionCount: 1,
  lastQuestion: 'What is durable memory?',
};

function createBridge(
  overrides: Partial<HistoryLibraryProps['bridge']> = {},
): HistoryLibraryProps['bridge'] {
  return {
    list: vi.fn().mockResolvedValue([summary]),
    get: vi.fn().mockResolvedValue(conversation),
    delete: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
    usage: vi.fn().mockResolvedValue({
      bytesInUse: 1024,
      quotaBytes: 10 * 1024 * 1024,
    }),
    continue: vi.fn().mockResolvedValue(undefined),
    openSettings: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

describe('HistoryLibrary', () => {
  it('lists saved pages and renders the selected conversation', async () => {
    render(<HistoryLibrary bridge={createBridge()} />);

    expect(
      await screen.findByRole('heading', { name: 'Agent memory' }),
    ).toBeVisible();
    expect(screen.getAllByText('What is durable memory?')).toHaveLength(2);
    expect(screen.getByText('Durable memory')).toBeVisible();
    expect(screen.getByRole('link', { name: /example\.com/ })).toHaveAttribute(
      'href',
      url,
    );
  });

  it('searches records and continues the selected conversation', async () => {
    const bridge = createBridge();
    render(<HistoryLibrary bridge={bridge} />);
    const search = await screen.findByRole('searchbox', {
      name: '搜索学习记录',
    });

    await userEvent.type(search, 'checkpoint');
    await waitFor(() =>
      expect(bridge.list).toHaveBeenLastCalledWith('checkpoint'),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: '继续提问' }),
    );

    expect(bridge.continue).toHaveBeenCalledWith(url);
  });

  it('requires confirmation before deleting a saved conversation', async () => {
    const bridge = createBridge();
    render(<HistoryLibrary bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '删除当前学习记录' }),
    );
    expect(
      screen.getByRole('heading', { name: '删除这条学习记录？' }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: '确认删除' }),
    );

    expect(bridge.delete).toHaveBeenCalledWith(url);
  });

  it('shows empty and storage warning states', async () => {
    const bridge = createBridge({
      list: vi.fn().mockResolvedValue([]),
      usage: vi.fn().mockResolvedValue({
        bytesInUse: 9 * 1024 * 1024,
        quotaBytes: 10 * 1024 * 1024,
      }),
    });
    render(<HistoryLibrary bridge={bridge} />);

    expect(await screen.findByText('还没有学习记录')).toBeVisible();
    expect(
      screen.getByText('本地存储空间即将用满，请删除不再需要的记录。'),
    ).toBeVisible();
  });

  it('resizes and collapses the URL index', async () => {
    const { container } = render(<HistoryLibrary bridge={createBridge()} />);
    const divider = await screen.findByRole('separator', {
      name: '调整网址列表宽度',
    });
    const index = screen.getByRole('complementary', {
      name: '学习记录列表',
    });
    const header = container.querySelector('.library-header');

    divider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(divider).toHaveAttribute('aria-valuenow', '364');
    expect(
      within(index).getByRole('button', { name: '隐藏网址列表' }),
    ).toBeVisible();
    expect(
      within(header as HTMLElement).queryByRole('button', {
        name: '隐藏网址列表',
      }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: '隐藏网址列表' }),
    );
    expect(
      screen.queryByRole('complementary', { name: '学习记录列表' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '展开网址列表' }),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: '展开网址列表' }),
    );
    expect(
      screen.getByRole('complementary', { name: '学习记录列表' }),
    ).toBeVisible();
  });
});

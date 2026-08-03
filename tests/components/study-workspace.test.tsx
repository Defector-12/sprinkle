import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  StudyWorkspace,
  type StudyWorkspaceBridgeContract,
} from '../../src/components/StudyWorkspace.tsx';
import type { PageContext } from '../../src/core/types.ts';

const readyContext: PageContext = {
  key: '7:https://example.com/paper',
  tabId: 7,
  url: 'https://example.com/paper',
  normalizedUrl: 'https://example.com/paper',
  title: 'Memory Systems for Autonomous Agents',
  status: 'ready',
  article: {
    title: 'Memory Systems for Autonomous Agents',
    url: 'https://example.com/paper',
    blocks: [
      {
        id: 'heading',
        type: 'heading',
        text: 'Architecture',
        section: 'Architecture',
        order: 0,
      },
      {
        id: 'paragraph',
        type: 'paragraph',
        text: 'Working memory carries the current reasoning state.',
        section: 'Architecture',
        order: 1,
      },
      {
        id: 'code',
        type: 'code',
        text: 'memory.update(observation)',
        section: 'Architecture',
        order: 2,
      },
    ],
    images: [
      {
        id: 'diagram',
        src: 'https://example.com/diagram.png',
        alt: 'Agent memory architecture',
        caption: 'Figure 1',
        section: 'Architecture',
        surroundingText: 'Working memory flow',
      },
    ],
    isPartial: false,
  },
  focus: null,
  messages: [
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'The architecture separates working and durable memory.',
      createdAt: 1,
      answeredBy: 'deepseek',
    },
  ],
  warning: null,
  updatedAt: 1,
};

function createBridge(
  overrides: Partial<StudyWorkspaceBridgeContract> = {},
): StudyWorkspaceBridgeContract {
  return {
    initialize: vi.fn().mockResolvedValue(readyContext),
    ask: vi.fn().mockResolvedValue(readyContext),
    setTextFocus: vi.fn().mockResolvedValue(readyContext),
    setImageFocus: vi.fn().mockResolvedValue(readyContext),
    setRegionFocus: vi.fn().mockResolvedValue(readyContext),
    captureRegion: vi
      .fn()
      .mockResolvedValue('data:image/jpeg;base64,selected-region'),
    clearFocus: vi.fn().mockResolvedValue(readyContext),
    openSource: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

describe('StudyWorkspace', () => {
  it('renders a scrollable article beside the existing model conversation', async () => {
    render(<StudyWorkspace bridge={createBridge()} />);

    expect(
      await screen.findByRole('heading', {
        name: 'Memory Systems for Autonomous Agents',
      }),
    ).toBeVisible();
    expect(screen.getByText('Working memory carries the current reasoning state.')).toBeVisible();
    expect(screen.getByText('memory.update(observation)')).toBeVisible();
    expect(
      screen.getByRole('img', { name: 'Agent memory architecture' }),
    ).toBeVisible();
    expect(screen.getByText('DeepSeek')).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: '向当前资料提问' }),
    ).toBeVisible();
  });

  it('resizes both panes with pointer drag and keyboard arrows', async () => {
    render(<StudyWorkspace bridge={createBridge()} />);
    await screen.findByRole('heading', {
      name: 'Memory Systems for Autonomous Agents',
    });
    const workspace = screen.getByTestId('study-workspace');
    const divider = screen.getByRole('separator', {
      name: '调整资料和对话区域宽度',
    });
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
      top: 0,
      right: 1000,
      bottom: 800,
      left: 0,
      toJSON: () => undefined,
    });

    fireEvent.pointerDown(divider, { pointerId: 1, clientX: 560 });
    fireEvent.pointerMove(divider, { pointerId: 1, clientX: 700 });
    fireEvent.pointerUp(divider, { pointerId: 1, clientX: 700 });
    expect(workspace).toHaveStyle({ '--reader-width': '70%' });

    divider.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(workspace).toHaveStyle({ '--reader-width': '68%' });
  });

  it('quotes selected text, clicked images, and a drawn region', async () => {
    const bridge = createBridge();
    render(<StudyWorkspace bridge={bridge} />);
    await screen.findByRole('heading', {
      name: 'Memory Systems for Autonomous Agents',
    });

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'Working memory carries the current reasoning state.',
      anchorNode: screen.getByText(
        'Working memory carries the current reasoning state.',
      ).firstChild,
    } as Selection);
    await userEvent.click(
      screen.getByRole('button', { name: '引用选中文字' }),
    );
    expect(bridge.setTextFocus).toHaveBeenCalledWith(
      'Working memory carries the current reasoning state.',
      'Architecture',
    );

    await userEvent.click(
      screen.getByRole('button', { name: '引用图片：Agent memory architecture' }),
    );
    expect(bridge.setImageFocus).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'https://example.com/diagram.png',
      }),
    );

    await userEvent.click(
      screen.getByRole('button', { name: '框选资料区域' }),
    );
    expect(
      screen.getByRole('dialog', { name: '框选资料区域' }),
    ).toBeVisible();
    const regionPicker = screen.getByTestId('study-region-picker');
    fireEvent.pointerDown(regionPicker, {
      pointerId: 2,
      clientX: 20,
      clientY: 30,
    });
    fireEvent.pointerMove(regionPicker, {
      pointerId: 2,
      clientX: 220,
      clientY: 180,
    });
    fireEvent.pointerUp(regionPicker, {
      pointerId: 2,
      clientX: 220,
      clientY: 180,
    });

    await waitFor(() =>
      expect(bridge.setRegionFocus).toHaveBeenCalledWith(
        expect.objectContaining({
          imageUrl: 'data:image/jpeg;base64,selected-region',
          source: 'screenshot',
        }),
      ),
    );
  });

  it('continues asking against the same page context', async () => {
    const bridge = createBridge();
    render(<StudyWorkspace bridge={bridge} />);
    const input = await screen.findByRole('textbox', {
      name: '向当前资料提问',
    });

    await userEvent.type(input, '这个架构的主要取舍是什么？');
    await userEvent.click(screen.getByRole('button', { name: '发送问题' }));

    await waitFor(() =>
      expect(bridge.ask).toHaveBeenCalledWith(
        '这个架构的主要取舍是什么？',
      ),
    );
  });
});

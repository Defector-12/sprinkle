import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const unactivatedContext: PageContext = {
  ...readyContext,
  status: 'unactivated',
  article: null,
};

const partialContext: PageContext = {
  ...readyContext,
  status: 'partial',
  warning: '当前页面只读取到部分内容',
  article: {
    ...readyContext.article!,
    blocks: [
      {
        id: 'block-1',
        type: 'paragraph',
        text: 'Short note.',
        section: 'Short note',
        order: 0,
      },
    ],
    isPartial: true,
    diagnostics: {
      rootKind: 'body',
      readableLength: 11,
      minimumReadableLength: 80,
      rootTextLength: 420,
      candidateBlockCount: 3,
      acceptedBlockCount: 1,
      excludedBlockCount: 1,
      emptyBlockCount: 1,
      articleCandidateCount: 0,
      mainCandidateCount: 0,
      roleMainCandidateCount: 0,
      iframeCount: 1,
      canvasCount: 0,
      tableCount: 1,
      shadowRootCount: 0,
      loadingIndicatorCount: 1,
      fallbackUsed: false,
      fallbackBlockCount: 0,
    },
  },
};

type VisionAssistantBridge = FloatingAssistantBridge & {
  hasVisionApiKey(): Promise<boolean>;
  startImagePicker(): Promise<void>;
  startRegionPicker(): Promise<void>;
  clearFocus(): Promise<PageContext>;
};

function createBridge(
  context: PageContext = readyContext,
  overrides: Partial<VisionAssistantBridge> = {},
): VisionAssistantBridge {
  return {
    initialize: vi.fn().mockResolvedValue(context),
    activate: vi.fn().mockResolvedValue(readyContext),
    deactivate: vi.fn().mockResolvedValue(unactivatedContext),
    hasApiKey: vi.fn().mockResolvedValue(true),
    hasVisionApiKey: vi.fn().mockResolvedValue(true),
    ask: vi.fn().mockResolvedValue(context),
    startImagePicker: vi.fn().mockResolvedValue(undefined),
    startRegionPicker: vi.fn().mockResolvedValue(undefined),
    clearFocus: vi.fn().mockResolvedValue({ ...context, focus: null }),
    openSettings: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

describe('FloatingAssistant', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a new page dormant until the toolbar explicitly activates it', async () => {
    const bridge = createBridge(unactivatedContext);
    render(<FloatingAssistant bridge={bridge} />);

    await waitFor(() => expect(bridge.initialize).toHaveBeenCalledOnce());
    expect(bridge.activate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: '打开 Context Reader' }),
    ).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent('context-reader:open'));
    });

    expect(bridge.activate).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole('dialog', { name: 'Context Reader 对话' }),
    ).toBeVisible();
  });

  it('opens a compact dialog from the floating button and closes with Escape', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
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
      window.dispatchEvent(
        new CustomEvent('context-reader:open', {
          detail: { activate: false },
        }),
      );
    });

    expect(
      await screen.findByRole('dialog', { name: 'Context Reader 对话' }),
    ).toBeVisible();
    expect(screen.getByText('Mixture of Experts')).toBeVisible();
  });

  it('offers accessible image and region tools from the floating conversation', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: '点选页面图片' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: '框选页面区域' }),
    );

    expect(bridge.startImagePicker).toHaveBeenCalledOnce();
    expect(bridge.startRegionPicker).toHaveBeenCalledOnce();
  });

  it('previews an image reference, explains Doubao routing, and can remove it', async () => {
    const imageContext: PageContext = {
      ...readyContext,
      focus: {
        type: 'image',
        imageUrl: 'data:image/png;base64,c2NyZWVuc2hvdA==',
        alt: 'Agent memory architecture',
        text: 'Agent memory architecture',
        section: 'Architecture',
        source: 'screenshot',
      },
    };
    const bridge = createBridge(imageContext);
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );

    expect(
      screen.getByRole('img', { name: '已引用图片预览' }),
    ).toHaveAttribute('src', imageContext.focus?.type === 'image'
      ? imageContext.focus.imageUrl
      : '');
    expect(screen.getByText('含图片，发送时使用 Doubao')).toBeVisible();

    await userEvent.click(
      screen.getByRole('button', { name: '移除图片引用' }),
    );
    expect(bridge.clearFocus).toHaveBeenCalledOnce();
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
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    const input = screen.getByRole('textbox', { name: '向当前文章提问' });
    await userEvent.type(input, '这里的 MoE 是什么意思？');
    await userEvent.keyboard('{Enter}');

    expect(bridge.ask).toHaveBeenCalledWith('这里的 MoE 是什么意思？');
    expect(
      await screen.findByText('这里指模型按输入选择部分专家网络参与计算。'),
    ).toBeVisible();
  });

  it('shows an explicit understanding state while the page is being parsed', async () => {
    const bridge = createBridge(unactivatedContext, {
      activate: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    render(<FloatingAssistant bridge={bridge} />);
    await waitFor(() => expect(bridge.initialize).toHaveBeenCalledOnce());

    act(() => {
      window.dispatchEvent(new CustomEvent('context-reader:open'));
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      '正在理解页面内容',
    );
    expect(screen.getByText('正在提取标题、段落和代码块')).toBeVisible();
  });

  it('explains when the API key is missing and disables questions', async () => {
    const bridge = createBridge(readyContext, {
      hasApiKey: vi.fn().mockResolvedValue(false),
    });
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('尚未配置 API Key');
    expect(
      screen.getByRole('button', { name: '填写 API Key' }),
    ).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: '向当前文章提问' }),
    ).toBeDisabled();
  });

  it('shows readiness details and can explicitly stop understanding the page', async () => {
    const context = {
      ...readyContext,
      article: {
        ...readyContext.article!,
        blocks: [
          {
            id: 'block-1',
            type: 'paragraph' as const,
            text: 'Agent memory stores durable context.',
            section: 'Memory',
            order: 0,
          },
        ],
      },
    };
    const bridge = createBridge(context);
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('页面内容已理解');
    expect(screen.getByRole('status')).toHaveTextContent('已读取 1 个内容块');

    await userEvent.click(
      screen.getByRole('button', { name: '停止理解当前页面' }),
    );

    expect(bridge.deactivate).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: '打开 Context Reader' }),
      ).not.toBeInTheDocument(),
    );
  });

  it('opens partial-reading diagnostics without disrupting the chat view', async () => {
    const bridge = createBridge(partialContext);
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    expect(
      screen.getByRole('textbox', { name: '向当前文章提问' }),
    ).toBeVisible();

    await userEvent.click(
      screen.getByRole('button', { name: '查看读取诊断' }),
    );

    expect(
      screen.getByRole('heading', { name: '读取诊断' }),
    ).toBeVisible();
    expect(screen.getByText('11 字 / 80 字')).toBeVisible();
    expect(
      screen.queryByRole('textbox', { name: '向当前文章提问' }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: /可读文字不足/ }),
    );

    expect(
      screen.getByRole('heading', { name: '可读文字不足' }),
    ).toBeVisible();
    expect(screen.getByText(/当前只提取到 11 个字符/)).toBeVisible();

    await userEvent.click(
      screen.getByRole('button', { name: '返回诊断概览' }),
    );
    await userEvent.click(screen.getByRole('button', { name: '返回对话' }));

    expect(
      screen.getByRole('textbox', { name: '向当前文章提问' }),
    ).toBeVisible();
  });

  it('drags the floating button without triggering a click-open', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);
    await waitFor(() => expect(bridge.initialize).toHaveBeenCalledOnce());

    const orb = screen.getByRole('button', { name: '打开 Context Reader' });
    const pointer = (type: string, clientX: number, clientY: number) =>
      act(() => {
        orb.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
          }),
        );
      });

    pointer('pointerdown', 380, 760);
    pointer('pointermove', 120, 300);
    pointer('pointerup', 120, 300);
    fireEvent.click(orb);

    expect(
      screen.queryByRole('dialog', { name: 'Context Reader 对话' }),
    ).not.toBeInTheDocument();
    const movedOrb = screen.getByRole('button', {
      name: '打开 Context Reader',
    });
    expect(movedOrb).toBeVisible();
    expect(movedOrb.className).toContain('cr-orb');
    // dragged to the left half → snaps to the left edge, not the default right edge
    expect(movedOrb.style.left).toBe('18px');
  });

  it('caps the dialog height so a long answer stays scrollable when opened mid-screen', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);
    await waitFor(() => expect(bridge.initialize).toHaveBeenCalledOnce());

    const orb = screen.getByRole('button', { name: '打开 Context Reader' });
    const pointer = (type: string, clientX: number, clientY: number) =>
      act(() => {
        orb.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
          }),
        );
      });

    // Drag the orb to the vertical middle of the viewport.
    const midY = Math.round(window.innerHeight / 2);
    pointer('pointerdown', 380, 760);
    pointer('pointermove', 200, midY);
    pointer('pointerup', 200, midY);

    act(() => {
      window.dispatchEvent(new CustomEvent('context-reader:open'));
    });

    const dialog = await screen.findByRole('dialog', {
      name: 'Context Reader 对话',
    });
    const maxHeight = Number.parseFloat(dialog.style.maxHeight);
    expect(maxHeight).toBeGreaterThan(0);
    // The card must fit within the viewport, never spilling off-screen.
    expect(maxHeight).toBeLessThanOrEqual(window.innerHeight);
  });

  it('resizes the conversation window from its visible corner handle', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Context Reader 对话',
    });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      x: 612,
      y: 180,
      width: 400,
      height: 400,
      top: 180,
      right: 1012,
      bottom: 580,
      left: 612,
      toJSON: () => undefined,
    });
    const handle = screen.getByRole('separator', {
      name: '调整对话框大小',
    });
    expect(handle).toHaveClass('cr-resize-handle--bottom-left');
    expect(handle).toHaveAttribute('title', '拖动调整整个对话框大小');
    const pointer = (type: string, clientX: number, clientY: number) =>
      act(() => {
        handle.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
          }),
        );
      });

    pointer('pointerdown', 612, 580);
    pointer('pointermove', 512, 680);
    pointer('pointerup', 512, 680);

    expect(dialog.style.width).toBe('500px');
    expect(dialog.style.height).toBe('500px');
  });

  it('moves the expanded dialog independently by dragging its title area', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    const dialog = screen.getByRole('dialog', {
      name: 'Context Reader 对话',
    });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      x: 612,
      y: 180,
      width: 400,
      height: 400,
      top: 180,
      right: 1012,
      bottom: 580,
      left: 612,
      toJSON: () => undefined,
    });
    const dragArea = screen.getByRole('button', {
      name: '移动对话框',
    });
    const pointer = (type: string, clientX: number, clientY: number) =>
      act(() => {
        dragArea.dispatchEvent(
          new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX,
            clientY,
          }),
        );
      });

    pointer('pointerdown', 700, 200);
    pointer('pointermove', 500, 300);
    pointer('pointerup', 500, 300);

    expect(dialog.style.left).toBe('412px');
    expect(dialog.style.top).toBe('280px');
    expect(dialog.style.right).toBe('');
    expect(dialog.style.bottom).toBe('');
  });

  it('keeps the orb inside the visual viewport after browser zoom changes', async () => {
    const visualViewport = new EventTarget() as VisualViewport;
    Object.assign(visualViewport, {
      width: 320,
      height: 480,
      offsetLeft: 40,
      offsetTop: 20,
      pageLeft: 40,
      pageTop: 20,
      scale: 2,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    });

    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);

    const orb = await screen.findByRole('button', {
      name: '打开 Context Reader',
    });
    expect(orb.style.left).toBe('294px');
    expect(orb.style.top).toBe('434px');

    Object.assign(visualViewport, { width: 240, height: 360 });
    act(() => visualViewport.dispatchEvent(new Event('resize')));

    await waitFor(() => expect(orb.style.left).toBe('214px'));
    expect(orb.style.top).toBe('314px');

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: null,
    });
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FloatingAssistant,
} from '../../src/components/FloatingAssistant.tsx';
import type { FloatingAssistantBridge } from '../../src/application/ports.ts';
import type { ImageFocus, PageContext } from '../../src/core/types.ts';
import { publishAssistantOpen } from '../../src/runtime/assistant-events.ts';

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

function createBridge(
  context: PageContext = readyContext,
  overrides: Partial<FloatingAssistantBridge> = {},
): FloatingAssistantBridge {
  return {
    initialize: vi.fn().mockResolvedValue(context),
    activate: vi.fn().mockResolvedValue(readyContext),
    deactivate: vi.fn().mockResolvedValue(unactivatedContext),
    hasApiKey: vi.fn().mockResolvedValue(true),
    ask: vi.fn().mockResolvedValue(context),
    startImagePicker: vi.fn().mockResolvedValue(undefined),
    startRegionPicker: vi.fn().mockResolvedValue(undefined),
    setImageFocus: vi
      .fn()
      .mockImplementation(async (focus: ImageFocus) => ({
        ...context,
        focus,
      })),
    clearFocus: vi.fn().mockResolvedValue({ ...context, focus: null }),
    openStudy: vi.fn().mockResolvedValue(undefined),
    openHistory: vi.fn().mockResolvedValue(undefined),
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
    expect(bridge.activate).not.toHaveBeenCalled();

    act(() => {
      publishAssistantOpen();
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

  it('shows restored answers immediately without replaying the typewriter', async () => {
    const historicalAnswer =
      'This answer was completed before the current view was mounted. '
        .repeat(8)
        .trim();
    const bridge = createBridge({
      ...readyContext,
      messages: [
        {
          id: 'historical-answer',
          role: 'assistant',
          content: historicalAnswer,
          createdAt: 1,
          answeredBy: 'deepseek',
        },
      ],
    });
    render(<FloatingAssistant bridge={bridge} />);

    fireEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );

    expect(screen.getByText(historicalAnswer)).toBeVisible();
  });

  it('shows answers created in another view without replaying them', async () => {
    let publishContext: ((context: PageContext) => void) | undefined;
    const bridge = createBridge(readyContext, {
      subscribe: vi.fn((listener: (context: PageContext) => void) => {
        publishContext = listener;
        return () => undefined;
      }),
    });
    render(<FloatingAssistant bridge={bridge} />);
    fireEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    const externalAnswer =
      'This answer was completed in the study workspace. '.repeat(8).trim();

    await act(async () => {
      publishContext?.({
        ...readyContext,
        messages: [
          {
            id: 'study-answer',
            role: 'assistant',
            content: externalAnswer,
            createdAt: 2,
            answeredBy: 'deepseek',
          },
        ],
      });
      await Promise.resolve();
    });

    expect(screen.getByText(externalAnswer)).toBeVisible();
  });

  it('opens the full-page study workspace from the conversation header', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: '打开学习工作台' }),
    );

    expect(bridge.openStudy).toHaveBeenCalledOnce();

    await userEvent.click(
      screen.getByRole('button', { name: '打开学习记录' }),
    );
    expect(bridge.openHistory).toHaveBeenCalledOnce();
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
      publishAssistantOpen({ activate: false });
    });

    expect(
      await screen.findByRole('dialog', { name: 'Context Reader 对话' }),
    ).toBeVisible();
    expect(screen.getByText('Mixture of Experts')).toBeVisible();

    await userEvent.click(
      screen.getByRole('button', { name: '取消引用' }),
    );
    expect(bridge.clearFocus).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByText('Mixture of Experts')).not.toBeInTheDocument(),
    );
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
      screen.getByRole('button', { name: '打开 Context Reader' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: '框选页面区域' }),
    );

    expect(bridge.startImagePicker).toHaveBeenCalledOnce();
    expect(bridge.startRegionPicker).toHaveBeenCalledOnce();
  });

  it('uploads a local image into the current reference', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    const picker = screen.getByLabelText(
      '选择本地图片文件',
    ) as HTMLInputElement;
    const openPicker = vi.spyOn(picker, 'click');

    await userEvent.click(
      screen.getByRole('button', { name: '上传本地图片' }),
    );
    expect(openPicker).toHaveBeenCalledOnce();

    fireEvent.change(picker, {
      target: {
        files: [
          new File(['pixels'], 'architecture.png', {
            type: 'image/png',
          }),
        ],
      },
    });

    await waitFor(() =>
      expect(bridge.setImageFocus).toHaveBeenCalledWith({
        type: 'image',
        imageUrl: 'data:image/png;base64,cGl4ZWxz',
        alt: 'architecture.png',
        text: 'architecture.png',
        section: '本地上传',
        source: 'upload',
      }),
    );
    expect(
      await screen.findByRole('img', { name: '已引用图片预览' }),
    ).toHaveAttribute('src', 'data:image/png;base64,cGl4ZWxz');
  });

  it('uses a pasted clipboard image as the current reference', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    const textarea = screen.getByRole('textbox', {
      name: '向当前文章提问',
    });

    fireEvent.paste(textarea, {
      clipboardData: {
        files: [
          new File(['clipboard'], 'pasted-image.png', {
            type: 'image/png',
          }),
        ],
        items: [],
      },
    });

    await waitFor(() =>
      expect(bridge.setImageFocus).toHaveBeenCalledWith(
        expect.objectContaining({
          imageUrl: 'data:image/png;base64,Y2xpcGJvYXJk',
          alt: 'pasted-image.png',
          source: 'upload',
        }),
      ),
    );

    fireEvent.paste(textarea, {
      clipboardData: { files: [], items: [] },
    });
    expect(bridge.setImageFocus).toHaveBeenCalledOnce();
  });

  it('previews an image reference without a model hint and can remove it', async () => {
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
    expect(
      screen.queryByText('含图片，将使用 DeepSeek 视觉模型'),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: '取消引用' }),
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
          answeredBy: 'deepseek',
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
    await waitFor(
      () => {
        expect(
          screen.getByText('这里指模型按输入选择部分专家网络参与计算。'),
        ).toBeVisible();
      },
      { timeout: 2_000 },
    );
    expect(screen.getByText('DeepSeek')).toBeVisible();
  });

  it('clears and collapses the composer as soon as a question is sent', async () => {
    let resolveAsk: (context: PageContext) => void = () => undefined;
    const bridge = createBridge(readyContext, {
      ask: vi.fn(
        () =>
          new Promise<PageContext>((resolve) => {
            resolveAsk = resolve;
          }),
      ),
    });
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    const input = screen.getByRole('textbox', {
      name: '向当前文章提问',
    }) as HTMLTextAreaElement;
    Object.defineProperty(input, 'scrollHeight', {
      configurable: true,
      get: () => (input.value ? 180 : 64),
    });

    await userEvent.type(input, '发送后立即清空这段内容');
    await userEvent.click(screen.getByRole('button', { name: '发送问题' }));

    expect(bridge.ask).toHaveBeenCalledWith('发送后立即清空这段内容');
    expect(input).toHaveValue('');
    expect(input).toHaveStyle({ height: '64px' });

    await act(async () => {
      resolveAsk(readyContext);
      await Promise.resolve();
    });
  });

  it('scrolls to the newest conversation content after sending', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const answeredContext: PageContext = {
      ...readyContext,
      messages: [
        {
          id: 'user-latest',
          role: 'user',
          content: '最新问题',
          createdAt: 1,
        },
        {
          id: 'assistant-latest',
          role: 'assistant',
          content: '最新回答',
          createdAt: 2,
          answeredBy: 'deepseek',
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
    scrollIntoView.mockClear();

    const input = screen.getByRole('textbox', { name: '向当前文章提问' });
    await userEvent.type(input, '最新问题');
    await userEvent.keyboard('{Enter}');

    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'end',
      }),
    );
  });

  it('auto-grows and maximizes the composer while Enter inserts a newline', async () => {
    const bridge = createBridge();
    render(<FloatingAssistant bridge={bridge} />);
    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    const input = screen.getByRole('textbox', { name: '向当前文章提问' });
    Object.defineProperty(input, 'scrollHeight', {
      configurable: true,
      value: 180,
    });

    await userEvent.type(input, '第一行很长的输入内容');
    expect(input).toHaveStyle({ height: '180px' });

    await userEvent.click(
      screen.getByRole('button', { name: '最大化输入框' }),
    );
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('button', { name: '恢复输入框' }),
    ).toBeVisible();

    await userEvent.type(input, '{Enter}第二行');
    expect(input).toHaveValue('第一行很长的输入内容\n第二行');
    expect(bridge.ask).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: '恢复输入框' }),
    );
    await userEvent.type(input, '{Enter}');
    expect(bridge.ask).toHaveBeenCalledWith('第一行很长的输入内容\n第二行');
  });

  it('labels each answer with its actual model and keeps a fallback for old messages', async () => {
    const bridge = createBridge({
      ...readyContext,
      messages: [
        {
          id: 'assistant-doubao',
          role: 'assistant',
          content: '这是图片回答。',
          createdAt: 1,
          answeredBy: 'doubao',
        },
        {
          id: 'assistant-deepseek',
          role: 'assistant',
          content: '这是文本追问回答。',
          createdAt: 2,
          answeredBy: 'deepseek',
        },
        {
          id: 'assistant-legacy',
          role: 'assistant',
          content: '这是升级前的历史回答。',
          createdAt: 3,
        },
      ],
    });
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );

    expect(screen.getByText('Doubao')).toBeVisible();
    expect(screen.getByText('DeepSeek')).toBeVisible();
    expect(screen.getByText('助手')).toBeVisible();
  });

  it('renders assistant Markdown and shows the reference used by the user', async () => {
    const bridge = createBridge({
      ...readyContext,
      messages: [
        {
          id: 'user-referenced',
          role: 'user',
          content: '这里的工作记忆有什么作用？',
          createdAt: 1,
          reference: {
            type: 'text',
            text: 'Working memory carries the current reasoning state.',
            section: 'Architecture',
          },
        },
        {
          id: 'assistant-markdown',
          role: 'assistant',
          content: [
            '## 核心作用',
            '',
            '**工作记忆**主要负责：',
            '',
            '- 保存当前状态',
            '- 支持下一步推理',
            '',
            '`memory.update()` 会更新状态。',
            '',
            '[查看资料](https://example.com/docs)',
            '',
            '<script>window.__unsafe = true</script>',
          ].join('\n'),
          createdAt: 2,
          answeredBy: 'deepseek',
        },
      ],
    });
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );

    expect(
      await screen.findByRole(
        'heading',
        { name: '核心作用', level: 2 },
        { timeout: 3_000 },
      ),
    ).toBeVisible();
    expect(
      await screen.findByText(
        '工作记忆',
        { selector: 'strong' },
        { timeout: 3_000 },
      ),
    ).toBeVisible();
    expect(
      await screen.findByText(
        '保存当前状态',
        undefined,
        { timeout: 3_000 },
      ),
    ).toBeVisible();
    expect(
      await screen.findByText(
        'memory.update()',
        { selector: 'code' },
        { timeout: 3_000 },
      ),
    ).toBeVisible();
    expect(
      await screen.findByRole(
        'link',
        { name: '查看资料' },
        { timeout: 3_000 },
      ),
    ).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('note', { name: '提问引用' })).toHaveTextContent(
      'Working memory carries the current reasoning state.',
    );
    expect(
      screen
        .getByRole('dialog', { name: 'Context Reader 对话' })
        .querySelector('script'),
    ).toBeNull();
    expect(screen.queryByText('window.__unsafe = true')).not.toBeInTheDocument();
  });

  it('shows an explicit understanding state while the page is being parsed', async () => {
    const bridge = createBridge(unactivatedContext, {
      activate: vi.fn().mockReturnValue(new Promise(() => undefined)),
    });
    render(<FloatingAssistant bridge={bridge} />);
    await waitFor(() => expect(bridge.initialize).toHaveBeenCalledOnce());

    act(() => {
      publishAssistantOpen();
    });

    expect(await screen.findByRole('status')).toHaveTextContent(
      '正在理解页面内容',
    );
    expect(screen.getByText('正在提取标题、段落和代码块')).toBeVisible();
  });

  it('ignores an older activation failure after a newer activation succeeds', async () => {
    let rejectFirst: ((cause: Error) => void) | undefined;
    let resolveSecond: ((context: PageContext) => void) | undefined;
    const bridge = createBridge(unactivatedContext, {
      activate: vi
        .fn()
        .mockReturnValueOnce(
          new Promise<PageContext>((_resolve, reject) => {
            rejectFirst = reject;
          }),
        )
        .mockReturnValueOnce(
          new Promise<PageContext>((resolve) => {
            resolveSecond = resolve;
          }),
        ),
    });
    render(<FloatingAssistant bridge={bridge} />);
    await waitFor(() => expect(bridge.initialize).toHaveBeenCalledOnce());

    act(() => publishAssistantOpen());
    act(() => publishAssistantOpen());
    await waitFor(() => expect(bridge.activate).toHaveBeenCalledTimes(2));

    resolveSecond?.(readyContext);
    expect(await screen.findByRole('status')).toHaveTextContent(
      '页面内容已理解',
    );
    rejectFirst?.(new Error('旧请求已失效'));

    await waitFor(() =>
      expect(screen.queryByText('旧请求已失效')).not.toBeInTheDocument(),
    );
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
      screen.getByRole('button', { name: /已读取内容范围/ }),
    );
    expect(
      screen.getByRole('heading', { name: '已读取内容范围' }),
    ).toBeVisible();
    expect(screen.getByText('Short note（1 个内容块）')).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: '返回诊断概览' }),
    );

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

  it('opens runtime error details from a visible error prompt', async () => {
    const bridge = createBridge(readyContext, {
      ask: vi
        .fn()
        .mockRejectedValue(
          new Error('模型服务响应超时，请稍后重试。'),
        ),
    });
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: '向当前文章提问' }),
      '总结当前页面',
    );
    await userEvent.keyboard('{Enter}');

    const prompt = await screen.findByRole('button', {
      name: '查看问题详情：模型服务响应超时，请稍后重试。',
    });
    expect(prompt).toBeVisible();
    await userEvent.click(prompt);

    expect(
      screen.getByRole('heading', { name: '问题发送失败' }),
    ).toBeVisible();
    expect(screen.getByText('生成页面回答')).toBeVisible();
    expect(screen.getAllByText('模型服务响应超时，请稍后重试。')).toHaveLength(
      2,
    );
    expect(
      screen.queryByRole('textbox', { name: '向当前文章提问' }),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: '返回对话' }),
    );
    expect(
      screen.getByRole('textbox', { name: '向当前文章提问' }),
    ).toBeVisible();
  });

  it('shows details when a header action fails instead of hiding the error', async () => {
    const bridge = createBridge(readyContext, {
      openStudy: vi.fn().mockRejectedValue(new Error('无法创建新标签页')),
    });
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: '打开学习工作台' }),
    );

    const prompt = await screen.findByRole('button', {
      name: '查看问题详情：无法创建新标签页',
    });
    await userEvent.click(prompt);

    expect(
      screen.getByRole('heading', { name: '学习工作台打开失败' }),
    ).toBeVisible();
    expect(screen.getByText('打开学习工作台')).toBeVisible();
  });

  it('keeps the original warning detail available for self-diagnosis', async () => {
    const bridge = createBridge({
      ...readyContext,
      warning: '回答已生成，但本地对话归档失败。',
      warningDetail: 'QUOTA_BYTES quota exceeded',
    });
    render(<FloatingAssistant bridge={bridge} />);

    await userEvent.click(
      await screen.findByRole('button', { name: '打开 Context Reader' }),
    );
    await userEvent.click(
      screen.getByRole('button', {
        name: '查看问题详情：回答已生成，但本地对话归档失败。',
      }),
    );

    expect(
      screen.getByRole('heading', { name: '本地对话归档失败' }),
    ).toBeVisible();
    expect(screen.getByText('QUOTA_BYTES quota exceeded')).toBeVisible();
    expect(screen.getByText('保存本地对话')).toBeVisible();
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
      publishAssistantOpen();
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

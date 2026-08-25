import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StudyWorkspace,
  type StudyWorkspaceBridgeContract,
} from '../../src/components/StudyWorkspace.tsx';
import type { ImageFocus, PageContext } from '../../src/core/types.ts';

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
        level: 2,
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
      {
        id: 'heading-details',
        type: 'heading',
        text: 'Memory Update',
        section: 'Memory Update',
        order: 3,
        level: 3,
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
        order: 2,
      },
    ],
    tables: [
      {
        id: 'table-1',
        caption: 'Memory comparison',
        section: 'Architecture',
        order: 2,
        rows: [
          {
            cells: [
              {
                text: 'Metric',
                header: true,
                colSpan: 1,
                rowSpan: 1,
              },
              {
                text: 'Value',
                header: true,
                colSpan: 1,
                rowSpan: 1,
              },
            ],
          },
          {
            cells: [
              {
                text: 'Context window',
                header: true,
                colSpan: 1,
                rowSpan: 1,
              },
              {
                text: '1M tokens',
                header: false,
                colSpan: 1,
                rowSpan: 1,
              },
            ],
          },
        ],
      },
    ],
    formulas: [
      {
        id: 'formula-1',
        tex: 'I - \\beta_t',
        mathml:
          '<math display="block"><mrow><mi>I</mi><mo>−</mo><msub><mi>β</mi><mi>t</mi></msub></mrow></math>',
        section: 'Memory Update',
        order: 4,
        display: 'block',
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
    setImageFocus: vi
      .fn()
      .mockImplementation(async (focus: ImageFocus) => ({
        ...readyContext,
        focus,
      })),
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
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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
      screen.getByRole('navigation', { name: '资料目录' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Architecture' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Memory Update' }),
    ).toHaveAttribute('data-level', '3');
    expect(
      screen.getByRole('table', { name: 'Memory comparison' }),
    ).toBeVisible();
    expect(screen.getByText('1M tokens')).toBeVisible();
    expect(
      screen.getByTestId('study-formula-formula-1').innerHTML,
    ).toContain('<math');
    expect(
      screen.getByRole('img', { name: 'Agent memory architecture' }),
    ).toBeVisible();
    const diagram = screen.getByRole('img', {
      name: 'Agent memory architecture',
    });
    const code = screen.getByText('memory.update(observation)');
    expect(
      diagram.compareDocumentPosition(code) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText('DeepSeek')).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: '向当前资料提问' }),
    ).toBeVisible();
  });

  it('labels an image reference without exposing model routing', async () => {
    const focusedContext: PageContext = {
      ...readyContext,
      focus: {
        type: 'image',
        imageUrl: 'data:image/png;base64,c2NyZWVuc2hvdA==',
        alt: 'Agent memory architecture',
        text: 'Working memory flow',
        section: 'Architecture',
        source: 'screenshot',
      },
    };
    render(
      <StudyWorkspace
        bridge={createBridge({
          initialize: vi.fn().mockResolvedValue(focusedContext),
        })}
      />,
    );

    expect(await screen.findByText('图片引用')).toBeVisible();
    expect(screen.queryByText('图片引用 · DeepSeek')).not.toBeInTheDocument();
  });

  it('renders GFM answers and keeps the image reference attached to its question', async () => {
    const context: PageContext = {
      ...readyContext,
      messages: [
        {
          id: 'user-image-reference',
          role: 'user',
          content: '比较图中的两个指标。',
          createdAt: 1,
          reference: {
            type: 'image',
            imageUrl: 'data:image/png;base64,chart',
            alt: '模型指标对比图',
            text: 'Figure 2',
            section: 'Benchmarks',
            source: 'screenshot',
          },
        },
        {
          id: 'assistant-gfm',
          role: 'assistant',
          content: [
            '### 指标对比',
            '',
            '| 指标 | 结果 |',
            '| --- | ---: |',
            '| Accuracy | **92%** |',
          ].join('\n'),
          createdAt: 2,
          answeredBy: 'deepseek',
        },
      ],
    };
    render(
      <StudyWorkspace
        bridge={createBridge({
          initialize: vi.fn().mockResolvedValue(context),
        })}
      />,
    );

    expect(
      await screen.findByRole('heading', { name: '指标对比', level: 3 }),
    ).toBeVisible();
    expect(screen.getByText('Accuracy').closest('table')).toHaveTextContent(
      'Accuracy92%',
    );
    const reference = screen.getByRole('note', { name: '提问引用' });
    expect(reference.querySelector('img')).toHaveAttribute(
      'src',
      'data:image/png;base64,chart',
    );
    expect(reference).toHaveTextContent('Benchmarks');
  });

  it('navigates from the generated table of contents to a document heading', async () => {
    render(<StudyWorkspace bridge={createBridge()} />);
    const target = await screen.findByRole('heading', {
      name: 'Memory Update',
    });
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    await userEvent.click(
      screen.getByRole('link', { name: 'Memory Update' }),
    );

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
  });

  it('reveals a new model answer with a typewriter effect', async () => {
    const streamingContext: PageContext = {
      ...readyContext,
      messages: [
        ...readyContext.messages,
        {
          id: 'assistant-streaming',
          role: 'assistant',
          content: 'This answer appears progressively.',
          createdAt: 2,
          answeredBy: 'deepseek',
        },
      ],
    };
    const bridge = createBridge({
      ask: vi.fn().mockResolvedValue(streamingContext),
    });
    render(<StudyWorkspace bridge={bridge} />);
    const input = await screen.findByRole('textbox', {
      name: '向当前资料提问',
    });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Explain the update.' } });
      fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
      await Promise.resolve();
    });
    expect(
      screen.queryByText('This answer appears progressively.'),
    ).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(
      screen.getByText('This answer appears progressively.'),
    ).toBeVisible();
  });

  it('finishes an in-progress answer when the workspace becomes hidden', async () => {
    const answer = 'This answer should be complete when the user returns.';
    const bridge = createBridge({
      ask: vi.fn().mockResolvedValue({
        ...readyContext,
        messages: [
          ...readyContext.messages,
          {
            id: 'assistant-before-switch',
            role: 'assistant',
            content: answer,
            createdAt: 2,
            answeredBy: 'deepseek',
          },
        ],
      }),
    });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    render(<StudyWorkspace bridge={bridge} />);
    const input = await screen.findByRole('textbox', {
      name: '向当前资料提问',
    });

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Explain the update.' } });
      fireEvent.click(screen.getByRole('button', { name: '发送问题' }));
      await Promise.resolve();
    });
    expect(screen.queryByText(answer)).not.toBeInTheDocument();

    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));

    expect(screen.getByText(answer)).toBeVisible();
  });

  it('offers a nearby ask action immediately after selecting text', async () => {
    const bridge = createBridge();
    render(<StudyWorkspace bridge={bridge} />);
    const paragraph = await screen.findByText(
      'Working memory carries the current reasoning state.',
    );
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'Working memory',
      anchorNode: paragraph.firstChild,
      rangeCount: 1,
      getRangeAt: () => ({
        getBoundingClientRect: () => ({
          left: 180,
          top: 220,
          right: 310,
          bottom: 244,
          width: 130,
          height: 24,
          x: 180,
          y: 220,
          toJSON: () => undefined,
        }),
      }),
    } as unknown as Selection);

    fireEvent.mouseUp(paragraph);
    await userEvent.click(
      await screen.findByRole('button', { name: '提问选中文字' }),
    );

    expect(bridge.setTextFocus).toHaveBeenCalledWith(
      'Working memory',
      'Architecture',
    );
  });

  it('provides an explicit point-image mode in the reader toolbar', async () => {
    const bridge = createBridge();
    render(<StudyWorkspace bridge={bridge} />);
    const picker = await screen.findByRole('button', {
      name: '点选资料图片',
    });

    await userEvent.click(picker);
    expect(picker).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(
      screen.getByRole('button', {
        name: '引用图片：Agent memory architecture',
      }),
    );

    expect(bridge.setImageFocus).toHaveBeenCalled();
    expect(picker).toHaveAttribute('aria-pressed', 'false');
  });

  it('uploads a local image from the reader toolbar', async () => {
    const bridge = createBridge();
    render(<StudyWorkspace bridge={bridge} />);
    await screen.findByRole('heading', {
      name: 'Memory Systems for Autonomous Agents',
    });
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
          new File(['pixels'], 'local-chart.webp', {
            type: 'image/webp',
          }),
        ],
      },
    });

    await waitFor(() =>
      expect(bridge.setImageFocus).toHaveBeenCalledWith({
        type: 'image',
        imageUrl: 'data:image/webp;base64,cGl4ZWxz',
        alt: 'local-chart.webp',
        text: 'local-chart.webp',
        section: '本地上传',
        source: 'upload',
      }),
    );
    expect(await screen.findByText('local-chart.webp')).toBeVisible();
  });

  it('uses a pasted clipboard image as the current reference', async () => {
    const bridge = createBridge();
    render(<StudyWorkspace bridge={bridge} />);
    const textarea = await screen.findByRole('textbox', {
      name: '向当前资料提问',
    });

    fireEvent.paste(textarea, {
      clipboardData: {
        files: [
          new File(['clipboard'], 'pasted-chart.png', {
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
          alt: 'pasted-chart.png',
          source: 'upload',
        }),
      ),
    );
    expect(await screen.findByText('pasted-chart.png')).toBeVisible();
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

    fireEvent(
      divider,
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 560,
      }),
    );
    fireEvent(
      divider,
      new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 700,
      }),
    );
    fireEvent(
      divider,
      new MouseEvent('pointerup', {
        bubbles: true,
        clientX: 700,
      }),
    );
    await waitFor(() =>
      expect(workspace).toHaveStyle({ '--reader-width': '62%' }),
    );

    divider.focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(workspace).toHaveStyle({ '--reader-width': '60%' });
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
        imageUrl: 'data:image/jpeg;base64,selected-region',
        source: 'screenshot',
      }),
    );

    await userEvent.click(
      screen.getByRole('button', { name: '框选资料区域' }),
    );
    expect(
      screen.getByRole('dialog', { name: '框选资料区域' }),
    ).toBeVisible();
    const regionPicker = screen.getByTestId('study-region-picker');
    fireEvent(
      regionPicker,
      new MouseEvent('pointerdown', {
        bubbles: true,
        clientX: 20,
        clientY: 30,
      }),
    );
    fireEvent(
      regionPicker,
      new MouseEvent('pointermove', {
        bubbles: true,
        clientX: 220,
        clientY: 180,
      }),
    );
    fireEvent(
      regionPicker,
      new MouseEvent('pointerup', {
        bubbles: true,
        clientX: 220,
        clientY: 180,
      }),
    );

    await waitFor(() =>
      expect(bridge.setRegionFocus).toHaveBeenCalledWith(
        expect.objectContaining({
          imageUrl: 'data:image/jpeg;base64,selected-region',
          source: 'screenshot',
        }),
      ),
    );
  });

  it('does not reuse a quote after the browser selection is cleared', async () => {
    const bridge = createBridge();
    const { container } = render(<StudyWorkspace bridge={bridge} />);
    const selectedNode = (
      await screen.findByText(
        'Working memory carries the current reasoning state.',
      )
    ).firstChild;
    let selection = {
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'Working memory',
      anchorNode: selectedNode,
      getRangeAt: () => ({
        getBoundingClientRect: () => ({
          left: 20,
          bottom: 40,
          width: 100,
        }),
      }),
    } as unknown as Selection;
    vi.spyOn(window, 'getSelection').mockImplementation(() => selection);
    const article = container.querySelector('.study-document');
    expect(article).not.toBeNull();

    fireEvent.mouseUp(article!);
    selection = {
      isCollapsed: true,
      rangeCount: 0,
      toString: () => '',
      anchorNode: null,
    } as unknown as Selection;
    fireEvent.mouseUp(article!);
    await userEvent.click(
      screen.getByRole('button', { name: '引用选中文字' }),
    );

    expect(bridge.setTextFocus).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      '请先在左侧资料中选择一段文字',
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

  it('scrolls the web conversation to its newest content after sending', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const answeredContext: PageContext = {
      ...readyContext,
      messages: [
        ...readyContext.messages,
        {
          id: 'user-latest',
          role: 'user',
          content: '最新问题',
          createdAt: 2,
        },
        {
          id: 'assistant-latest',
          role: 'assistant',
          content: '最新回答',
          createdAt: 3,
          answeredBy: 'deepseek',
        },
      ],
    };
    const bridge = createBridge({
      ask: vi.fn().mockResolvedValue(answeredContext),
    });
    render(<StudyWorkspace bridge={bridge} />);
    const input = await screen.findByRole('textbox', {
      name: '向当前资料提问',
    });
    scrollIntoView.mockClear();

    await userEvent.type(input, '最新问题');
    await userEvent.click(screen.getByRole('button', { name: '发送问题' }));

    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'end',
      }),
    );
  });

  it('auto-grows and maximizes the web composer while Enter inserts a newline', async () => {
    const bridge = createBridge();
    render(<StudyWorkspace bridge={bridge} />);
    const input = await screen.findByRole('textbox', {
      name: '向当前资料提问',
    });
    Object.defineProperty(input, 'scrollHeight', {
      configurable: true,
      value: 240,
    });

    await userEvent.type(input, '第一行很长的研究问题');
    expect(input).toHaveStyle({ height: '240px' });

    await userEvent.click(
      screen.getByRole('button', { name: '最大化输入框' }),
    );
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('button', { name: '恢复输入框' }),
    ).toBeVisible();

    await userEvent.type(input, '{Enter}第二行补充');
    expect(input).toHaveValue('第一行很长的研究问题\n第二行补充');
    expect(bridge.ask).not.toHaveBeenCalled();

    await userEvent.click(
      screen.getByRole('button', { name: '恢复输入框' }),
    );
    await userEvent.type(input, '{Enter}');
    expect(bridge.ask).toHaveBeenCalledWith(
      '第一行很长的研究问题\n第二行补充',
    );
  });
});

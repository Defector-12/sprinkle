import {
  ArrowUp,
  ExternalLink,
  Image as ImageIcon,
  Languages,
  LibraryBig,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Quote,
  Scan,
  Upload,
  X,
} from 'lucide-react';
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { StudyWorkspaceBridgeContract } from '../application/ports.ts';
import type {
  ArticleBlock,
  ArticleFormula,
  ArticleImage,
  ArticleTable,
  PageContext,
  TextFocus,
} from '../core/types.ts';
import { sanitizeMathMl } from '../core/mathml.ts';
import { canAskPage } from '../core/page-context.ts';
import { selectionScopeForElement } from '../core/selection-focus.ts';
import {
  AssistantMarkdown,
  messageAuthor,
  MessageReferenceCard,
} from './MessageContent.tsx';
import {
  imageFileFromClipboard,
  LOCAL_IMAGE_ACCEPT,
  readLocalImage,
} from './local-image.ts';
import { QuestionHistoryRail } from './QuestionHistoryRail.tsx';
import { useAutoGrowTextarea } from './use-auto-grow-textarea.ts';
import { useStreamedAnswer } from './use-streamed-answer.ts';

export interface StudyWorkspaceProps {
  bridge: StudyWorkspaceBridgeContract;
}

interface RegionSelection {
  startX: number;
  startY: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface TextQuote {
  text: string;
  section: string;
  scope?: TextFocus['scope'];
  headingLevel?: number;
}

interface SelectionAction {
  quote: TextQuote;
  left: number;
  top: number;
}

interface TranslationResult {
  text: string;
  left: number;
  top: number;
  failed: boolean;
}

const MIN_READER_WIDTH = 30;
const MAX_READER_WIDTH = 75;
const MIN_READER_PANE_WIDTH = 420;
const MIN_CHAT_PANE_WIDTH = 360;
const DIVIDER_WIDTH = 12;
const STACKED_LAYOUT_MAX_WIDTH = 900;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readerWidthRange(workspaceWidth: number): {
  min: number;
  max: number;
} {
  if (workspaceWidth <= STACKED_LAYOUT_MAX_WIDTH) {
    return { min: MIN_READER_WIDTH, max: MAX_READER_WIDTH };
  }
  return {
    min: Math.max(
      MIN_READER_WIDTH,
      Math.ceil((MIN_READER_PANE_WIDTH / workspaceWidth) * 100),
    ),
    max: Math.min(
      MAX_READER_WIDTH,
      Math.floor(
        ((workspaceWidth - DIVIDER_WIDTH - MIN_CHAT_PANE_WIDTH) /
          workspaceWidth) *
          100,
      ),
    ),
  };
}

function headingId(block: ArticleBlock): string {
  return `study-heading-${block.id}`;
}

function blockElement(block: ArticleBlock) {
  const attributes = {
    'data-section': block.section,
    ...(block.type === 'heading'
      ? { 'data-context-reader-heading-level': block.level ?? 2 }
      : {}),
  };
  switch (block.type) {
    case 'heading': {
      const level = clamp(block.level ?? 2, 2, 6);
      if (level === 3) {
        return <h3 key={block.id} id={headingId(block)} {...attributes}>{block.text}</h3>;
      }
      if (level === 4) {
        return <h4 key={block.id} id={headingId(block)} {...attributes}>{block.text}</h4>;
      }
      if (level === 5) {
        return <h5 key={block.id} id={headingId(block)} {...attributes}>{block.text}</h5>;
      }
      if (level === 6) {
        return <h6 key={block.id} id={headingId(block)} {...attributes}>{block.text}</h6>;
      }
      return <h2 key={block.id} id={headingId(block)} {...attributes}>{block.text}</h2>;
    }
    case 'code':
      return (
        <pre key={block.id} {...attributes}>
          <code>{block.text}</code>
        </pre>
      );
    case 'quote':
      return <blockquote key={block.id} {...attributes}>{block.text}</blockquote>;
    case 'list':
      return (
        <ul key={block.id} {...attributes} className="study-document__list">
          {block.text.split('\n').map((item, index) => (
            <li key={`${block.id}-item-${index}`}>{item}</li>
          ))}
        </ul>
      );
    default:
      return <p key={block.id} {...attributes}>{block.text}</p>;
  }
}

function TableView({ table }: { table: ArticleTable }) {
  return (
    <div className="study-table-wrap" data-section={table.section}>
      <table aria-label={table.caption || `表格：${table.section}`}>
        {table.caption && <caption>{table.caption}</caption>}
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={`${table.id}-row-${rowIndex}`}>
              {row.cells.map((cell, cellIndex) => {
                const Cell = cell.header ? 'th' : 'td';
                return (
                  <Cell
                    key={`${table.id}-cell-${rowIndex}-${cellIndex}`}
                    colSpan={cell.colSpan}
                    rowSpan={cell.rowSpan}
                    scope={
                      cell.header
                        ? rowIndex === 0
                          ? 'col'
                          : 'row'
                        : undefined
                    }
                  >
                    {cell.text}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FormulaView({ formula }: { formula: ArticleFormula }) {
  const formulaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = formulaRef.current;
    if (!container) return;
    container.replaceChildren();
    const safeMathMl = sanitizeMathMl(formula.mathml);
    if (safeMathMl) {
      const parsed = new DOMParser().parseFromString(
        safeMathMl,
        'application/xml',
      );
      if (!parsed.querySelector('parsererror')) {
        container.append(document.importNode(parsed.documentElement, true));
        return;
      }
    }
    container.textContent = formula.tex;
  }, [formula.mathml, formula.tex]);

  return (
    <div
      ref={formulaRef}
      className={`study-formula study-formula--${formula.display}`}
      data-testid={`study-formula-${formula.id}`}
      data-section={formula.section}
      aria-label={formula.tex || '数学公式'}
    />
  );
}

function imageOrder(
  image: ArticleImage,
  blocks: ArticleBlock[],
): number {
  if (Number.isInteger(image.order)) {
    return clamp(image.order as number, 0, blocks.length);
  }
  const sectionIndex = blocks.findLastIndex(
    (block) => block.section === image.section,
  );
  return sectionIndex >= 0 ? sectionIndex + 1 : blocks.length;
}

function ArticleImageView({
  image,
  picking,
  onQuote,
}: {
  image: ArticleImage;
  picking: boolean;
  onQuote: (image: ArticleImage, rect: DOMRect) => void;
}) {
  return (
    <figure
      className={picking ? 'study-figure study-figure--picking' : 'study-figure'}
      data-section={image.section}
    >
      <button
        type="button"
        aria-label={`引用图片：${image.alt || image.caption || '页面图片'}`}
        onClick={(event) => {
          const renderedImage = event.currentTarget.querySelector('img');
          if (renderedImage) {
            onQuote(image, renderedImage.getBoundingClientRect());
          }
        }}
      >
        <img src={image.src} alt={image.alt || image.caption || '文章图片'} />
        <span>
          <ImageIcon size={15} aria-hidden="true" />
          引用此图
        </span>
      </button>
      {(image.caption || image.surroundingText) && (
        <figcaption>{image.caption || image.surroundingText}</figcaption>
      )}
    </figure>
  );
}

function FocusPreview({
  context,
  onClear,
}: {
  context: PageContext;
  onClear: () => void;
}) {
  const focus = context.focus;
  if (!focus) return null;

  return (
    <aside className="study-focus" aria-label="下一条问题的引用内容">
      {focus.type === 'text' ? (
        <Quote size={16} aria-hidden="true" />
      ) : (
        <img src={focus.imageUrl} alt="" aria-hidden="true" />
      )}
      <div>
        <span>
          {focus.type === 'text'
            ? '文字引用'
            : focus.type === 'image'
              ? '图片引用'
              : '框选区域'}
        </span>
        <p>
          {focus.type === 'image'
            ? focus.alt || focus.text || '页面图片'
            : focus.text || '框选区域'}
        </p>
      </div>
      <button
        type="button"
        aria-label="取消引用"
        title="取消引用"
        onClick={onClear}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </aside>
  );
}

export function StudyWorkspace({ bridge }: StudyWorkspaceProps) {
  const [context, setContext] = useState<PageContext | null>(null);
  const [readerWidth, setReaderWidth] = useState(56);
  const [selectedQuote, setSelectedQuote] = useState<TextQuote | null>(null);
  const [selectionAction, setSelectionAction] =
    useState<SelectionAction | null>(null);
  const [translation, setTranslation] =
    useState<TranslationResult | null>(null);
  const [imagePickMode, setImagePickMode] = useState(false);
  const [question, setQuestion] = useState('');
  const [isComposerMaximized, setIsComposerMaximized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const [capturingRegion, setCapturingRegion] = useState(false);
  const [region, setRegion] = useState<RegionSelection | null>(null);
  const {
    target: streamingTarget,
    revealedCount,
    waitForAnswer,
    acceptAnswer,
    cancelAnswer,
    visibleContent,
    isStreaming: isMessageStreaming,
  } = useStreamedAnswer();
  const workspaceRef = useRef<HTMLElement>(null);
  const documentRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const localImageInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLOListElement>(null);
  const messagesEndRef = useRef<HTMLLIElement>(null);
  const dividerDrag = useRef(false);
  const regionDrag = useRef(false);
  const regionRef = useRef<RegionSelection | null>(null);
  const translationRequestRef = useRef(0);
  const translationRef = useRef<HTMLElement>(null);
  const translationDragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const translationVisible = translation !== null;
  const canAsk = canAskPage(context);
  useAutoGrowTextarea(inputRef, question, isComposerMaximized, 92);

  useEffect(() => {
    if (!translationVisible) return;
    const dismissTranslation = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        translationRef.current?.contains(event.target)
      ) {
        return;
      }
      translationRequestRef.current += 1;
      translationDragRef.current = null;
      setTranslation(null);
    };
    document.addEventListener('pointerdown', dismissTranslation, true);
    return () => {
      document.removeEventListener(
        'pointerdown',
        dismissTranslation,
        true,
      );
    };
  }, [translationVisible]);

  useEffect(() => {
    let active = true;
    let receivedUpdate = false;
    const unsubscribe = bridge.subscribe((nextContext) => {
      if (!active) return;
      receivedUpdate = true;
      acceptAnswer(nextContext);
      setContext(nextContext);
    });
    void bridge
      .initialize()
      .then((nextContext) => {
        if (active && !receivedUpdate) setContext(nextContext);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : '无法打开学习工作台',
          );
        }
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [acceptAnswer, bridge]);

  useEffect(() => {
    if (isComposerMaximized) return;
    messagesEndRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'end',
    });
  }, [context?.messages, isComposerMaximized]);

  useEffect(() => {
    if (isComposerMaximized || !streamingTarget) return;
    messagesEndRef.current?.scrollIntoView?.({
      behavior: 'auto',
      block: 'end',
    });
  }, [isComposerMaximized, revealedCount, streamingTarget]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [isComposerMaximized]);

  useEffect(() => {
    if (!context) return;
    const fitPaneWidths = () => {
      const width = workspaceRef.current?.getBoundingClientRect().width;
      if (!width || width <= STACKED_LAYOUT_MAX_WIDTH) return;
      const range = readerWidthRange(width);
      setReaderWidth((current) => clamp(current, range.min, range.max));
    };
    fitPaneWidths();
    window.addEventListener('resize', fitPaneWidths);
    return () => window.removeEventListener('resize', fitPaneWidths);
  }, [context?.key]);

  function resizeFromPointer(clientX: number) {
    if (!Number.isFinite(clientX)) return;
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds?.width || bounds.width <= STACKED_LAYOUT_MAX_WIDTH) return;
    const percentage = ((clientX - bounds.left) / bounds.width) * 100;
    const range = readerWidthRange(bounds.width);
    setReaderWidth(Math.round(clamp(
      percentage,
      range.min,
      range.max,
    )));
  }

  function onDividerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const width = workspaceRef.current?.getBoundingClientRect().width ?? 0;
    const range = readerWidthRange(width);
    setReaderWidth((current) =>
      clamp(current + direction * 2, range.min, range.max),
    );
  }

  function quoteFromSelection(): TextQuote | null {
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (!selection || !text || selection.isCollapsed) return null;
    const node =
      selection.rangeCount > 0
        ? selection.getRangeAt(0).startContainer ?? selection.anchorNode
        : selection.anchorNode;
    const element =
      node?.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node?.parentElement;
    return {
      text,
      section:
        element?.closest<HTMLElement>('[data-section]')?.dataset.section ||
        context?.article?.title ||
        context?.title ||
        '当前资料',
      ...selectionScopeForElement(element ?? null),
    };
  }

  async function quoteSelection(preferredQuote?: TextQuote | null) {
    const quote = preferredQuote || quoteFromSelection() || selectedQuote;
    if (!quote) {
      setError('请先在左侧资料中选择一段文字。');
      return;
    }
    setError(null);
    try {
      const nextContext =
        quote.scope === 'section'
          ? await bridge.setTextFocus(
              quote.text.slice(0, 4_000),
              quote.section,
              quote.scope,
              quote.headingLevel,
            )
          : await bridge.setTextFocus(
              quote.text.slice(0, 4_000),
              quote.section,
            );
      setContext(nextContext);
      setSelectedQuote(null);
      setSelectionAction(null);
      inputRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法引用所选文字');
    }
  }

  async function translateSelection(action: SelectionAction) {
    const request = ++translationRequestRef.current;
    const bubbleWidth = Math.min(320, window.innerWidth - 24);
    const left = clamp(
      action.left - bubbleWidth / 2,
      12,
      Math.max(12, window.innerWidth - bubbleWidth - 12),
    );
    const top = clamp(
      action.top + 36,
      12,
      Math.max(12, window.innerHeight - 292),
    );
    setSelectionAction(null);
    setTranslation({
      text: '翻译中...',
      left,
      top,
      failed: false,
    });
    try {
      const result = await bridge.translate(
        action.quote.text.slice(0, 4_000),
        action.quote.section,
      );
      if (request !== translationRequestRef.current) return;
      setTranslation((current) =>
        current
          ? {
              ...current,
              text: result.trim() || '未返回译文',
              failed: false,
            }
          : null,
      );
    } catch (cause) {
      if (request !== translationRequestRef.current) return;
      const message =
        cause instanceof Error ? cause.message : '操作失败，请重试。';
      setTranslation((current) =>
        current
          ? {
              ...current,
              text: `翻译失败：${message}`,
              failed: true,
            }
          : null,
      );
    }
  }

  async function quoteImage(image: ArticleImage, rect: DOMRect) {
    setBusy(true);
    setImagePickMode(false);
    setError(null);
    try {
      const screenshot = await bridge.captureRegion({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
      setContext(
        await bridge.setImageFocus({
          type: 'image',
          imageUrl: screenshot || image.src,
          alt: image.alt,
          text: image.caption || image.surroundingText,
          section: image.section,
          source: screenshot ? 'screenshot' : 'original',
        }),
      );
      inputRef.current?.focus();
    } catch {
      setContext(
        await bridge.setImageFocus({
          type: 'image',
          imageUrl: image.src,
          alt: image.alt,
          text: image.caption || image.surroundingText,
          section: image.section,
          source: 'original',
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadLocalImage(file: File) {
    setBusy(true);
    setImagePickMode(false);
    setError(null);
    try {
      const imageUrl = await readLocalImage(file);
      setContext(
        await bridge.setImageFocus({
          type: 'image',
          imageUrl,
          alt: file.name || '本地图片',
          text: file.name || '本地上传图片',
          section: '本地上传',
          source: 'upload',
        }),
      );
      inputRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法上传图片');
    } finally {
      setBusy(false);
    }
  }

  async function completeRegionSelection(selection: RegionSelection) {
    const documentBounds = documentRef.current?.getBoundingClientRect();
    if (!documentBounds || selection.width < 12 || selection.height < 12) {
      setRegionMode(false);
      regionRef.current = null;
      setRegion(null);
      return;
    }
    setBusy(true);
    setCapturingRegion(true);
    setError(null);
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const imageUrl = await bridge.captureRegion({
        left: documentBounds.left + selection.left,
        top: documentBounds.top + selection.top,
        width: selection.width,
        height: selection.height,
      });
      setContext(
        await bridge.setRegionFocus({
          type: 'region',
          imageUrl,
          text: '工作台框选区域',
          section: context?.article?.title || context?.title || '当前资料',
          source: 'screenshot',
        }),
      );
      inputRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '区域引用失败');
    } finally {
      setBusy(false);
      setCapturingRegion(false);
      setRegionMode(false);
      regionRef.current = null;
      setRegion(null);
    }
  }

  async function sendQuestion() {
    const value = question.trim();
    if (!value || busy || !canAsk) return;
    setBusy(true);
    waitForAnswer(context);
    setError(null);
    setQuestion('');
    try {
      const nextContext = await bridge.ask(value);
      setContext(nextContext);
      acceptAnswer(nextContext);
    } catch (cause) {
      cancelAnswer();
      setQuestion(value);
      setError(cause instanceof Error ? cause.message : '问题发送失败');
    } finally {
      setBusy(false);
    }
  }

  async function clearFocus() {
    setError(null);
    try {
      setContext(await bridge.clearFocus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法取消引用');
    }
  }

  if (!context) {
    return (
      <main className="study-loading" aria-busy="true">
        <span className="study-brand-mark" aria-hidden="true">C</span>
        <LoaderCircle className="spin" size={22} aria-hidden="true" />
        <p>{error || '正在准备学习工作台'}</p>
      </main>
    );
  }

  const article = context.article;
  if (!article) {
    return <main className="study-loading">当前资料不可用。</main>;
  }

  const style = {
    '--reader-width': `${readerWidth}%`,
  } as CSSProperties;
  const imagesByOrder = new Map<number, ArticleImage[]>();
  for (const image of article.images) {
    const order = imageOrder(image, article.blocks);
    const images = imagesByOrder.get(order) ?? [];
    images.push(image);
    imagesByOrder.set(order, images);
  }
  const tablesByOrder = new Map<number, ArticleTable[]>();
  for (const table of article.tables ?? []) {
    const tables = tablesByOrder.get(table.order) ?? [];
    tables.push(table);
    tablesByOrder.set(table.order, tables);
  }
  const formulasByOrder = new Map<number, ArticleFormula[]>();
  for (const formula of article.formulas ?? []) {
    const formulas = formulasByOrder.get(formula.order) ?? [];
    formulas.push(formula);
    formulasByOrder.set(formula.order, formulas);
  }
  const headings = article.blocks.filter(
    (block) => block.type === 'heading' && (block.level ?? 2) >= 2,
  );

  return (
    <main
      ref={workspaceRef}
      className="study-workspace"
      data-testid="study-workspace"
      style={style}
    >
      <section
        className={`study-reader${
          imagePickMode ? ' study-reader--image-picking' : ''
        }`}
        aria-labelledby="study-document-title"
      >
        <header className="study-reader__bar">
          <div className="study-brand">
            <span className="study-brand-mark" aria-hidden="true">C</span>
            <div>
              <strong>Context Reader</strong>
              <span>学习工作台</span>
            </div>
          </div>
          <div className="study-reader__tools">
            <button type="button" onClick={() => void quoteSelection()}>
              <Quote size={16} aria-hidden="true" />
              <span>引用选中文字</span>
            </button>
            <button
              type="button"
              aria-label="点选资料图片"
              aria-pressed={imagePickMode}
              onClick={() => setImagePickMode((current) => !current)}
            >
              <ImageIcon size={16} aria-hidden="true" />
              <span>点选图片</span>
            </button>
            <input
              ref={localImageInputRef}
              type="file"
              accept={LOCAL_IMAGE_ACCEPT}
              aria-label="选择本地图片文件"
              disabled={busy}
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void uploadLocalImage(file);
              }}
            />
            <button
              type="button"
              aria-label="上传本地图片"
              title="上传本地图片"
              disabled={busy}
              onClick={() => localImageInputRef.current?.click()}
            >
              <Upload size={16} aria-hidden="true" />
              <span>上传图片</span>
            </button>
            <button type="button" onClick={() => setRegionMode(true)}>
              <Scan size={16} aria-hidden="true" />
              <span>框选资料区域</span>
            </button>
            <button type="button" onClick={() => void bridge.openSource()}>
              <ExternalLink size={16} aria-hidden="true" />
              <span>打开原网页</span>
            </button>
            <button type="button" onClick={() => void bridge.openHistory()}>
              <LibraryBig size={16} aria-hidden="true" />
              <span>学习记录</span>
            </button>
          </div>
        </header>

        <article
          ref={documentRef}
          className="study-document"
          onScroll={() => setSelectionAction(null)}
          onMouseUp={() => {
            const quote = quoteFromSelection();
            if (!quote) {
              setSelectedQuote(null);
              setSelectionAction(null);
              return;
            }
            translationRequestRef.current += 1;
            setTranslation(null);
            setSelectedQuote(quote);
            const selection = window.getSelection();
            const rect =
              selection && selection.rangeCount > 0
                ? selection.getRangeAt(0).getBoundingClientRect()
                : null;
            setSelectionAction({
              quote,
              left: clamp(
                (rect?.left ?? 24) + (rect?.width ?? 0) / 2,
                54,
                window.innerWidth - 54,
              ),
              top: clamp(
                (rect?.bottom ?? 72) + 10,
                70,
                window.innerHeight - 54,
              ),
            });
          }}
        >
          {headings.length > 0 && (
            <nav className="study-toc" aria-label="资料目录">
              <strong>On this page <span>本页内容</span></strong>
              <ol>
                {headings.map((heading) => (
                  <li key={`toc-${heading.id}`}>
                    <a
                      href={`#${headingId(heading)}`}
                      data-level={heading.level ?? 2}
                      onClick={(event) => {
                        event.preventDefault();
                        document
                          .getElementById(headingId(heading))
                          ?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                          });
                      }}
                    >
                      {heading.text}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}
          <div className="study-document__body">
            <div className="study-document__meta">
              <span>{new URL(article.url).hostname}</span>
              <span>{article.blocks.length} 个内容块</span>
            </div>
            <h1 id="study-document-title">{article.title}</h1>
            <a href={article.url} target="_blank" rel="noreferrer">
              {article.url}
            </a>
            <div className="study-document__rule" aria-hidden="true" />
            {Array.from(
              { length: article.blocks.length + 1 },
              (_, order) => (
                <Fragment key={`flow-${order}`}>
                  {(imagesByOrder.get(order) ?? []).map((image) => (
                    <ArticleImageView
                      key={image.id}
                      image={image}
                      picking={imagePickMode}
                      onQuote={(nextImage, rect) =>
                        void quoteImage(nextImage, rect)
                      }
                    />
                  ))}
                  {(tablesByOrder.get(order) ?? []).map((table) => (
                    <TableView key={table.id} table={table} />
                  ))}
                  {(formulasByOrder.get(order) ?? []).map((formula) => (
                    <FormulaView key={formula.id} formula={formula} />
                  ))}
                  {article.blocks[order] &&
                  !(
                    article.blocks[order]?.level === 1 &&
                    article.blocks[order]?.text === article.title
                  )
                    ? blockElement(article.blocks[order])
                    : null}
                </Fragment>
              ),
            )}
          </div>
        </article>

        {selectionAction && (
          <div
            className="study-selection-actions"
            role="toolbar"
            aria-label="选中文字操作"
            style={{
              left: selectionAction.left,
              top: selectionAction.top,
            }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button
              type="button"
              aria-label="提问选中文字"
              onClick={() => void quoteSelection(selectionAction.quote)}
            >
              <Quote size={13} aria-hidden="true" />
              提问
            </button>
            <button
              type="button"
              aria-label="翻译选中文字"
              onClick={() => void translateSelection(selectionAction)}
            >
              <Languages size={13} aria-hidden="true" />
              翻译
            </button>
          </div>
        )}

        {translation && (
          <aside
            ref={translationRef}
            className={`study-translation${
              translation.failed ? ' study-translation--failed' : ''
            }`}
            role="status"
            aria-label="划词译文"
            aria-live="polite"
            style={{
              left: translation.left,
              top: translation.top,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              translationDragRef.current = {
                pointerId: event.pointerId,
                offsetX: event.clientX - bounds.left,
                offsetY: event.clientY - bounds.top,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.style.cursor = 'grabbing';
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              const drag = translationDragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              setTranslation((current) =>
                current
                  ? {
                      ...current,
                      left: clamp(
                        event.clientX - drag.offsetX,
                        8,
                        Math.max(8, window.innerWidth - bounds.width - 8),
                      ),
                      top: clamp(
                        event.clientY - drag.offsetY,
                        8,
                        Math.max(8, window.innerHeight - bounds.height - 8),
                      ),
                    }
                  : null,
              );
            }}
            onPointerUp={(event) => {
              if (
                translationDragRef.current?.pointerId !== event.pointerId
              ) {
                return;
              }
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              translationDragRef.current = null;
              event.currentTarget.style.cursor = 'grab';
            }}
            onPointerCancel={(event) => {
              translationDragRef.current = null;
              event.currentTarget.style.cursor = 'grab';
            }}
          >
            {translation.text}
          </aside>
        )}

        {regionMode && (
          <div
            className={`study-region-picker${
              capturingRegion ? ' study-region-picker--capturing' : ''
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="框选资料区域"
            data-testid="study-region-picker"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setRegionMode(false);
                regionRef.current = null;
                setRegion(null);
              }
            }}
            onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                !Number.isFinite(event.clientX) ||
                !Number.isFinite(event.clientY)
              ) {
                return;
              }
              regionDrag.current = true;
              const nextRegion = {
                startX: event.clientX - bounds.left,
                startY: event.clientY - bounds.top,
                left: event.clientX - bounds.left,
                top: event.clientY - bounds.top,
                width: 0,
                height: 0,
              };
              regionRef.current = nextRegion;
              setRegion(nextRegion);
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
              if (
                !regionDrag.current ||
                !Number.isFinite(event.clientX) ||
                !Number.isFinite(event.clientY)
              ) {
                return;
              }
              const bounds = event.currentTarget.getBoundingClientRect();
              setRegion((current) => {
                const activeRegion = regionRef.current ?? current;
                if (!activeRegion) return current;
                const x = event.clientX - bounds.left;
                const y = event.clientY - bounds.top;
                const nextRegion = {
                  ...activeRegion,
                  left: Math.min(activeRegion.startX, x),
                  top: Math.min(activeRegion.startY, y),
                  width: Math.abs(x - activeRegion.startX),
                  height: Math.abs(y - activeRegion.startY),
                };
                regionRef.current = nextRegion;
                return nextRegion;
              });
            }}
            onPointerUp={(event: ReactPointerEvent<HTMLDivElement>) => {
              regionDrag.current = false;
              event.currentTarget.releasePointerCapture?.(event.pointerId);
              if (regionRef.current) {
                void completeRegionSelection(regionRef.current);
              }
            }}
            tabIndex={-1}
          >
            <p>拖动框选左侧资料，按 Escape 取消</p>
            {region && (
              <span
                className="study-region-picker__box"
                style={{
                  left: region.left,
                  top: region.top,
                  width: region.width,
                  height: region.height,
                }}
              />
            )}
          </div>
        )}
      </section>

      <div
        className="study-divider"
        role="separator"
        aria-label="调整资料和对话区域宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_READER_WIDTH}
        aria-valuemax={MAX_READER_WIDTH}
        aria-valuenow={readerWidth}
        tabIndex={0}
        onPointerDown={(event) => {
          dividerDrag.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dividerDrag.current) resizeFromPointer(event.clientX);
        }}
        onPointerUp={(event) => {
          dividerDrag.current = false;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
        onPointerCancel={() => {
          dividerDrag.current = false;
        }}
        onKeyDown={onDividerKeyDown}
      >
        <span aria-hidden="true" />
      </div>

      <section
        className={`study-chat${
          isComposerMaximized ? ' study-chat--composer-maximized' : ''
        }`}
        aria-labelledby="study-chat-title"
      >
        <header className="study-chat__header">
          <div>
            <p>研究对话</p>
            <h2 id="study-chat-title">围绕当前资料提问</h2>
          </div>
          <span className={`study-status study-status--${context.status}`}>
            {context.status === 'answering' ? '回答中' : '上下文已同步'}
          </span>
        </header>

        <div className="study-conversation">
          <ol
            ref={messagesRef}
            className="study-messages"
            aria-label="当前资料对话"
          >
            {context.messages.length === 0 && (
              <li className="study-messages__empty">
                <Quote size={20} aria-hidden="true" />
                <strong>问题可以更深入</strong>
                <p>左侧资料、引用内容和最近对话会共同组成回答上下文。</p>
              </li>
            )}
            {context.messages.map((message) => (
              <li
                key={message.id}
                className={`study-message study-message--${message.role}`}
                data-question-id={
                  message.role === 'user' ? message.id : undefined
                }
              >
                <span>{messageAuthor(message)}</span>
                <MessageReferenceCard reference={message.reference} />
                {message.role === 'assistant' ? (
                  <AssistantMarkdown
                    content={visibleContent(message)}
                    busy={isMessageStreaming(message)}
                    caretClassName="study-stream-caret"
                  />
                ) : (
                  <p className="message-plain">{message.content}</p>
                )}
              </li>
            ))}
            <li
              ref={messagesEndRef}
              className="study-messages__end"
              aria-hidden="true"
            />
          </ol>
          <QuestionHistoryRail
            messages={context.messages}
            scrollContainerRef={messagesRef}
          />
        </div>

        <div className="study-feedback" aria-live="polite" aria-atomic="true">
          {error && <p role="alert">{error}</p>}
        </div>

        <div className="study-composer">
          <FocusPreview
            context={context}
            onClear={() => void clearFocus()}
          />
          <label className="sr-only" htmlFor="study-question">
            向当前资料提问
          </label>
          <textarea
            ref={inputRef}
            id="study-question"
            rows={3}
            value={question}
            aria-expanded={isComposerMaximized}
            placeholder="记录你的问题、反例或推演…"
            disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
            onPaste={(event) => {
              const file = imageFileFromClipboard(event.clipboardData);
              if (!file) return;
              event.preventDefault();
              void uploadLocalImage(file);
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !isComposerMaximized &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void sendQuestion();
              }
            }}
          />
          <div className="study-composer__actions">
            <button
              className="study-composer__maximize"
              type="button"
              aria-label={
                isComposerMaximized ? '恢复输入框' : '最大化输入框'
              }
              aria-pressed={isComposerMaximized}
              title={isComposerMaximized ? '恢复输入框' : '最大化输入框'}
              onClick={() =>
                setIsComposerMaximized((current) => !current)
              }
            >
              {isComposerMaximized ? (
                <Minimize2 size={17} aria-hidden="true" />
              ) : (
                <Maximize2 size={17} aria-hidden="true" />
              )}
            </button>
            <button
              className="study-composer__send"
              type="button"
              aria-label="发送问题"
              disabled={busy || !canAsk || !question.trim()}
              onClick={() => void sendQuestion()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
              ) : (
                <ArrowUp size={19} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

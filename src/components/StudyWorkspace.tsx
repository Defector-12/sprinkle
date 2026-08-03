import {
  ArrowUp,
  ExternalLink,
  Image as ImageIcon,
  LoaderCircle,
  Quote,
  Scan,
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

import type {
  ArticleBlock,
  ArticleImage,
  ImageFocus,
  PageContext,
  RegionFocus,
} from '../core/types.ts';
import type { StudyCaptureRect } from '../runtime/messages.ts';

export interface StudyWorkspaceBridgeContract {
  initialize(): Promise<PageContext>;
  ask(question: string): Promise<PageContext>;
  setTextFocus(text: string, section: string): Promise<PageContext>;
  setImageFocus(focus: ImageFocus): Promise<PageContext>;
  setRegionFocus(focus: RegionFocus): Promise<PageContext>;
  captureRegion(rect: StudyCaptureRect): Promise<string>;
  clearFocus(): Promise<PageContext>;
  openSource(): Promise<void>;
  subscribe(listener: (context: PageContext) => void): () => void;
}

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
}

interface SelectionAction {
  quote: TextQuote;
  left: number;
  top: number;
}

const MIN_READER_WIDTH = 30;
const MAX_READER_WIDTH = 75;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function messageAuthor(
  message: PageContext['messages'][number],
): string {
  if (message.role === 'user') return '你';
  if (message.answeredBy === 'deepseek') return 'DeepSeek';
  if (message.answeredBy === 'doubao') return 'Doubao';
  return '助手';
}

function blockElement(block: ArticleBlock) {
  const attributes = {
    'data-section': block.section,
  };
  switch (block.type) {
    case 'heading':
      return <h2 key={block.id} {...attributes}>{block.text}</h2>;
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
        <p key={block.id} {...attributes} className="study-document__list">
          {block.text}
        </p>
      );
    default:
      return <p key={block.id} {...attributes}>{block.text}</p>;
  }
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
        <span>{focus.type === 'text' ? '文字引用' : '图片引用 · Doubao'}</span>
        <p>
          {focus.type === 'image'
            ? focus.alt || focus.text || '页面图片'
            : focus.text || '框选区域'}
        </p>
      </div>
      <button type="button" aria-label="移除引用" onClick={onClear}>
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
  const [imagePickMode, setImagePickMode] = useState(false);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [regionMode, setRegionMode] = useState(false);
  const [capturingRegion, setCapturingRegion] = useState(false);
  const [region, setRegion] = useState<RegionSelection | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const documentRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dividerDrag = useRef(false);
  const regionDrag = useRef(false);
  const regionRef = useRef<RegionSelection | null>(null);

  useEffect(() => {
    let active = true;
    void bridge
      .initialize()
      .then((nextContext) => {
        if (active) setContext(nextContext);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : '无法打开学习工作台',
          );
        }
      });
    const unsubscribe = bridge.subscribe((nextContext) => {
      if (active) setContext(nextContext);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  function resizeFromPointer(clientX: number) {
    if (!Number.isFinite(clientX)) return;
    const bounds = workspaceRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    const percentage = ((clientX - bounds.left) / bounds.width) * 100;
    setReaderWidth(Math.round(clamp(
      percentage,
      MIN_READER_WIDTH,
      MAX_READER_WIDTH,
    )));
  }

  function onDividerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    setReaderWidth((current) =>
      clamp(current + direction * 2, MIN_READER_WIDTH, MAX_READER_WIDTH),
    );
  }

  function quoteFromSelection(): TextQuote | null {
    const selection = window.getSelection();
    const text = selection?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (!selection || !text || selection.isCollapsed) return null;
    const element =
      selection.anchorNode?.nodeType === Node.ELEMENT_NODE
        ? (selection.anchorNode as Element)
        : selection.anchorNode?.parentElement;
    return {
      text,
      section:
        element?.closest<HTMLElement>('[data-section]')?.dataset.section ||
        context?.article?.title ||
        context?.title ||
        '当前资料',
    };
  }

  async function quoteSelection(preferredQuote?: TextQuote | null) {
    const quote = preferredQuote || quoteFromSelection() || selectedQuote;
    if (!quote) {
      setError('请先在左侧资料中选择一段文字。');
      return;
    }
    setError(null);
    setContext(
      await bridge.setTextFocus(quote.text.slice(0, 4_000), quote.section),
    );
    setSelectionAction(null);
    inputRef.current?.focus();
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
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      setContext(await bridge.ask(value));
      setQuestion('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '问题发送失败');
    } finally {
      setBusy(false);
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
            <button type="button" onClick={() => setRegionMode(true)}>
              <Scan size={16} aria-hidden="true" />
              <span>框选资料区域</span>
            </button>
            <button type="button" onClick={() => void bridge.openSource()}>
              <ExternalLink size={16} aria-hidden="true" />
              <span>打开原网页</span>
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
              setSelectionAction(null);
              return;
            }
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
                {article.blocks[order]
                  ? blockElement(article.blocks[order])
                  : null}
              </Fragment>
            ),
          )}
        </article>

        {selectionAction && (
          <button
            className="study-selection-action"
            type="button"
            aria-label="提问选中文字"
            style={{
              left: selectionAction.left,
              top: selectionAction.top,
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void quoteSelection(selectionAction.quote)}
          >
            <Quote size={14} aria-hidden="true" />
            提问
          </button>
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

      <section className="study-chat" aria-labelledby="study-chat-title">
        <header className="study-chat__header">
          <div>
            <p>研究对话</p>
            <h2 id="study-chat-title">围绕当前资料提问</h2>
          </div>
          <span className={`study-status study-status--${context.status}`}>
            {context.status === 'answering' ? '回答中' : '上下文已同步'}
          </span>
        </header>

        <ol className="study-messages" aria-label="当前资料对话">
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
            >
              <span>{messageAuthor(message)}</span>
              <p>{message.content}</p>
            </li>
          ))}
        </ol>

        <div className="study-feedback" aria-live="polite" aria-atomic="true">
          {error && <p role="alert">{error}</p>}
        </div>

        <div className="study-composer">
          <FocusPreview
            context={context}
            onClear={() => void bridge.clearFocus().then(setContext)}
          />
          <label className="sr-only" htmlFor="study-question">
            向当前资料提问
          </label>
          <textarea
            ref={inputRef}
            id="study-question"
            rows={3}
            value={question}
            placeholder="记录你的问题、反例或推演…"
            disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void sendQuestion();
              }
            }}
          />
          <button
            type="button"
            aria-label="发送问题"
            disabled={busy || !question.trim()}
            onClick={() => void sendQuestion()}
          >
            {busy ? (
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
            ) : (
              <ArrowUp size={19} aria-hidden="true" />
            )}
          </button>
        </div>
      </section>
    </main>
  );
}

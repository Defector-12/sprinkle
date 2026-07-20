import {
  Check,
  LoaderCircle,
  MessageCircle,
  Send,
  Settings,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { PageContext } from '../core/types.ts';

export const FLOATING_ASSISTANT_OPEN_EVENT = 'context-reader:open';

export interface FloatingAssistantBridge {
  initialize(): Promise<PageContext>;
  ask(question: string): Promise<PageContext>;
  openSettings(): Promise<void>;
  subscribe(listener: (context: PageContext) => void): () => void;
}

export interface FloatingAssistantProps {
  bridge: FloatingAssistantBridge;
}

const ORB_SIZE = 48;
const EDGE_MARGIN = 18;
const DRAG_THRESHOLD = 4;
const STREAM_INTERVAL_MS = 18;
const STREAM_STEP = 2;

interface OrbPosition {
  x: number;
  y: number;
}

function viewport(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 400, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function clampOrb({ x, y }: OrbPosition): OrbPosition {
  const { width, height } = viewport();
  const maxX = Math.max(EDGE_MARGIN, width - ORB_SIZE - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, height - ORB_SIZE - EDGE_MARGIN);
  const safeX = Number.isFinite(x) ? x : maxX;
  const safeY = Number.isFinite(y) ? y : maxY;
  return {
    x: Math.min(Math.max(EDGE_MARGIN, safeX), maxX),
    y: Math.min(Math.max(EDGE_MARGIN, safeY), maxY),
  };
}

function defaultOrbPosition(): OrbPosition {
  const { width, height } = viewport();
  return clampOrb({ x: width, y: height });
}

function snapToEdge({ x, y }: OrbPosition): OrbPosition {
  const { width } = viewport();
  const center = x + ORB_SIZE / 2;
  const edgeX =
    center < width / 2 ? EDGE_MARGIN : width - ORB_SIZE - EDGE_MARGIN;
  return clampOrb({ x: edgeX, y });
}

function dialogStyle({ x, y }: OrbPosition): CSSProperties {
  const { width, height } = viewport();
  const margin = 12;
  const gap = 12;
  const dialogWidth = Math.min(400, width - margin * 2);
  const left = Math.min(
    Math.max(margin, x + ORB_SIZE / 2 - dialogWidth / 2),
    Math.max(margin, width - dialogWidth - margin),
  );

  // Anchor to whichever side of the orb has more room, and cap the height to
  // the space actually available there so the card never spills off-screen.
  const spaceBelow = height - (y + ORB_SIZE) - gap - margin;
  const spaceAbove = y - gap - margin;
  const opensBelow = spaceBelow >= spaceAbove;
  const maxHeight = Math.min(
    640,
    Math.max(200, opensBelow ? spaceBelow : spaceAbove),
  );

  return opensBelow
    ? { left, top: y + ORB_SIZE + gap, maxHeight }
    : { left, bottom: height - y + gap, maxHeight };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function statusLabel(context: PageContext | null): string {
  switch (context?.status) {
    case 'parsing':
      return '正在读取文章';
    case 'answering':
      return '正在生成回答';
    case 'partial':
      return '部分内容可用';
    case 'ready':
      return '文章已就绪';
    case 'failed':
      return '页面读取失败';
    default:
      return '正在连接页面';
  }
}

export function FloatingAssistant({ bridge }: FloatingAssistantProps) {
  const [context, setContext] = useState<PageContext | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orbPos, setOrbPos] = useState<OrbPosition>(() =>
    defaultOrbPosition(),
  );
  const [isDragging, setIsDragging] = useState(false);
  const [revealed, setRevealed] = useState<{ id: string; count: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLLIElement>(null);
  const dragState = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const draggedRef = useRef(false);

  useEffect(() => {
    let active = true;
    void bridge
      .initialize()
      .then((nextContext) => {
        if (active) setContext(nextContext);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : '无法读取当前页面');
        }
      });

    const unsubscribe = bridge.subscribe((nextContext) => {
      if (active) setContext(nextContext);
    });
    const openFromPage = () => setIsOpen(true);
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    window.addEventListener(FLOATING_ASSISTANT_OPEN_EVENT, openFromPage);
    window.addEventListener('keydown', closeWithEscape);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener(FLOATING_ASSISTANT_OPEN_EVENT, openFromPage);
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [bridge]);

  useEffect(() => {
    const onResize = () => setOrbPos((pos) => clampOrb(pos));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  const lastMessage = context?.messages.at(-1) ?? null;
  const streamingId =
    lastMessage?.role === 'assistant' ? lastMessage.id : null;
  const streamingContent = lastMessage?.content ?? '';

  useEffect(() => {
    if (!streamingId) return;
    if (prefersReducedMotion()) {
      setRevealed({ id: streamingId, count: streamingContent.length });
      return;
    }

    setRevealed({ id: streamingId, count: 0 });
    let count = 0;
    const timer = window.setInterval(() => {
      count = Math.min(streamingContent.length, count + STREAM_STEP);
      setRevealed({ id: streamingId, count });
      if (count >= streamingContent.length) window.clearInterval(timer);
    }, STREAM_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [streamingId, streamingContent]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [context?.messages, revealed, isOpen]);

  async function sendQuestion() {
    const value = question.trim();
    if (!value || isSending) return;

    setIsSending(true);
    setError(null);
    try {
      setContext(await bridge.ask(value));
      setQuestion('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '问题发送失败');
    } finally {
      setIsSending(false);
    }
  }

  function onOrbPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    dragState.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onOrbPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    state.moved = true;
    setIsDragging(true);
    setOrbPos(
      clampOrb({
        x: event.clientX - state.offsetX,
        y: event.clientY - state.offsetY,
      }),
    );
  }

  function endOrbDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (state.moved) {
      draggedRef.current = true;
      setOrbPos((pos) => snapToEdge(pos));
    }
    setIsDragging(false);
  }

  function onOrbClick() {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setIsOpen(true);
  }

  const isBusy =
    context?.status === 'parsing' ||
    context?.status === 'answering' ||
    isSending;
  const canAsk =
    context?.status === 'ready' || context?.status === 'partial';

  if (!isOpen) {
    return (
      <button
        className={`cr-orb cr-orb--${context?.status ?? 'loading'}${
          isDragging ? ' cr-orb--dragging' : ''
        }`}
        type="button"
        style={{ left: orbPos.x, top: orbPos.y }}
        aria-label="打开 Context Reader"
        aria-controls="context-reader-dialog"
        aria-expanded="false"
        onPointerDown={onOrbPointerDown}
        onPointerMove={onOrbPointerMove}
        onPointerUp={endOrbDrag}
        onPointerCancel={endOrbDrag}
        onClick={onOrbClick}
      >
        {context?.status === 'parsing' ? (
          <LoaderCircle className="cr-spin" size={20} aria-hidden="true" />
        ) : (
          <MessageCircle size={20} strokeWidth={1.8} aria-hidden="true" />
        )}
        <span className="cr-orb__status" aria-hidden="true" />
      </button>
    );
  }

  return (
    <section
      id="context-reader-dialog"
      className="cr-dialog"
      role="dialog"
      aria-label="Context Reader 对话"
      style={dialogStyle(orbPos)}
    >
      <header className="cr-header">
        <div className="cr-header__identity">
          <span className="cr-mark" aria-hidden="true">
            C
          </span>
          <div className="cr-header__copy">
            <strong>Context Reader</strong>
            <span>
              {context?.status === 'ready' && (
                <Check size={11} aria-hidden="true" />
              )}
              {statusLabel(context)}
            </span>
          </div>
        </div>
        <div className="cr-header__actions">
          <button
            className="cr-icon-button"
            type="button"
            aria-label="打开设置"
            onClick={() => void bridge.openSettings()}
          >
            <Settings size={17} aria-hidden="true" />
          </button>
          <button
            className="cr-icon-button"
            type="button"
            aria-label="收起 Context Reader"
            onClick={() => setIsOpen(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {context?.focus?.type === 'text' && (
        <aside className="cr-focus" aria-label="已引用的选中文字">
          <span>已引用</span>
          <p>{context.focus.text}</p>
        </aside>
      )}

      {context?.messages.length ? (
        <ol className="cr-messages" aria-label="当前页面对话">
          {context.messages.map((message) => {
            const isStreaming =
              message.id === streamingId &&
              revealed?.id === message.id &&
              revealed.count < message.content.length;
            const shownText = isStreaming
              ? message.content.slice(0, revealed.count)
              : message.content;
            return (
              <li
                className={`cr-message cr-message--${message.role}`}
                key={message.id}
              >
                <span>{message.role === 'user' ? '你' : '助手'}</span>
                <p aria-busy={isStreaming || undefined}>
                  {shownText}
                  {isStreaming && (
                    <span className="cr-stream-caret" aria-hidden="true" />
                  )}
                </p>
              </li>
            );
          })}
          <li ref={messagesEndRef} className="cr-messages__end" aria-hidden="true" />
        </ol>
      ) : (
        <div className="cr-empty">
          <p>问一个与当前文章有关的问题</p>
          <span>回答会结合已解析的文章内容。</span>
        </div>
      )}

      <div className="cr-feedback" aria-live="polite" aria-atomic="true">
        {error && (
          <p className="cr-error" role="alert">
            {error}
          </p>
        )}
        {!error && context?.warning && (
          <p className="cr-warning">{context.warning}</p>
        )}
      </div>

      <div className="cr-composer">
        <label className="cr-sr-only" htmlFor="context-reader-question">
          向当前文章提问
        </label>
        <textarea
          id="context-reader-question"
          ref={inputRef}
          rows={2}
          value={question}
          placeholder={canAsk ? '输入问题…' : statusLabel(context)}
          disabled={!canAsk || isSending}
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
          className="cr-send"
          type="button"
          aria-label="发送问题"
          disabled={!canAsk || isSending || !question.trim()}
          data-state={error ? 'error' : isSending ? 'loading' : 'default'}
          onClick={() => void sendQuestion()}
        >
          {isBusy ? (
            <LoaderCircle className="cr-spin" size={17} aria-hidden="true" />
          ) : (
            <Send size={16} aria-hidden="true" />
          )}
        </button>
      </div>
    </section>
  );
}

import {
  ArrowUp,
  Image,
  LoaderCircle,
  Scan,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { PageContext } from '../core/types.ts';

export interface ExtensionBridge {
  getActiveContext(): Promise<PageContext>;
  activatePage(): Promise<PageContext>;
  ask(question: string): Promise<PageContext>;
  clearContext(): Promise<PageContext>;
  startImagePicker(): Promise<void>;
  startRegionPicker(): Promise<void>;
  openSettings(): Promise<void>;
  subscribe(listener: (context: PageContext) => void): () => void;
}

export interface SidePanelAppProps {
  bridge: ExtensionBridge;
}

function statusLabel(context: PageContext): string {
  switch (context.status) {
    case 'parsing':
      return '正在读取';
    case 'ready':
      return '上下文已就绪';
    case 'partial':
      return '部分内容可用';
    case 'answering':
      return '正在思考';
    case 'failed':
      return '读取失败';
    default:
      return '尚未读取';
  }
}

function EmptyState({
  busy,
  onActivate,
}: {
  busy: boolean;
  onActivate: () => void;
}) {
  return (
    <section className="empty-state" aria-labelledby="empty-state-title">
      <div className="empty-state__mark" aria-hidden="true">
        <Sparkles size={24} strokeWidth={1.6} />
      </div>
      <p className="eyebrow">当前页面</p>
      <h2 id="empty-state-title">还没有读取这个页面</h2>
      <p>
        启用后会在本次标签页会话中解析正文、代码和图片。页面内容可能发送到你配置的模型 API。
      </p>
      <button
        className="primary-button"
        type="button"
        onClick={onActivate}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
        ) : (
          <Sparkles size={17} aria-hidden="true" />
        )}
        {busy ? '正在读取' : '读取当前页面'}
      </button>
    </section>
  );
}

function FailedState({
  busy,
  onRetry,
}: {
  busy: boolean;
  onRetry: () => void;
}) {
  return (
    <section className="empty-state" aria-labelledby="failed-state-title">
      <div className="empty-state__mark" aria-hidden="true">
        <Scan size={24} strokeWidth={1.6} />
      </div>
      <p className="eyebrow">需要重试</p>
      <h2 id="failed-state-title">页面读取失败</h2>
      <p>页面结构可能还没有加载完成。刷新网页后重新读取，通常可以恢复。</p>
      <button
        className="primary-button"
        type="button"
        onClick={onRetry}
        disabled={busy}
      >
        {busy ? (
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
        ) : (
          <Scan size={17} aria-hidden="true" />
        )}
        {busy ? '正在重试' : '重新读取页面'}
      </button>
    </section>
  );
}

function MessageList({ context }: { context: PageContext }) {
  if (!context.messages.length) {
    return (
      <div className="conversation-empty">
        <p>从一个具体问题开始</p>
        <span>选中文字、选择图片，或者直接询问整篇文章。</span>
      </div>
    );
  }

  return (
    <ol className="message-list" aria-label="当前页面对话">
      {context.messages.map((message) => (
        <li
          className={`message message--${message.role}${
            message.error ? ' message--error' : ''
          }`}
          key={message.id}
        >
          <span className="message__role">
            {message.role === 'user' ? '你' : '助手'}
          </span>
          <p>{message.content}</p>
        </li>
      ))}
    </ol>
  );
}

export function SidePanelApp({ bridge }: SidePanelAppProps) {
  const [context, setContext] = useState<PageContext | null>(null);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    void bridge
      .getActiveContext()
      .then((nextContext) => {
        if (active) setContext(nextContext);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : '无法读取当前页面状态',
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

  async function activatePage() {
    setBusy(true);
    setError(null);
    try {
      setContext(await bridge.activatePage());
      requestAnimationFrame(() => composerRef.current?.focus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '页面读取失败');
    } finally {
      setBusy(false);
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

  async function clearContext() {
    setError(null);
    try {
      setContext(await bridge.clearContext());
      setQuestion('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清除失败');
    }
  }

  if (!context) {
    return (
      <main className="app-shell app-shell--loading" aria-busy="true">
        <LoaderCircle className="spin" size={20} aria-hidden="true" />
        <span>正在连接当前页面</span>
      </main>
    );
  }

  const canAsk =
    context.status === 'ready' ||
    context.status === 'partial' ||
    context.status === 'answering';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          <div>
            <p className="brand-name">Context Reader</p>
            <p className="brand-subtitle">技术阅读助手</p>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="打开设置"
          onClick={() => void bridge.openSettings()}
        >
          <Settings size={18} aria-hidden="true" />
        </button>
      </header>

      <section className="page-strip" aria-labelledby="page-title">
        <div>
          <p className="status-line">
            <span
              className={`status-dot status-dot--${context.status}`}
              aria-hidden="true"
            />
            {statusLabel(context)}
          </p>
          <h1 id="page-title">{context.article?.title || context.title}</h1>
        </div>
        {context.status !== 'unactivated' && (
          <button
            className="icon-button icon-button--quiet"
            type="button"
            aria-label="清除当前页面上下文"
            onClick={() => void clearContext()}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        )}
      </section>

      <div className="notice-region" aria-live="polite" aria-atomic="true">
        {context.warning && <p className="warning">{context.warning}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      {context.status === 'unactivated' ? (
        <EmptyState busy={busy} onActivate={() => void activatePage()} />
      ) : context.status === 'failed' ? (
        <FailedState busy={busy} onRetry={() => void activatePage()} />
      ) : context.status === 'parsing' ? (
        <section className="reading-state" aria-live="polite">
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
          <h2>正在建立文章上下文</h2>
          <p>整理章节、代码块和图片关系。</p>
        </section>
      ) : (
        <>
          <section className="conversation" aria-label="文章问答">
            <MessageList context={context} />
          </section>

          {context.focus && (
            <aside className="focus-card" aria-label="本次问题关联内容">
              <span>
                {context.focus.type === 'text' ? '已选文字' : '已选图片'}
              </span>
              <p>
                {context.focus.type === 'image'
                  ? context.focus.alt || context.focus.text
                  : context.focus.text}
              </p>
            </aside>
          )}

          <section className="composer-panel" aria-label="提问工具">
            <div className="tool-row">
              <button
                className="tool-button"
                type="button"
                aria-label="选择文章图片"
                onClick={() => void bridge.startImagePicker()}
                disabled={!canAsk || busy}
              >
                <Image size={16} aria-hidden="true" />
                图片
              </button>
              <button
                className="tool-button"
                type="button"
                aria-label="框选页面区域"
                onClick={() => void bridge.startRegionPicker()}
                disabled={!canAsk || busy}
              >
                <Scan size={16} aria-hidden="true" />
                框选
              </button>
            </div>

            <div className="composer">
              <label className="sr-only" htmlFor="question">
                向当前文章提问
              </label>
              <textarea
                id="question"
                ref={composerRef}
                value={question}
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
                placeholder="问一个与当前文章有关的问题..."
                rows={3}
                disabled={!canAsk || busy}
              />
              <button
                className="send-button"
                type="button"
                aria-label="发送问题"
                onClick={() => void sendQuestion()}
                disabled={!canAsk || busy || !question.trim()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} aria-hidden="true" />
                ) : (
                  <ArrowUp size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </section>
        </>
      )}
    </main>
  );
}

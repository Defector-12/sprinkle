import {
  Check,
  LoaderCircle,
  MessageCircle,
  Send,
  Settings,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLLIElement>(null);

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
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [context?.messages, isOpen]);

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

  const isBusy =
    context?.status === 'parsing' ||
    context?.status === 'answering' ||
    isSending;
  const canAsk =
    context?.status === 'ready' || context?.status === 'partial';

  if (!isOpen) {
    return (
      <button
        className={`cr-orb cr-orb--${context?.status ?? 'loading'}`}
        type="button"
        aria-label="打开 Context Reader"
        aria-controls="context-reader-dialog"
        aria-expanded="false"
        onClick={() => setIsOpen(true)}
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
          {context.messages.map((message) => (
            <li
              className={`cr-message cr-message--${message.role}`}
              key={message.id}
            >
              <span>{message.role === 'user' ? '你' : '助手'}</span>
              <p>{message.content}</p>
            </li>
          ))}
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

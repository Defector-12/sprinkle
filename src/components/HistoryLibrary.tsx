import {
  ArrowRight,
  ExternalLink,
  LibraryBig,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type {
  ArchivedConversation,
  ConversationArchiveUsage,
  ConversationSummary,
} from '../core/types.ts';
import type { HistoryLibraryBridgeContract } from '../runtime/history-bridge.ts';
import {
  AssistantMarkdown,
  messageAuthor,
  MessageReferenceCard,
} from './MessageContent.tsx';

export interface HistoryLibraryProps {
  bridge: HistoryLibraryBridgeContract;
}

const WARNING_RATIO = 0.8;
const DEFAULT_INDEX_WIDTH = 340;
const MIN_INDEX_WIDTH = 260;
const MAX_INDEX_WIDTH = 560;
const MIN_DETAIL_WIDTH = 420;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function HistoryLibrary({ bridge }: HistoryLibraryProps) {
  const [query, setQuery] = useState('');
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [conversation, setConversation] =
    useState<ArchivedConversation | null>(null);
  const [usage, setUsage] = useState<ConversationArchiveUsage | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [indexCollapsed, setIndexCollapsed] = useState(false);
  const [indexWidth, setIndexWidth] = useState(DEFAULT_INDEX_WIDTH);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const layoutRef = useRef<HTMLElement>(null);
  const dividerDragging = useRef(false);

  useEffect(
    () => bridge.subscribe(() => setRevision((value) => value + 1)),
    [bridge],
  );

  useEffect(() => {
    let active = true;
    setLoadingList(true);
    setError('');
    void Promise.all([bridge.list(query), bridge.usage()])
      .then(([nextSummaries, nextUsage]) => {
        if (!active) return;
        setSummaries(nextSummaries);
        setUsage(nextUsage);
        setSelectedUrl((current) =>
          current &&
          nextSummaries.some((item) => item.normalizedUrl === current)
            ? current
            : nextSummaries[0]?.normalizedUrl ?? null,
        );
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : '无法读取学习记录',
          );
        }
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });
    return () => {
      active = false;
    };
  }, [bridge, query, revision]);

  useEffect(() => {
    let active = true;
    setConfirmDelete(false);
    if (!selectedUrl) {
      setConversation(null);
      return () => {
        active = false;
      };
    }
    setLoadingConversation(true);
    void bridge
      .get(selectedUrl)
      .then((record) => {
        if (active) setConversation(record);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : '无法读取这条记录',
          );
        }
      })
      .finally(() => {
        if (active) setLoadingConversation(false);
      });
    return () => {
      active = false;
    };
  }, [bridge, selectedUrl, revision]);

  async function deleteSelected() {
    if (!selectedUrl) return;
    setError('');
    try {
      await bridge.delete(selectedUrl);
      setConversation(null);
      setSelectedUrl(null);
      setConfirmDelete(false);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试');
    }
  }

  async function clearAll() {
    setError('');
    try {
      await bridge.clear();
      setConversation(null);
      setSelectedUrl(null);
      setConfirmClear(false);
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清除失败，请重试');
    }
  }

  async function continueSelected() {
    if (!selectedUrl || continuing) return;
    setContinuing(true);
    setError('');
    try {
      await bridge.continue(selectedUrl);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '无法继续这段对话',
      );
    } finally {
      setContinuing(false);
    }
  }

  const usageRatio =
    usage && usage.quotaBytes > 0 ? usage.bytesInUse / usage.quotaBytes : 0;
  const layoutStyle = {
    '--library-index-width': `${indexWidth}px`,
  } as CSSProperties;

  function indexWidthLimit(): number {
    const measuredWidth =
      layoutRef.current?.getBoundingClientRect().width ?? 0;
    const layoutWidth =
      measuredWidth >= MIN_INDEX_WIDTH + MIN_DETAIL_WIDTH
        ? measuredWidth
        : window.innerWidth;
    return Math.max(
      MIN_INDEX_WIDTH,
      Math.min(MAX_INDEX_WIDTH, layoutWidth - MIN_DETAIL_WIDTH),
    );
  }

  function resizeIndex(clientX: number) {
    const left = layoutRef.current?.getBoundingClientRect().left ?? 0;
    setIndexWidth(
      clamp(clientX - left, MIN_INDEX_WIDTH, indexWidthLimit()),
    );
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    dividerDragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (dividerDragging.current) resizeIndex(event.clientX);
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dividerDragging.current) return;
    dividerDragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const maximum = indexWidthLimit();
    setIndexWidth((current) => {
      if (event.key === 'Home') return MIN_INDEX_WIDTH;
      if (event.key === 'End') return maximum;
      return clamp(
        current + (event.key === 'ArrowLeft' ? -24 : 24),
        MIN_INDEX_WIDTH,
        maximum,
      );
    });
  }

  return (
    <main className="library-shell">
      <header className="library-header">
        <div className="library-brand">
          <span className="library-brand__mark" aria-hidden="true">
            <LibraryBig size={20} />
          </span>
          <div>
            <p>Context Reader</p>
            <h1>学习记录</h1>
          </div>
        </div>
        <div className="library-header__actions">
          {indexCollapsed && (
            <button
              type="button"
              className="library-icon-button"
              aria-label="展开网址列表"
              title="展开网址列表"
              aria-pressed="true"
              onClick={() => setIndexCollapsed(false)}
            >
              <PanelLeftOpen size={18} aria-hidden="true" />
            </button>
          )}
          {usage && (
            <span
              className={usageRatio >= WARNING_RATIO ? 'usage usage--warning' : 'usage'}
              title={`${formatMegabytes(usage.bytesInUse)} / ${formatMegabytes(
                usage.quotaBytes,
              )}`}
            >
              {formatMegabytes(usage.bytesInUse)}
            </span>
          )}
          <button
            type="button"
            className="library-icon-button"
            aria-label="打开设置"
            title="打开设置"
            onClick={() => void bridge.openSettings()}
          >
            <Settings size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="library-icon-button library-icon-button--danger"
            aria-label="清除全部学习记录"
            title="清除全部学习记录"
            disabled={!summaries.length}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {usageRatio >= WARNING_RATIO && (
        <p className="library-storage-warning" role="status">
          本地存储空间即将用满，请删除不再需要的记录。
        </p>
      )}
      {error && (
        <p className="library-error" role="alert">
          {error}
        </p>
      )}

      <section
        ref={layoutRef}
        className={`library-layout${
          indexCollapsed ? ' library-layout--index-collapsed' : ''
        }`}
        style={layoutStyle}
      >
        {!indexCollapsed && (
          <aside className="library-index" aria-label="学习记录列表">
            <div className="library-index__controls">
              <label className="library-search">
                <Search size={17} aria-hidden="true" />
                <span className="sr-only">搜索学习记录</span>
                <input
                  type="search"
                  value={query}
                  placeholder="搜索标题、网址或问答"
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="清除搜索"
                    onClick={() => setQuery('')}
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                )}
              </label>
              <button
                type="button"
                className="library-icon-button"
                aria-label="隐藏网址列表"
                title="隐藏网址列表"
                aria-pressed="false"
                onClick={() => setIndexCollapsed(true)}
              >
                <PanelLeftClose size={18} aria-hidden="true" />
              </button>
            </div>

            {loadingList ? (
              <div className="library-list-state" aria-live="polite">
                <LoaderCircle className="spin" size={20} aria-hidden="true" />
                正在读取
              </div>
            ) : summaries.length ? (
              <ol className="library-list">
                {summaries.map((summary) => (
                  <li key={summary.normalizedUrl}>
                    <button
                      type="button"
                      aria-current={
                        selectedUrl === summary.normalizedUrl
                          ? 'page'
                          : undefined
                      }
                      onClick={() => setSelectedUrl(summary.normalizedUrl)}
                    >
                      <strong>{summary.title}</strong>
                      <span>{hostname(summary.normalizedUrl)}</span>
                      <p>{summary.lastQuestion}</p>
                      <small>
                        {summary.questionCount} 个问题 ·{' '}
                        {formatDate(summary.updatedAt)}
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="library-list-state">
                <LibraryBig size={22} aria-hidden="true" />
                <strong>
                  {query ? '没有匹配记录' : '还没有学习记录'}
                </strong>
              </div>
            )}
          </aside>
        )}

        {!indexCollapsed && (
          <div
            className="library-divider"
            role="separator"
            aria-label="调整网址列表宽度"
            aria-orientation="vertical"
            aria-valuemin={MIN_INDEX_WIDTH}
            aria-valuemax={MAX_INDEX_WIDTH}
            aria-valuenow={indexWidth}
            tabIndex={0}
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={resizeWithKeyboard}
          >
            <span aria-hidden="true" />
          </div>
        )}

        <article className="library-detail" aria-live="polite">
          {loadingConversation ? (
            <div className="library-detail-state">
              <LoaderCircle className="spin" size={22} aria-hidden="true" />
              正在读取对话
            </div>
          ) : conversation ? (
            <>
              <header className="library-detail__header">
                <div>
                  <p>{hostname(conversation.normalizedUrl)}</p>
                  <h2>{conversation.title}</h2>
                  <a
                    href={conversation.normalizedUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {conversation.normalizedUrl}
                    <ExternalLink size={13} aria-hidden="true" />
                  </a>
                </div>
                <div className="library-detail__actions">
                  <button
                    type="button"
                    className="library-continue"
                    disabled={continuing}
                    onClick={() => void continueSelected()}
                  >
                    {continuing ? (
                      <LoaderCircle
                        className="spin"
                        size={17}
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowRight size={17} aria-hidden="true" />
                    )}
                    继续提问
                  </button>
                  <button
                    type="button"
                    className="library-icon-button library-icon-button--danger"
                    aria-label="删除当前学习记录"
                    title="删除当前学习记录"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              </header>

              <ol className="library-messages" aria-label="历史问答">
                {conversation.messages.map((message) => (
                  <li
                    key={message.id}
                    className={`library-message library-message--${message.role}`}
                  >
                    <span>{messageAuthor(message)}</span>
                    <MessageReferenceCard reference={message.reference} />
                    {message.role === 'assistant' ? (
                      <AssistantMarkdown content={message.content} />
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <div className="library-detail-state">
              <LibraryBig size={24} aria-hidden="true" />
              <strong>选择一条学习记录</strong>
            </div>
          )}
        </article>
      </section>

      {(confirmDelete || confirmClear) && (
        <div className="library-confirm" role="dialog" aria-modal="true">
          <div>
            <h2>{confirmClear ? '清除全部学习记录？' : '删除这条学习记录？'}</h2>
            <p>删除后无法从插件中恢复。</p>
            <footer>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setConfirmClear(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="library-confirm__danger"
                onClick={() =>
                  void (confirmClear ? clearAll() : deleteSelected())
                }
              >
                确认删除
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}

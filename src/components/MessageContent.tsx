import {
  Bug,
  Check,
  ClipboardCopy,
  Image as ImageIcon,
  Quote,
} from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type {
  ChatMessage,
  MessageReference,
  QuestionTrace,
  QuestionTraceEvidence,
} from '../core/types.ts';
import { normalizeAssistantMarkdown } from './assistant-markdown.ts';

export function messageAuthor(message: ChatMessage): string {
  if (message.role === 'user') return '你';
  if (message.answeredBy === 'deepseek') return 'DeepSeek';
  if (message.answeredBy === 'doubao') return 'Doubao';
  return '助手';
}

export function AssistantMarkdown({
  content,
  busy = false,
  caretClassName,
}: {
  content: string;
  busy?: boolean;
  caretClassName?: string;
}) {
  return (
    <div className="message-markdown" aria-busy={busy || undefined}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          img: ({ node: _node, alt }) =>
            alt ? (
              <span className="message-markdown__image-alt">{alt}</span>
            ) : null,
          table: ({ node: _node, ...props }) => (
            <div className="message-markdown__table">
              <table {...props} />
            </div>
          ),
        }}
      >
        {normalizeAssistantMarkdown(content)}
      </ReactMarkdown>
      {busy && caretClassName && (
        <span className={caretClassName} aria-hidden="true" />
      )}
    </div>
  );
}

export function MessageReferenceCard({
  reference,
}: {
  reference?: MessageReference;
}) {
  if (!reference) return null;

  const isText = reference.type === 'text';
  const label = isText
    ? '引用文字'
    : reference.type === 'region'
      ? '框选区域'
      : '引用图片';
  const description = isText
    ? reference.text
    : reference.type === 'image'
      ? reference.alt || reference.text || label
      : reference.text || label;

  return (
    <aside className="message-reference" role="note" aria-label="提问引用">
      <div className="message-reference__media" aria-hidden="true">
        {!isText && reference.imageUrl ? (
          <img src={reference.imageUrl} alt="" />
        ) : isText ? (
          <Quote size={15} />
        ) : (
          <ImageIcon size={16} />
        )}
      </div>
      <div className="message-reference__copy">
        <span>{label}</span>
        <strong>{reference.section}</strong>
        <p title={description}>{description}</p>
      </div>
    </aside>
  );
}

function traceStatusLabel(status: QuestionTrace['status']): string {
  switch (status) {
    case 'preparing':
      return '准备上下文';
    case 'requesting':
      return '模型请求中';
    case 'completed':
      return '回答完成';
    case 'failed':
      return '回答失败';
    case 'interrupted':
      return '回答中断';
  }
}

function plannerOutcomeLabel(
  outcome: QuestionTrace['planner']['outcome'],
): string {
  switch (outcome) {
    case 'pending':
      return '运行中';
    case 'skipped':
      return '未运行';
    case 'completed':
      return '已完成';
    case 'unavailable':
      return '回退';
  }
}

function checkpointOutcomeLabel(
  outcome: NonNullable<
    QuestionTrace['memory']
  >['checkpointOutcome'],
): string {
  switch (outcome) {
    case 'not-needed':
      return '无需检查点';
    case 'reused':
      return '复用检查点';
    case 'created':
      return '已更新检查点';
    case 'unavailable':
      return '生成失败，已回退';
  }
}

function retrievalStrategyLabel(
  strategy: QuestionTrace['retrieval']['strategy'],
): string {
  switch (strategy) {
    case 'full-context':
      return '预算内全文';
    case 'fused-retrieval':
      return '多路融合召回';
    case 'whole-article':
      return '全文';
    case 'section-reference':
      return '完整章节引用';
    case 'focused-reference':
      return '引用锚点';
    case 'bm25':
      return '全文关键词召回';
  }
}

function evidenceChanged(trace: QuestionTrace): boolean {
  return (
    trace.retrieval.initialEvidence.map((item) => item.id).join('\n') !==
    trace.retrieval.finalEvidence.map((item) => item.id).join('\n')
  );
}

function EvidenceList({
  title,
  evidence,
}: {
  title: string;
  evidence: QuestionTraceEvidence[];
}) {
  return (
    <section className="question-trace__section">
      <h4>
        {title}
        <span>{evidence.length} 个窗口</span>
      </h4>
      {evidence.length ? (
        <ol className="question-trace__evidence">
          {evidence.map((item, index) => (
            <li key={`${item.id}-${index}`}>
              <details>
                <summary>
                  <strong>{item.section}</strong>
                  <span>{item.characterCount} 字</span>
                </summary>
                {item.reasons?.length ? (
                  <p>{item.reasons.join('；')}</p>
                ) : null}
                <pre>{item.text}</pre>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p>没有选中可发送的文章证据。</p>
      )}
    </section>
  );
}

export function QuestionTraceDetails({
  trace,
}: {
  trace?: QuestionTrace;
}) {
  const [copyState, setCopyState] = useState<
    'idle' | 'copied' | 'failed'
  >('idle');
  if (!trace) return null;

  const copyTrace = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <details className="question-trace">
      <summary>
        <Bug size={14} aria-hidden="true" />
        <span>回答诊断</span>
        <small>{traceStatusLabel(trace.status)}</small>
      </summary>
      <div className="question-trace__body">
        <header>
          <div>
            <strong>本次问答链路</strong>
            <span>
              {trace.pipelineVersion} · 扩展 {trace.extensionVersion}
            </span>
          </div>
          <button
            type="button"
            title="复制回答诊断 JSON"
            onClick={() => void copyTrace()}
          >
            {copyState === 'copied' ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <ClipboardCopy size={14} aria-hidden="true" />
            )}
            {copyState === 'copied'
              ? '已复制'
              : copyState === 'failed'
                ? '复制失败'
                : '复制诊断'}
          </button>
        </header>

        <section className="question-trace__section">
          <h4>原始输入</h4>
          <p>{trace.question}</p>
          {trace.focus.text && (
            <p>
              <strong>引用：</strong>
              {trace.focus.text}
            </p>
          )}
          {trace.focus.section && (
            <p>
              <strong>引用章节：</strong>
              {trace.focus.section}
            </p>
          )}
        </section>

        <dl className="question-trace__metrics">
          <div>
            <dt>页面提取</dt>
            <dd>
              {trace.article.readableCharacters} 字 ·{' '}
              {trace.article.blockCount} 块
            </dd>
          </div>
          <div>
            <dt>检索策略</dt>
            <dd>{retrievalStrategyLabel(trace.retrieval.strategy)}</dd>
          </div>
          <div>
            <dt>引用状态</dt>
            <dd>
              {trace.focus.type === 'none'
                ? '无引用'
                : `${trace.focus.type} · ${trace.focus.selectedCharacters} 字`}
            </dd>
          </div>
          <div>
            <dt>查询规划</dt>
            <dd>{plannerOutcomeLabel(trace.planner.outcome)}</dd>
          </div>
          <div>
            <dt>最终证据</dt>
            <dd>{trace.retrieval.finalEvidence.length} 个窗口</dd>
          </div>
          <div>
            <dt>模型请求</dt>
            <dd>
              {trace.request
                ? `${trace.request.textCharacters} 字 · ${trace.request.messageCount} 条消息`
                : '尚未生成'}
            </dd>
          </div>
          {trace.retrieval.budget && (
            <div>
              <dt>上下文预算</dt>
              <dd>
                {trace.retrieval.budget.articleCharacters} 文章 +{' '}
                {trace.retrieval.budget.historyCharacters} 对话 +{' '}
                {trace.retrieval.budget.checkpointCharacters ?? 0} 检查点 /{' '}
                {trace.retrieval.budget.limit} 字
              </dd>
            </div>
          )}
          {trace.memory && (
            <div>
              <dt>会话记忆</dt>
              <dd>{checkpointOutcomeLabel(trace.memory.checkpointOutcome)}</dd>
            </div>
          )}
        </dl>

        {trace.memory && (
          <section className="question-trace__section">
            <h4>会话记忆</h4>
            <p>{checkpointOutcomeLabel(trace.memory.checkpointOutcome)}</p>
            <p>
              检查点覆盖 {trace.memory.compactedTurnCount} 轮 · 最近原文{' '}
              {trace.memory.recentTurnCount} 轮 · 相关旧问答{' '}
              {trace.memory.recalledTurnCount} 轮
            </p>
            {trace.memory.error && (
              <p>
                <strong>失败信息：</strong>
                {trace.memory.error}
              </p>
            )}
          </section>
        )}

        <section className="question-trace__section">
          <h4>查询规划</h4>
          <p>{trace.planner.reason}</p>
          {trace.planner.rewrittenQuestion && (
            <p>
              <strong>改写问题：</strong>
              {trace.planner.rewrittenQuestion}
            </p>
          )}
          {trace.planner.queries?.length ? (
            <ol>
              {trace.planner.queries.map((query) => (
                <li key={query}>{query}</li>
              ))}
            </ol>
          ) : null}
          {trace.planner.error && (
            <p>
              <strong>失败信息：</strong>
              {trace.planner.error}
            </p>
          )}
          {trace.planner.rawResponse && (
            <details>
              <summary>
                <strong>查看查询规划原始响应</strong>
                <span>{trace.planner.rawResponse.length} 字</span>
              </summary>
              <pre>{trace.planner.rawResponse}</pre>
            </details>
          )}
          {trace.planner.request && (
            <details>
              <summary>
                <strong>查看查询规划请求</strong>
                <span>{trace.planner.request.textCharacters} 字</span>
              </summary>
              <pre>
                {trace.planner.request.messages
                  .map(
                    (message) =>
                      `[${message.role}]\n${message.content}`,
                  )
                  .join('\n\n')}
              </pre>
            </details>
          )}
        </section>

        {evidenceChanged(trace) && (
          <EvidenceList
            title="初始召回"
            evidence={trace.retrieval.initialEvidence}
          />
        )}
        <EvidenceList
          title="最终发送证据"
          evidence={trace.retrieval.finalEvidence}
        />

        {trace.request && (
          <section className="question-trace__section">
            <h4>
              实际模型请求
              <span>{trace.request.model}</span>
            </h4>
            <ol className="question-trace__request">
              {trace.request.messages.map((message, index) => (
                <li key={`${message.role}-${index}`}>
                  <details>
                    <summary>
                      <strong>{message.role}</strong>
                      <span>{message.content.length} 字</span>
                    </summary>
                    <pre>{message.content}</pre>
                  </details>
                </li>
              ))}
            </ol>
          </section>
        )}

        {trace.response && (
          <section className="question-trace__section">
            <h4>模型结果</h4>
            <p>
              {trace.response.outcome === 'completed'
                ? `已返回 ${trace.response.characterCount ?? 0} 字`
                : trace.response.error || '模型请求没有完成。'}
            </p>
          </section>
        )}

        <p className="question-trace__privacy">
          诊断仅保存在当前标签页会话中，关闭标签页后删除，不进入学习记录。
        </p>
      </div>
    </details>
  );
}

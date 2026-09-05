import {
  ArrowLeft,
  CircleAlert,
  Info,
  type LucideIcon,
} from 'lucide-react';

import type { AssistantProblem } from '../application/assistant-problems.ts';

export interface ProblemDetailsPanelProps {
  problem: AssistantProblem;
  onBack: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function ProblemDetailsPanel({
  problem,
  onBack,
  action,
}: ProblemDetailsPanelProps) {
  const ProblemIcon: LucideIcon =
    problem.severity === 'error' ? CircleAlert : Info;

  return (
    <section
      className={`cr-diagnostics cr-problem-details cr-problem-details--${problem.severity}`}
      aria-label="问题详情"
    >
      <button className="cr-page-back" type="button" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" />
        返回对话
      </button>

      <div className="cr-diagnostics__heading">
        <ProblemIcon size={19} aria-hidden="true" />
        <div>
          <h2>{problem.title}</h2>
          <p>{problem.summary}</p>
        </div>
      </div>

      <dl className="cr-diagnostics__metrics">
        <div>
          <dt>问题级别</dt>
          <dd>{problem.severity === 'error' ? '错误' : '提示'}</dd>
        </div>
        <div>
          <dt>发生环节</dt>
          <dd>{problem.operation}</dd>
        </div>
        <div>
          <dt>发生时间</dt>
          <dd>{new Date(problem.occurredAt).toLocaleString('zh-CN')}</dd>
        </div>
      </dl>

      <div className="cr-diagnostics__detail">
        <h3>原始信息</h3>
        <p className="cr-problem-details__message">
          {problem.detail || problem.summary}
        </p>
        <h3>影响</h3>
        <p>{problem.impact}</p>
        {problem.pageUrl && (
          <>
            <h3>相关页面</h3>
            <p className="cr-problem-details__url">{problem.pageUrl}</p>
          </>
        )}
        <h3>建议操作</h3>
        <ol>
          {problem.suggestions.map((suggestion) => (
            <li key={suggestion}>{suggestion}</li>
          ))}
        </ol>
      </div>

      {action && (
        <button
          className="cr-diagnostics__retry"
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </section>
  );
}

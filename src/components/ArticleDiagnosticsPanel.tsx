import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  FileSearch,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';

import type {
  ArticleDiagnostics,
  ArticleDocument,
} from '../core/types.ts';

interface DiagnosticIssue {
  id: string;
  title: string;
  summary: string;
  evidence: string;
  suggestions: string[];
}

export interface ArticleDiagnosticsPanelProps {
  article: ArticleDocument;
  onBack: () => void;
  onRetry: () => void;
}

function fallbackDiagnostics(article: ArticleDocument): ArticleDiagnostics {
  const readableLength = article.blocks.reduce(
    (total, block) => total + block.text.length,
    0,
  );
  return {
    rootKind: 'body',
    readableLength,
    minimumReadableLength: 80,
    rootTextLength: readableLength,
    candidateBlockCount: article.blocks.length,
    acceptedBlockCount: article.blocks.length,
    excludedBlockCount: 0,
    emptyBlockCount: 0,
    articleCandidateCount: 0,
    mainCandidateCount: 0,
    roleMainCandidateCount: 0,
    iframeCount: 0,
    canvasCount: 0,
    tableCount: 0,
    shadowRootCount: 0,
    loadingIndicatorCount: 0,
    fallbackUsed: false,
    fallbackBlockCount: 0,
  };
}

function rootLabel(rootKind: ArticleDiagnostics['rootKind']): string {
  switch (rootKind) {
    case 'article':
      return '<article>';
    case 'main':
      return '<main>';
    case 'role-main':
      return '[role="main"]';
    case 'body':
      return '<body> 回退';
  }
}

export function buildDiagnosticIssues(
  diagnostics: ArticleDiagnostics,
): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  if (diagnostics.readableLength < diagnostics.minimumReadableLength) {
    issues.push({
      id: 'low-readable-text',
      title: '可读文字不足',
      summary: `${diagnostics.readableLength} 字，低于 ${diagnostics.minimumReadableLength} 字阈值`,
      evidence: `当前只提取到 ${diagnostics.readableLength} 个字符，完整读取阈值是 ${diagnostics.minimumReadableLength} 个字符。这是页面被标记为“部分内容”的直接原因。`,
      suggestions: [
        '确认页面正文已经加载完成，再点击工具栏图标重新理解。',
        '检查正文是否主要由自定义 div、表格、Canvas 或嵌入页面承载。',
      ],
    });
  }

  if (diagnostics.rootKind === 'body') {
    issues.push({
      id: 'body-fallback',
      title: '没有识别到正文容器',
      summary: '已回退到整个 <body> 查找内容',
      evidence:
        '页面中没有找到 <article>、<main> 或 [role="main"]。提取器只能从整个页面中筛选正文节点，准确率会降低。',
      suggestions: [
        '确认页面正文是否使用标准 article 或 main 语义结构。',
        '如果这是固定站点，可以为该站点增加专用正文选择器。',
      ],
    });
  }

  if (diagnostics.articleCandidateCount > 1) {
    issues.push({
      id: 'multiple-articles',
      title: '页面包含多个文章容器',
      summary: `检测到 ${diagnostics.articleCandidateCount} 个 <article>`,
      evidence:
        '当前提取器按优先级选择第一个 <article>。它可能是摘要、推荐卡片或评论，而不是真正正文。',
      suggestions: [
        '检查页面最前面的 <article> 是否确实是正文。',
        '后续可改为比较候选容器的正文长度和标题结构后再选择。',
      ],
    });
  }

  const unsupportedCount =
    diagnostics.iframeCount +
    diagnostics.canvasCount +
    diagnostics.tableCount +
    diagnostics.shadowRootCount;
  if (unsupportedCount > 0) {
    issues.push({
      id: 'unsupported-structure',
      title: '存在暂未读取的内容结构',
      summary: `iframe ${diagnostics.iframeCount} · Canvas ${diagnostics.canvasCount} · 表格 ${diagnostics.tableCount} · Shadow DOM ${diagnostics.shadowRootCount}`,
      evidence:
        '当前正文白名单主要读取标题、段落、列表、引用和代码块。嵌入页面、Canvas、复杂表格和 Shadow DOM 不会被完整展开。',
      suggestions: [
        '确认关键正文是否位于这些结构中。',
        '对固定站点增加结构适配，或在未来版本中加入专用提取器。',
      ],
    });
  }

  if (diagnostics.loadingIndicatorCount > 0) {
    issues.push({
      id: 'dynamic-loading',
      title: '页面可能仍在加载',
      summary: `检测到 ${diagnostics.loadingIndicatorCount} 个加载态信号`,
      evidence:
        '启用插件时页面仍存在 aria-busy、data-loading、loading 或 skeleton 标记，正文可能尚未进入 DOM。',
      suggestions: [
        '等待页面加载或滚动完成后，点击“重新理解页面”。',
        '对于无限滚动页面，先滚动到需要阅读的内容区域。',
      ],
    });
  }

  if (diagnostics.excludedBlockCount > 0) {
    issues.push({
      id: 'excluded-blocks',
      title: '部分候选内容被过滤',
      summary: `${diagnostics.excludedBlockCount} 个候选块被排除`,
      evidence:
        '位于 nav、footer、aside、form、导航角色或 aria-hidden 区域中的节点会被过滤，以避免菜单和辅助内容污染正文。',
      suggestions: [
        '检查正文是否错误地放在 aside 或 aria-hidden 容器中。',
        '如果站点结构特殊，可以调整该站点的过滤规则。',
      ],
    });
  }

  const uncapturedText = Math.max(
    0,
    diagnostics.rootTextLength - diagnostics.readableLength,
  );
  if (
    !diagnostics.fallbackUsed &&
    uncapturedText >= 120 &&
    uncapturedText > diagnostics.readableLength * 1.5
  ) {
    issues.push({
      id: 'unmatched-markup',
      title: '正文可能使用非标准标签',
      summary: `容器内约有 ${uncapturedText} 个字符未进入正文块`,
      evidence:
        '根容器包含较多文字，但标题、段落、列表、引用和代码块白名单只捕获到其中一小部分。正文可能主要使用 div、span 或自定义组件。',
      suggestions: [
        '在开发者工具中检查正文文本实际使用的标签。',
        '为常见自定义正文结构增加选择器，同时避免把导航内容纳入。',
      ],
    });
  }

  return issues;
}

export function ArticleDiagnosticsPanel({
  article,
  onBack,
  onRetry,
}: ArticleDiagnosticsPanelProps) {
  const diagnostics = article.diagnostics ?? fallbackDiagnostics(article);
  const issues = buildDiagnosticIssues(diagnostics);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const selectedIssue =
    issues.find((issue) => issue.id === selectedIssueId) ?? null;

  if (selectedIssue) {
    return (
      <section className="cr-diagnostics" aria-label="诊断详情">
        <button
          className="cr-page-back"
          type="button"
          onClick={() => setSelectedIssueId(null)}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          返回诊断概览
        </button>
        <div className="cr-diagnostics__heading">
          <CircleAlert size={19} aria-hidden="true" />
          <div>
            <h2>{selectedIssue.title}</h2>
            <p>{selectedIssue.summary}</p>
          </div>
        </div>
        <div className="cr-diagnostics__detail">
          <h3>检测依据</h3>
          <p>{selectedIssue.evidence}</p>
          <h3>建议操作</h3>
          <ol>
            {selectedIssue.suggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ol>
        </div>
      </section>
    );
  }

  return (
    <section className="cr-diagnostics" aria-label="读取诊断">
      <button className="cr-page-back" type="button" onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" />
        返回对话
      </button>
      <div className="cr-diagnostics__heading">
        <FileSearch size={19} aria-hidden="true" />
        <div>
          <h2>读取诊断</h2>
          <p>以下数据仅描述页面结构，不包含额外正文。</p>
        </div>
      </div>

      <dl className="cr-diagnostics__metrics">
        <div>
          <dt>可读文字</dt>
          <dd>
            {diagnostics.readableLength} 字 / {diagnostics.minimumReadableLength}{' '}
            字
          </dd>
        </div>
        <div>
          <dt>正文入口</dt>
          <dd>{rootLabel(diagnostics.rootKind)}</dd>
        </div>
        <div>
          <dt>内容块</dt>
          <dd>
            {diagnostics.acceptedBlockCount} /{' '}
            {diagnostics.candidateBlockCount}
          </dd>
        </div>
        {diagnostics.fallbackUsed && (
          <div>
            <dt>回退提取</dt>
            <dd>已恢复 {diagnostics.fallbackBlockCount} 个文本块</dd>
          </div>
        )}
      </dl>

      <div className="cr-diagnostics__issues">
        <h3>可能原因</h3>
        {issues.map((issue) => (
          <button
            key={issue.id}
            type="button"
            onClick={() => setSelectedIssueId(issue.id)}
          >
            <span>
              <strong>{issue.title}</strong>
              <small>{issue.summary}</small>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>

      <button className="cr-diagnostics__retry" type="button" onClick={onRetry}>
        <RefreshCw size={15} aria-hidden="true" />
        重新理解页面
      </button>
    </section>
  );
}

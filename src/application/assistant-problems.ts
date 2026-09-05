import type { PageContext } from '../core/types.ts';

export interface AssistantProblem {
  severity: 'error' | 'warning';
  title: string;
  summary: string;
  detail?: string;
  operation: string;
  impact: string;
  pageUrl?: string;
  occurredAt: number;
  suggestions: string[];
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim()
    ? cause.message
    : fallback;
}

export function runtimeProblem(
  title: string,
  operation: string,
  cause: unknown,
  fallback: string,
  impact: string,
  pageUrl?: string,
): AssistantProblem {
  return {
    severity: 'error',
    title,
    summary: errorMessage(cause, fallback),
    operation,
    impact,
    pageUrl,
    occurredAt: Date.now(),
    suggestions: [
      '确认当前页面和网络状态正常后重试。',
      '如果问题持续出现，请记录这里的原始信息和发生环节。',
    ],
  };
}

export function failedReadingProblem(
  context: PageContext,
): AssistantProblem {
  return {
    severity: 'error',
    title: '页面理解失败',
    summary: context.warning || '当前页面暂时无法读取。',
    detail: context.warningDetail || context.warning || undefined,
    operation: '读取网页内容',
    impact: '正文没有成功进入提问上下文，当前无法基于页面内容回答。',
    pageUrl: context.url,
    occurredAt: context.updatedAt,
    suggestions: [
      '确认页面已加载完成，然后重新理解页面。',
      '若重复失败，请保留此页的原始信息用于定位具体异常。',
    ],
  };
}

export function apiKeyProblem(context: PageContext): AssistantProblem {
  return {
    severity: 'warning',
    title: '尚未配置 API Key',
    summary: '没有检测到可用的 DeepSeek API Key。',
    operation: '检查模型配置',
    impact: '页面内容已经读取，但在配置完成前无法发送问题。',
    pageUrl: context.url,
    occurredAt: Date.now(),
    suggestions: [
      '打开设置并填写有效的 DeepSeek API Key。',
      '保存后回到当前页面即可继续提问，无需重新读取正文。',
    ],
  };
}

export function contextWarningProblem(
  context: PageContext,
): AssistantProblem {
  const archiveFailure = context.warning?.includes('归档失败');
  return {
    severity: 'warning',
    title: archiveFailure ? '本地对话归档失败' : '页面提示',
    summary: context.warning || '当前操作存在需要注意的信息。',
    detail: context.warningDetail || undefined,
    operation: archiveFailure ? '保存本地对话' : '处理当前页面',
    impact: archiveFailure
      ? '本次回答仍可查看，但刷新或关闭页面后可能不会出现在学习记录中。'
      : '当前功能可能受限，请根据原始信息确认影响范围。',
    pageUrl: context.url,
    occurredAt: context.updatedAt,
    suggestions: archiveFailure
      ? [
          '检查浏览器扩展的本地存储空间后重试。',
          '在问题解决前不要关闭当前页面，以免丢失尚未归档的对话。',
        ]
      : [
          '根据原始信息检查当前页面状态。',
          '重新执行刚才的操作，确认问题是否仍然存在。',
        ],
  };
}

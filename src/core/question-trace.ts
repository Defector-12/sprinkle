import type {
  AssembledEvidence,
  ContextAssembly,
} from './context-assembler.ts';
import type {
  ArticleDocument,
  FocusContext,
  ModelContentPart,
  ModelRequest,
  QuestionTrace,
  QuestionTraceEvidence,
  QuestionTraceRequest,
} from './types.ts';

export const QUESTION_TRACE_PIPELINE_VERSION = 'context-assembler-v2';

export interface CreateQuestionTraceInput {
  article: ArticleDocument;
  sourceChunkCount: number;
  question: string;
  focus: FocusContext | null;
  assembly: ContextAssembly;
  extensionVersion: string;
  memory?: QuestionTrace['memory'];
}

function traceEvidence(evidence: AssembledEvidence[]): QuestionTraceEvidence[] {
  return evidence.map((item) => ({
    id: item.chunk.id,
    section: item.chunk.section,
    text: item.chunk.text,
    characterCount: item.chunk.text.length,
    blockIds: item.chunk.blockIds,
    sources: item.sources,
    reasons: item.reasons,
    score: item.score,
  }));
}

export function createQuestionTrace(
  input: CreateQuestionTraceInput,
): QuestionTrace {
  const now = Date.now();
  const diagnostics = input.article.diagnostics;
  const evidence = traceEvidence(input.assembly.evidence);

  return {
    schemaVersion: 1,
    pipelineVersion: QUESTION_TRACE_PIPELINE_VERSION,
    extensionVersion: input.extensionVersion,
    createdAt: now,
    updatedAt: now,
    status: 'preparing',
    question: input.question,
    article: {
      rootKind: diagnostics?.rootKind ?? 'unknown',
      readableCharacters:
        diagnostics?.readableLength ??
        input.article.blocks.reduce(
          (total, block) => total + block.text.length,
          0,
        ),
      blockCount: input.article.blocks.length,
      chunkCount: input.sourceChunkCount,
      isPartial: input.article.isPartial,
    },
    focus: {
      type: input.focus?.type ?? 'none',
      ...(input.focus?.section ? { section: input.focus.section } : {}),
      ...(input.focus?.type === 'text' && input.focus.scope
        ? { scope: input.focus.scope }
        : {}),
      ...(input.focus?.text ? { text: input.focus.text } : {}),
      selectedCharacters: input.focus?.text.length ?? 0,
    },
    retrieval: {
      strategy: input.assembly.strategy,
      mode: input.assembly.mode,
      isTruncated: input.assembly.isTruncated,
      initialEvidence: evidence,
      finalEvidence: evidence,
      budget: input.assembly.budget,
    },
    planner: {
      outcome: input.assembly.needsPlanning ? 'pending' : 'skipped',
      reason: input.assembly.needsPlanning
        ? '文章超出统一上下文预算，等待查询规划。'
        : '全文与必要记忆可放入统一上下文预算，无需查询规划。',
    },
    memory:
      input.memory ??
      {
        checkpointOutcome: 'not-needed',
        checkpointCharacters: input.assembly.budget.checkpointCharacters,
        recentTurnCount: input.assembly.memory.recentTurnCount,
        recalledTurnCount: input.assembly.memory.recalledTurnCount,
        compactedTurnCount: 0,
      },
  };
}

export function updateQuestionTraceEvidence(
  trace: QuestionTrace,
  assembly: ContextAssembly,
): QuestionTrace {
  return {
    ...trace,
    updatedAt: Date.now(),
    retrieval: {
      ...trace.retrieval,
      strategy: assembly.strategy,
      mode: assembly.mode,
      isTruncated: assembly.isTruncated,
      finalEvidence: traceEvidence(assembly.evidence),
      budget: assembly.budget,
    },
  };
}

export function updateQuestionTraceMemory(
  trace: QuestionTrace,
  memory: NonNullable<QuestionTrace['memory']>,
): QuestionTrace {
  return {
    ...trace,
    updatedAt: Date.now(),
    memory,
  };
}

export function updateQuestionTracePlanner(
  trace: QuestionTrace,
  planner: QuestionTrace['planner'],
): QuestionTrace {
  return {
    ...trace,
    updatedAt: Date.now(),
    planner,
  };
}

function requestContent(
  content: string | ModelContentPart[],
): {
  text: string;
  imageCount: number;
} {
  if (typeof content === 'string') return { text: content, imageCount: 0 };

  const parts: string[] = [];
  let imageCount = 0;
  for (const part of content) {
    if (part.type === 'text') {
      parts.push(part.text);
      continue;
    }
    imageCount += 1;
    parts.push(`[图片数据未记录，字符数 ${part.image_url.url.length}]`);
  }
  return { text: parts.join('\n'), imageCount };
}

export function snapshotQuestionTraceRequest(
  request: ModelRequest,
  model: string,
): QuestionTraceRequest {
  let imageCount = 0;
  const messages = request.messages.map((message) => {
    const content = requestContent(message.content);
    imageCount += content.imageCount;
    return {
      role: message.role,
      content: content.text,
    };
  });

  return {
    model,
    messageCount: messages.length,
    textCharacters: messages.reduce(
      (total, message) => total + message.content.length,
      0,
    ),
    imageCount,
    messages,
  };
}

export function attachQuestionTraceRequest(
  trace: QuestionTrace,
  request: ModelRequest,
  model: string,
): QuestionTrace {
  return {
    ...trace,
    updatedAt: Date.now(),
    status: 'requesting',
    request: snapshotQuestionTraceRequest(request, model),
  };
}

export function completeQuestionTrace(
  trace: QuestionTrace,
  answer: string,
): QuestionTrace {
  const finishedAt = Date.now();
  return {
    ...trace,
    updatedAt: finishedAt,
    status: 'completed',
    response: {
      outcome: 'completed',
      characterCount: answer.length,
      finishedAt,
    },
  };
}

export function failQuestionTrace(
  trace: QuestionTrace,
  error: string,
): QuestionTrace {
  const finishedAt = Date.now();
  return {
    ...trace,
    updatedAt: finishedAt,
    status: 'failed',
    response: {
      outcome: 'failed',
      error,
      finishedAt,
    },
  };
}

export function interruptQuestionTrace(
  trace: QuestionTrace,
): QuestionTrace {
  const finishedAt = Date.now();
  return {
    ...trace,
    updatedAt: finishedAt,
    status: 'interrupted',
    response: {
      outcome: 'interrupted',
      error: '后台进程在回答完成前重启或中断。',
      finishedAt,
    },
  };
}

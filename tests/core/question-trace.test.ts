import { describe, expect, it, vi } from 'vitest';

import {
  attachQuestionTraceRequest,
  completeQuestionTrace,
  createQuestionTrace,
  failQuestionTrace,
  interruptQuestionTrace,
  snapshotQuestionTraceRequest,
  updateQuestionTraceEvidence,
  updateQuestionTracePlanner,
} from '../../src/core/question-trace.ts';
import type { ContextAssembly } from '../../src/core/context-assembler.ts';
import type {
  ArticleChunk,
  ArticleDocument,
  ModelRequest,
} from '../../src/core/types.ts';

const article: ArticleDocument = {
  title: 'Agent events',
  url: 'https://example.com/events',
  blocks: [
    {
      id: 'block-1',
      type: 'paragraph',
      text: 'AgentSessionEvent includes kernel events.',
      section: '3.3 Session events',
      order: 0,
    },
  ],
  images: [],
  isPartial: false,
  diagnostics: {
    rootKind: 'article',
    readableLength: 42,
    minimumReadableLength: 80,
    rootTextLength: 42,
    candidateBlockCount: 1,
    acceptedBlockCount: 1,
    excludedBlockCount: 0,
    emptyBlockCount: 0,
    articleCandidateCount: 1,
    mainCandidateCount: 0,
    roleMainCandidateCount: 0,
    iframeCount: 0,
    canvasCount: 0,
    tableCount: 0,
    shadowRootCount: 0,
    loadingIndicatorCount: 0,
    fallbackUsed: false,
    fallbackBlockCount: 0,
  },
};

const initialEvidence: ArticleChunk = {
  id: 'chunk-3-3',
  section: '3.3 Session events',
  text: 'The session receives the ten kernel events.',
  blockIds: ['block-1'],
};

const finalEvidence: ArticleChunk = {
  id: 'chunk-2-1',
  section: '2.1 Ten AgentEvent types',
  text: 'agent_start, agent_end, turn_start, turn_end',
  blockIds: ['block-2'],
};

function assembly(
  chunks: ArticleChunk[],
  options: Partial<ContextAssembly> = {},
): ContextAssembly {
  return {
    chunks,
    evidence: chunks.map((chunk) => ({
      chunk,
      sources: ['global-search'],
      reasons: ['Global retrieval'],
      score: 1,
      pinned: false,
    })),
    history: [],
    conversationCheckpoint: null,
    memory: {
      messages: [],
      selectedTurns: [],
      recentTurnCount: 0,
      recalledTurnCount: 0,
      omittedTurnCount: 0,
      compactedPrefixTurns: [],
    },
    mode: 'relevant',
    isTruncated: true,
    strategy: 'fused-retrieval',
    needsPlanning: true,
    budget: {
      limit: 64_000,
      fullArticleCharacters: 80_000,
      articleCharacters: chunks.reduce(
        (total, chunk) => total + chunk.text.length,
        0,
      ),
      historyCharacters: 0,
      checkpointCharacters: 0,
    },
    ...options,
  };
}

describe('question trace', () => {
  it('records extraction, focus, initial evidence, and planner decisions', () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    let trace = createQuestionTrace({
      article,
      sourceChunkCount: 2,
      question: 'Which ten kernel events?',
      focus: {
        type: 'text',
        text: 'ten kernel events',
        section: '3.3 Session events',
      },
      assembly: assembly([initialEvidence]),
      extensionVersion: '0.1.0',
    });

    expect(trace).toMatchObject({
      status: 'preparing',
      article: {
        rootKind: 'article',
        readableCharacters: 42,
        blockCount: 1,
        chunkCount: 2,
      },
      focus: {
        type: 'text',
        section: '3.3 Session events',
        selectedCharacters: 17,
      },
      retrieval: {
        strategy: 'fused-retrieval',
        initialEvidence: [
          {
            section: '3.3 Session events',
            text: initialEvidence.text,
          },
        ],
      },
      planner: {
        outcome: 'pending',
      },
    });

    trace = updateQuestionTracePlanner(trace, {
      outcome: 'completed',
      reason: 'Planner completed.',
      rewrittenQuestion: 'Which ten events?',
      queries: ['ten AgentEvent types'],
    });
    trace = updateQuestionTraceEvidence(trace, assembly([finalEvidence]));

    expect(trace.planner.queries).toEqual(['ten AgentEvent types']);
    expect(trace.retrieval.initialEvidence[0]?.id).toBe('chunk-3-3');
    expect(trace.retrieval.finalEvidence[0]?.id).toBe('chunk-2-1');
  });

  it('captures the actual model request without retaining image data', () => {
    const request: ModelRequest = {
      messages: [
        { role: 'system', content: 'System prompt' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Question and article evidence' },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/jpeg;base64,private-image-data',
              },
            },
          ],
        },
      ],
    };
    const snapshot = snapshotQuestionTraceRequest(request, 'deepseek-test');

    expect(snapshot).toMatchObject({
      model: 'deepseek-test',
      messageCount: 2,
      imageCount: 1,
    });
    expect(JSON.stringify(snapshot)).toContain('Question and article evidence');
    expect(JSON.stringify(snapshot)).toContain('图片数据未记录');
    expect(JSON.stringify(snapshot)).not.toContain('private-image-data');
  });

  it('tracks requesting, completed, failed, and interrupted outcomes', () => {
    const request: ModelRequest = {
      messages: [{ role: 'user', content: 'Question' }],
    };
    const base = createQuestionTrace({
      article,
      sourceChunkCount: 1,
      question: 'Which events?',
      focus: null,
      assembly: assembly([initialEvidence]),
      extensionVersion: '0.1.0',
    });
    const requesting = attachQuestionTraceRequest(
      base,
      request,
      'deepseek-test',
    );

    expect(requesting.status).toBe('requesting');
    expect(completeQuestionTrace(requesting, 'Answer')).toMatchObject({
      status: 'completed',
      response: { outcome: 'completed', characterCount: 6 },
    });
    expect(failQuestionTrace(requesting, 'timeout')).toMatchObject({
      status: 'failed',
      response: { outcome: 'failed', error: 'timeout' },
    });
    expect(interruptQuestionTrace(requesting)).toMatchObject({
      status: 'interrupted',
      response: { outcome: 'interrupted' },
    });
  });
});

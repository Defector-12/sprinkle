import {
  buildQueryPlanRequest,
  type BuildQueryPlanRequestInput,
} from './prompts.ts';
import type { ModelRequest } from './types.ts';

export const QUERY_PLANNER_TIMEOUT_MS = 10_000;
const QUERY_PLAN_QUERY_LIMIT = 4;
const QUERY_PLAN_EVIDENCE_NEED_LIMIT = 4;

export interface QueryPlan {
  rewrittenQuestion: string;
  queries: string[];
  evidenceNeeds: Array<{
    query: string;
    reason: string;
  }>;
  coverage: 'focused' | 'multi-section' | 'document-wide';
  useConversation: boolean;
}

export type QueryPlanInput = BuildQueryPlanRequestInput;

type CompleteQueryPlan = (request: ModelRequest) => Promise<string>;

export { buildQueryPlanRequest } from './prompts.ts';

function cleanQuery(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, 500)
    : '';
}

function cleanReason(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, 300)
    : '';
}

export function parseQueryPlan(value: string): QueryPlan | null {
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(value.slice(start, end + 1)) as {
      rewrittenQuestion?: unknown;
      queries?: unknown;
      evidenceNeeds?: unknown;
      coverage?: unknown;
      useConversation?: unknown;
    };
    const rewrittenQuestion = cleanQuery(parsed.rewrittenQuestion);
    if (!rewrittenQuestion) return null;

    const queries = Array.isArray(parsed.queries)
      ? parsed.queries.map(cleanQuery).filter(Boolean)
      : [];
    const uniqueQueries: string[] = [];
    const seen = new Set<string>();
    for (const query of queries.length ? queries : [rewrittenQuestion]) {
      const key = query.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueQueries.push(query);
      if (uniqueQueries.length >= QUERY_PLAN_QUERY_LIMIT) break;
    }
    const evidenceNeeds: QueryPlan['evidenceNeeds'] = [];
    if (Array.isArray(parsed.evidenceNeeds)) {
      for (const value of parsed.evidenceNeeds) {
        if (!value || typeof value !== 'object') continue;
        const candidate = value as {
          query?: unknown;
          reason?: unknown;
        };
        const query = cleanQuery(candidate.query);
        if (!query) continue;
        evidenceNeeds.push({
          query,
          reason: cleanReason(candidate.reason) || '回答问题所需证据',
        });
        if (evidenceNeeds.length >= QUERY_PLAN_EVIDENCE_NEED_LIMIT) break;
      }
    }
    if (!evidenceNeeds.length) {
      for (const query of uniqueQueries) {
        evidenceNeeds.push({
          query,
          reason: '回答问题所需证据',
        });
      }
    }
    const coverage =
      parsed.coverage === 'multi-section' ||
      parsed.coverage === 'document-wide'
        ? parsed.coverage
        : 'focused';
    return {
      rewrittenQuestion,
      queries: uniqueQueries,
      evidenceNeeds,
      coverage,
      useConversation: parsed.useConversation === true,
    };
  } catch {
    return null;
  }
}

export async function planRetrievalQueries(
  input: QueryPlanInput,
  complete: CompleteQueryPlan,
): Promise<QueryPlan | null> {
  try {
    return parseQueryPlan(await complete(buildQueryPlanRequest(input)));
  } catch {
    return null;
  }
}

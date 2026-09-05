import {
  buildQueryPlanRequest,
  type BuildQueryPlanRequestInput,
} from './prompts.ts';
import type { ModelRequest } from './types.ts';

export const QUERY_PLANNER_TIMEOUT_MS = 10_000;
const QUERY_PLAN_QUERY_LIMIT = 3;

const FOLLOW_UP_PATTERN =
  /(?:它|这个|这种|该(?:方法|模型|机制|结果)|其(?:方法|模型|机制|结果|局限|优势)|上述|前述|其中|前者|后者|\bit\b|\bthis\b|\bthat\b|\bthey\b|\bthem\b|\bthe former\b|\bthe latter\b)/i;
const MULTI_EVIDENCE_PATTERN =
  /(?:比较|对比|区别|异同|分别|关系|联系|优缺点|优势.+局限|\bcompare\b|\bversus\b|\bvs\.?\b|\bdifference\b|\brelationship\b|\btrade-?offs?\b|\badvantages?.+limitations?\b)/i;

export interface QueryPlan {
  rewrittenQuestion: string;
  queries: string[];
}

export type QueryPlanInput = BuildQueryPlanRequestInput;

export interface QueryPlanningDecision {
  question: string;
  hasEvidence: boolean;
  hasHistory: boolean;
}

type CompleteQueryPlan = (request: ModelRequest) => Promise<string>;

export function shouldPlanRetrieval(
  decision: QueryPlanningDecision,
): boolean {
  if (!decision.hasEvidence) return true;
  if (MULTI_EVIDENCE_PATTERN.test(decision.question)) return true;
  return decision.hasHistory && FOLLOW_UP_PATTERN.test(decision.question);
}

export { buildQueryPlanRequest } from './prompts.ts';

function cleanQuery(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, 500)
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
    return { rewrittenQuestion, queries: uniqueQueries };
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

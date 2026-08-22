import type { ModelRequest } from '../core/types.ts';

export type ModelClientErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'API_KEY_MISSING'
  | 'REQUEST_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR';

export class ModelClientError extends Error {
  constructor(
    readonly code: ModelClientErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ModelClientError';
  }
}

export interface ModelConfig {
  endpoint: string;
  model: string;
  timeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface ProviderResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

function assistantText(response: ProviderResponse): string | null {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim() || null;
  if (!Array.isArray(content)) return null;

  const text = content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
  return text || null;
}

async function fetchJson<T>(
  fetcher: Fetcher,
  endpoint: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ payload: T; response: Response }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new ModelClientError(
        'REQUEST_TIMEOUT',
        '模型服务响应超时，请稍后重试。',
      );
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ModelClientError(
      'NETWORK_ERROR',
      `无法连接模型服务，请检查网络后重试。（${detail}）`,
    );
  } finally {
    clearTimeout(timeout);
  }

  let payload = {} as T;
  try {
    payload = (await response.json()) as T;
  } catch {
    if (response.ok) {
      throw new ModelClientError(
        'INVALID_RESPONSE',
        '模型服务返回了无法识别的响应。',
        response.status,
      );
    }
  }
  return { payload, response };
}

function validateConfig(config: ModelConfig): void {
  if (!config.endpoint.trim() || !config.model.trim()) {
    throw new ModelClientError(
      'MODEL_NOT_CONFIGURED',
      '模型 API 尚未配置，请先在实现侧填写 endpoint 和 model。',
    );
  }
}

function validateApiKey(apiKey: string, label = 'API Key'): void {
  if (!apiKey.trim()) {
    throw new ModelClientError(
      'API_KEY_MISSING',
      `请先在设置中填写 ${label}。`,
    );
  }
}

export class OpenAiCompatibleModelClient {
  constructor(
    private readonly config: ModelConfig,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {}

  async complete(apiKey: string, request: ModelRequest): Promise<string> {
    validateConfig(this.config);
    validateApiKey(apiKey, 'DeepSeek API Key');

    const { payload, response } = await fetchJson<ProviderResponse>(
      this.fetcher,
      this.config.endpoint,
      apiKey,
      {
        model: this.config.model,
        messages: request.messages,
        stream: false,
      },
      this.config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new ModelClientError(
        'PROVIDER_ERROR',
        payload.error?.message ||
          `模型服务请求失败（HTTP ${response.status}）。`,
        response.status,
      );
    }

    const content = assistantText(payload);
    if (!content) {
      throw new ModelClientError(
        'INVALID_RESPONSE',
        '模型响应中没有可显示的回答。',
        response.status,
      );
    }
    return content;
  }
}

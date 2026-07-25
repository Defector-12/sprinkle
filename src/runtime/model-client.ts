import type { ModelRequest } from '../core/types.ts';

export type ModelClientErrorCode =
  | 'MODEL_NOT_CONFIGURED'
  | 'API_KEY_MISSING'
  | 'VISION_NOT_SUPPORTED'
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
  supportsVision?: boolean;
}

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

function requestContainsImage(request: ModelRequest): boolean {
  return request.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image_url'),
  );
}

export class OpenAiCompatibleModelClient {
  constructor(
    private readonly config: ModelConfig,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {}

  async complete(apiKey: string, request: ModelRequest): Promise<string> {
    if (!this.config.endpoint.trim() || !this.config.model.trim()) {
      throw new ModelClientError(
        'MODEL_NOT_CONFIGURED',
        '模型 API 尚未配置，请先在实现侧填写 endpoint 和 model。',
      );
    }
    if (!apiKey.trim()) {
      throw new ModelClientError(
        'API_KEY_MISSING',
        '请先在设置中填写 API Key。',
      );
    }
    if (this.config.supportsVision === false && requestContainsImage(request)) {
      throw new ModelClientError(
        'VISION_NOT_SUPPORTED',
        `当前模型 ${this.config.model} 不支持图片输入。请改用支持视觉理解的模型后重新构建插件。`,
      );
    }

    let response: Response;
    try {
      response = await this.fetcher(this.config.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: request.messages,
          stream: false,
        }),
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new ModelClientError(
        'NETWORK_ERROR',
        `无法连接模型服务，请检查网络后重试。（${detail}）`,
      );
    }

    let payload: ProviderResponse = {};
    try {
      payload = (await response.json()) as ProviderResponse;
    } catch {
      if (response.ok) {
        throw new ModelClientError(
          'INVALID_RESPONSE',
          '模型服务返回了无法识别的响应。',
          response.status,
        );
      }
    }

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

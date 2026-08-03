import type {
  AnswerModel,
  ModelContentPart,
  ModelMessage,
  ModelRequest,
} from '../core/types.ts';

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

interface ArkResponsesResponse {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
}

export interface ModelCompletionClient {
  complete(apiKey: string, request: ModelRequest): Promise<string>;
}

export interface RoutedModelKeys {
  textApiKey: string;
  visionApiKey: string;
}

export interface RoutedModelResult {
  content: string;
  model: AnswerModel;
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

function arkAssistantText(response: ArkResponsesResponse): string | null {
  if (typeof response.output_text === 'string') {
    return response.output_text.trim() || null;
  }

  const text = (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter(
      (part) =>
        part.type === 'output_text' && typeof part.text === 'string',
    )
    .map((part) => part.text)
    .join('\n')
    .trim();
  return text || null;
}

export function requestContainsImage(request: ModelRequest): boolean {
  return request.messages.some(
    (message) =>
      Array.isArray(message.content) &&
      message.content.some((part) => part.type === 'image_url'),
  );
}

function arkPart(part: ModelContentPart): {
  type: 'input_text' | 'input_image';
  text?: string;
  image_url?: string;
} {
  if (part.type === 'text') {
    return { type: 'input_text', text: part.text };
  }
  return { type: 'input_image', image_url: part.image_url.url };
}

function arkMessage(message: ModelMessage): {
  role: ModelMessage['role'];
  content:
    | string
    | Array<{
        type: 'input_text' | 'input_image';
        text?: string;
        image_url?: string;
      }>;
} {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content };
  }

  const content = message.content.map(arkPart);
  const images = content.filter((part) => part.type === 'input_image');
  const text = content.filter((part) => part.type === 'input_text');
  return {
    role: message.role,
    content: [...images, ...text],
  };
}

async function fetchJson<T>(
  fetcher: Fetcher,
  endpoint: string,
  apiKey: string,
  body: unknown,
): Promise<{ payload: T; response: Response }> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new ModelClientError(
      'NETWORK_ERROR',
      `无法连接模型服务，请检查网络后重试。（${detail}）`,
    );
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
    validateApiKey(apiKey);
    if (this.config.supportsVision === false && requestContainsImage(request)) {
      throw new ModelClientError(
        'VISION_NOT_SUPPORTED',
        `当前模型 ${this.config.model} 不支持图片输入。请改用支持视觉理解的模型后重新构建插件。`,
      );
    }

    const { payload, response } = await fetchJson<ProviderResponse>(
      this.fetcher,
      this.config.endpoint,
      apiKey,
      {
        model: this.config.model,
        messages: request.messages,
        stream: false,
      },
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

export class ArkResponsesModelClient implements ModelCompletionClient {
  constructor(
    private readonly config: ModelConfig,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
  ) {}

  async complete(apiKey: string, request: ModelRequest): Promise<string> {
    validateConfig(this.config);
    validateApiKey(apiKey, 'Doubao API Key');

    const { payload, response } = await fetchJson<ArkResponsesResponse>(
      this.fetcher,
      this.config.endpoint,
      apiKey,
      {
        model: this.config.model,
        input: request.messages.map(arkMessage),
      },
    );

    if (!response.ok) {
      throw new ModelClientError(
        'PROVIDER_ERROR',
        payload.error?.message ||
          `Doubao 模型服务请求失败（HTTP ${response.status}）。`,
        response.status,
      );
    }

    const content = arkAssistantText(payload);
    if (!content) {
      throw new ModelClientError(
        'INVALID_RESPONSE',
        'Doubao 模型响应中没有可显示的回答。',
        response.status,
      );
    }
    return content;
  }
}

export class RoutedModelClient {
  constructor(
    private readonly textClient: ModelCompletionClient,
    private readonly visionClient: ModelCompletionClient,
  ) {}

  async complete(
    keys: RoutedModelKeys,
    request: ModelRequest,
  ): Promise<RoutedModelResult> {
    if (requestContainsImage(request)) {
      validateApiKey(keys.visionApiKey, 'Doubao API Key');
      return {
        content: await this.visionClient.complete(
          keys.visionApiKey,
          request,
        ),
        model: 'doubao',
      };
    }
    return {
      content: await this.textClient.complete(keys.textApiKey, request),
      model: 'deepseek',
    };
  }
}

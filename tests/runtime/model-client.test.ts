import { describe, expect, it, vi } from 'vitest';

import {
  ArkResponsesModelClient,
  ModelClientError,
  OpenAiCompatibleModelClient,
  RoutedModelClient,
} from '../../src/runtime/model-client.ts';
import type { ModelRequest } from '../../src/core/types.ts';

const request: ModelRequest = {
  messages: [
    {
      role: 'user',
      content: 'Explain the current article.',
    },
  ],
};

const imageRequest: ModelRequest = {
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Explain this image.' },
        {
          type: 'image_url',
          image_url: { url: 'https://example.com/diagram.png' },
        },
      ],
    },
  ],
};

describe('OpenAiCompatibleModelClient', () => {
  it('fails clearly while the implementation-side model config is empty', async () => {
    const client = new OpenAiCompatibleModelClient(
      { endpoint: '', model: '' },
      vi.fn(),
    );

    await expect(client.complete('key', request)).rejects.toEqual(
      expect.objectContaining({
        code: 'MODEL_NOT_CONFIGURED',
      }),
    );
  });

  it('requires an API key before making a request', async () => {
    const fetcher = vi.fn();
    const client = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.example.com/chat/completions',
        model: 'vision-model',
      },
      fetcher,
    );

    await expect(client.complete('', request)).rejects.toEqual(
      expect.objectContaining({
        code: 'API_KEY_MISSING',
      }),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects image requests before fetch when the fixed model is text-only', async () => {
    const fetcher = vi.fn();
    const client = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.deepseek.com/v1/chat/completions',
        model: 'deepseek-v4-flash',
        supportsVision: false,
      },
      fetcher,
    );

    await expect(client.complete('key', imageRequest)).rejects.toEqual(
      expect.objectContaining({
        code: 'VISION_NOT_SUPPORTED',
        message: expect.stringContaining('不支持图片输入'),
      }),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends one fixed model request and returns assistant text', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Contextual answer' } }],
        }),
        { status: 200 },
      ),
    );
    const client = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.example.com/chat/completions',
        model: 'vision-model',
      },
      fetcher,
    );

    await expect(client.complete('secret', request)).resolves.toBe(
      'Contextual answer',
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
        }),
      }),
    );
    const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
    expect(body.model).toBe('vision-model');
  });

  it('normalizes provider failures without leaking the API key', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Rate limited' } }), {
        status: 429,
      }),
    );
    const client = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.example.com/chat/completions',
        model: 'vision-model',
      },
      fetcher,
    );

    const error = await client.complete('private-key', request).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(ModelClientError);
    expect(error).toEqual(expect.objectContaining({ code: 'PROVIDER_ERROR' }));
    expect(JSON.stringify(error)).not.toContain('private-key');
  });

  it('normalizes network and malformed response failures', async () => {
    const networkClient = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.example.com/chat/completions',
        model: 'vision-model',
      },
      vi.fn().mockRejectedValue(new Error('socket failed')),
    );
    await expect(networkClient.complete('key', request)).rejects.toEqual(
      expect.objectContaining({ code: 'NETWORK_ERROR' }),
    );

    const malformedClient = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.example.com/chat/completions',
        model: 'vision-model',
      },
      vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })),
    );
    await expect(malformedClient.complete('key', request)).rejects.toEqual(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    );
  });

  it('handles provider errors without JSON and empty successful answers', async () => {
    const plainErrorClient = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.example.com/chat/completions',
        model: 'vision-model',
      },
      vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })),
    );
    await expect(plainErrorClient.complete('key', request)).rejects.toEqual(
      expect.objectContaining({
        code: 'PROVIDER_ERROR',
        status: 503,
      }),
    );

    const emptyAnswerClient = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.example.com/chat/completions',
        model: 'vision-model',
      },
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: '   ' } }] }),
          { status: 200 },
        ),
      ),
    );
    await expect(emptyAnswerClient.complete('key', request)).rejects.toEqual(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    );
  });

  it('joins text parts from multimodal provider responses', async () => {
    const client = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.example.com/chat/completions',
        model: 'vision-model',
      },
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: [
                    { type: 'text', text: 'First' },
                    { type: 'image', image: 'ignored' },
                    { type: 'text', text: 'Second' },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(client.complete('key', request)).resolves.toBe(
      'First\nSecond',
    );
  });
});

describe('ArkResponsesModelClient', () => {
  it('converts image messages to the Ark Responses API and reads output text', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: 'The diagram shows an agent loop.' },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new ArkResponsesModelClient(
      {
        endpoint: 'https://ark.cn-beijing.volces.com/api/v3/responses',
        model: 'doubao-seed-2-0-mini-260428',
      },
      fetcher,
    );

    await expect(client.complete('ark-key', imageRequest)).resolves.toBe(
      'The diagram shows an agent loop.',
    );

    const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
    expect(body.model).toBe('doubao-seed-2-0-mini-260428');
    expect(body.input.at(-1).content).toEqual([
      {
        type: 'input_image',
        image_url: 'https://example.com/diagram.png',
      },
      {
        type: 'input_text',
        text: 'Explain this image.',
      },
    ]);
  });
});

describe('RoutedModelClient', () => {
  it('uses DeepSeek for text and Doubao only when the request contains an image', async () => {
    const textClient = {
      complete: vi.fn().mockResolvedValue('text answer'),
    };
    const visionClient = {
      complete: vi.fn().mockResolvedValue('vision answer'),
    };
    const client = new RoutedModelClient(textClient, visionClient);

    await expect(
      client.complete(
        { textApiKey: 'deepseek-key', visionApiKey: 'ark-key' },
        request,
      ),
    ).resolves.toEqual({
      content: 'text answer',
      model: 'deepseek',
    });
    await expect(
      client.complete(
        { textApiKey: 'deepseek-key', visionApiKey: 'ark-key' },
        imageRequest,
      ),
    ).resolves.toEqual({
      content: 'vision answer',
      model: 'doubao',
    });

    expect(textClient.complete).toHaveBeenCalledOnce();
    expect(textClient.complete).toHaveBeenCalledWith('deepseek-key', request);
    expect(visionClient.complete).toHaveBeenCalledOnce();
    expect(visionClient.complete).toHaveBeenCalledWith(
      'ark-key',
      imageRequest,
    );
  });

  it('requires a separate Doubao key before sending an image', async () => {
    const client = new RoutedModelClient(
      { complete: vi.fn() },
      { complete: vi.fn() },
    );

    await expect(
      client.complete(
        { textApiKey: 'deepseek-key', visionApiKey: '' },
        imageRequest,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'API_KEY_MISSING',
        message: expect.stringContaining('Doubao API Key'),
      }),
    );
  });
});

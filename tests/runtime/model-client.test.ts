import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ModelClientError,
  OpenAiCompatibleModelClient,
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('aborts a model request after the configured timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const client = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.example.com/chat/completions',
        model: 'vision-model',
        timeoutMs: 100,
      },
      fetcher,
    );

    const completion = client.complete('secret', request);
    const rejection = expect(completion).rejects.toEqual(
      expect.objectContaining({ code: 'REQUEST_TIMEOUT' }),
    );
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
  });

  it('allows a shorter timeout for an individual completion', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const client = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.example.com/chat/completions',
        model: 'vision-model',
        timeoutMs: 45_000,
      },
      fetcher,
    );

    const completion = client.complete('secret', request, { timeoutMs: 100 });
    const rejection = expect(completion).rejects.toEqual(
      expect.objectContaining({ code: 'REQUEST_TIMEOUT' }),
    );
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
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

  it('sends image_url content directly to the DeepSeek vision model', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Visual answer' } }],
        }),
        { status: 200 },
      ),
    );
    const client = new OpenAiCompatibleModelClient(
      {
        endpoint: 'https://api.deepseek.com/chat/completions',
        model: 'deepseek-v4-flash-vision-exp',
      },
      fetcher,
    );

    await expect(client.complete('secret', imageRequest)).resolves.toBe(
      'Visual answer',
    );

    const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
    expect(body).toEqual({
      model: 'deepseek-v4-flash-vision-exp',
      messages: imageRequest.messages,
      stream: false,
    });
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

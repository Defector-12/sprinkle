import { describe, expect, it, vi } from 'vitest';

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
});

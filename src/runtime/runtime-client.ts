import { browser } from 'wxt/browser';

import type {
  ExtensionRequest,
  ExtensionResponse,
  RuntimeResult,
} from './messages.ts';

export async function sendRuntimeRequest<Request extends ExtensionRequest>(
  message: Request,
): Promise<ExtensionResponse<Request>> {
  const response = (await browser.runtime.sendMessage(
    message,
  )) as RuntimeResult<ExtensionResponse<Request>>;
  if (!response) throw new Error('扩展后台没有响应');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

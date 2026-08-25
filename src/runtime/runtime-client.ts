import { browser } from 'wxt/browser';

import type { ExtensionRequest, RuntimeResult } from './messages.ts';

export async function sendRuntimeRequest<T>(
  message: ExtensionRequest,
): Promise<T> {
  const response = (await browser.runtime.sendMessage(
    message,
  )) as RuntimeResult<T>;
  if (!response) throw new Error('扩展后台没有响应');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

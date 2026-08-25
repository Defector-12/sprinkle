import { browser } from 'wxt/browser';

interface RuntimeUrlApi {
  getURL(path: string): string;
}

export function extensionUrl(path: string): string {
  return (browser.runtime as unknown as RuntimeUrlApi).getURL(path);
}

import { browser } from 'wxt/browser';

import type { StudyWorkspaceBridgeContract } from '../components/StudyWorkspace.tsx';
import type {
  ImageFocus,
  PageContext,
  RegionFocus,
} from '../core/types.ts';
import { normalizePageUrl } from '../core/url.ts';
import { extensionUrl } from './extension-url.ts';
import {
  isContextChangedEvent,
  type ExtensionRequest,
  type RuntimeResult,
  type StudyCaptureRect,
} from './messages.ts';

export interface StudyTarget {
  tabId: number;
  url: string;
}

async function send<T>(message: ExtensionRequest): Promise<T> {
  const response = (await browser.runtime.sendMessage(
    message,
  )) as RuntimeResult<T>;
  if (!response) throw new Error('扩展后台没有响应');
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取工作台截图'));
    image.src = source;
  });
}

export function parseStudyTarget(search: string): StudyTarget {
  const params = new URLSearchParams(search);
  const tabId = Number(params.get('tabId'));
  const url = params.get('url') ?? '';
  if (!Number.isInteger(tabId) || tabId <= 0 || !/^https?:\/\//.test(url)) {
    throw new Error('学习工作台链接无效，请从已启用页面重新打开。');
  }
  return { tabId, url };
}

export class StudyWorkspaceBridge implements StudyWorkspaceBridgeContract {
  constructor(private readonly target: StudyTarget) {}

  initialize(): Promise<PageContext> {
    return send<PageContext>({
      type: 'study:context:get',
      ...this.target,
    });
  }

  ask(question: string): Promise<PageContext> {
    return send<PageContext>({
      type: 'study:chat:ask',
      ...this.target,
      question,
    });
  }

  setTextFocus(text: string, section: string): Promise<PageContext> {
    return send<PageContext>({
      type: 'study:focus:set',
      ...this.target,
      focus: {
        type: 'text',
        text,
        section,
      },
    });
  }

  setImageFocus(focus: ImageFocus): Promise<PageContext> {
    return send<PageContext>({
      type: 'study:focus:set',
      ...this.target,
      focus,
    });
  }

  setRegionFocus(focus: RegionFocus): Promise<PageContext> {
    return send<PageContext>({
      type: 'study:focus:set',
      ...this.target,
      focus,
    });
  }

  clearFocus(): Promise<PageContext> {
    return send<PageContext>({
      type: 'study:focus:clear',
      ...this.target,
    });
  }

  async captureRegion(rect: StudyCaptureRect): Promise<string> {
    const currentWindow = await browser.windows.getCurrent();
    if (currentWindow.id == null) {
      throw new Error('无法识别学习工作台所在窗口');
    }
    const screenshot = await browser.tabs.captureVisibleTab(currentWindow.id, {
      format: 'jpeg',
      quality: 90,
    });
    const source = await loadImage(screenshot);
    const scaleX = source.naturalWidth / window.innerWidth;
    const scaleY = source.naturalHeight / window.innerHeight;
    const sourceWidth = Math.max(1, Math.round(rect.width * scaleX));
    const sourceHeight = Math.max(1, Math.round(rect.height * scaleY));
    const outputScale = Math.min(1, 1600 / sourceWidth, 1600 / sourceHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
    canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持截图裁剪');
    context.drawImage(
      source,
      Math.round(rect.left * scaleX),
      Math.round(rect.top * scaleY),
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  async openSource(): Promise<void> {
    await send<void>({
      type: 'study:source:open',
      ...this.target,
    });
  }

  async open(): Promise<void> {
    const params = new URLSearchParams({
      tabId: String(this.target.tabId),
      url: this.target.url,
    });
    await browser.tabs.create({
      url: extensionUrl(`/study.html?${params.toString()}`),
    });
  }

  subscribe(listener: (context: PageContext) => void): () => void {
    const onMessage = (message: unknown) => {
      if (
        isContextChangedEvent(message) &&
        message.context.tabId === this.target.tabId &&
        normalizePageUrl(message.context.url) ===
          normalizePageUrl(this.target.url)
      ) {
        listener(message.context);
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }
}

import { browser } from 'wxt/browser';

export interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportMetrics {
  width: number;
  height: number;
  offsetLeft: number;
  offsetTop: number;
}

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function currentViewportMetrics(): ViewportMetrics {
  const visual = window.visualViewport;
  return {
    width: visual?.width ?? window.innerWidth,
    height: visual?.height ?? window.innerHeight,
    offsetLeft: visual?.offsetLeft ?? 0,
    offsetTop: visual?.offsetTop ?? 0,
  };
}

export function mapViewportRectToImage(
  rect: ViewportRect,
  imageWidth: number,
  imageHeight: number,
  viewport: ViewportMetrics,
): ImageCrop {
  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    throw new Error('截图或视口尺寸无效');
  }
  const left = rect.left - viewport.offsetLeft;
  const top = rect.top - viewport.offsetTop;
  const visibleLeft = Math.max(0, left);
  const visibleTop = Math.max(0, top);
  const visibleRight = Math.min(viewport.width, left + rect.width);
  const visibleBottom = Math.min(viewport.height, top + rect.height);
  if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) {
    throw new Error('选择区域不在当前可见页面内');
  }

  const scaleX = imageWidth / viewport.width;
  const scaleY = imageHeight / viewport.height;
  const x = Math.max(0, Math.round(visibleLeft * scaleX));
  const y = Math.max(0, Math.round(visibleTop * scaleY));
  const width = Math.max(1, Math.round((visibleRight - visibleLeft) * scaleX));
  const height = Math.max(1, Math.round((visibleBottom - visibleTop) * scaleY));
  return {
    x,
    y,
    width: Math.min(imageWidth - x, width),
    height: Math.min(imageHeight - y, height),
  };
}

async function activeTabId(windowId: number): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, windowId });
  return tab?.id;
}

export async function captureVisibleTabForSender(
  tabId: number,
  windowId: number,
  options: { format: 'jpeg'; quality: number } | { format: 'png' },
): Promise<string> {
  if ((await activeTabId(windowId)) !== tabId) {
    throw new Error('页面已切换，请返回原页面后重新截图。');
  }
  const screenshot = await browser.tabs.captureVisibleTab(windowId, options);
  if ((await activeTabId(windowId)) !== tabId) {
    throw new Error('截图期间页面发生切换，请重新选择。');
  }
  return screenshot;
}

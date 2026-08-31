import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { FloatingAssistant } from '../src/components/FloatingAssistant.tsx';
import {
  extractArticle,
  sectionPathForElement,
} from '../src/core/article-extractor.ts';
import type { FocusContext } from '../src/core/types.ts';
import {
  publishAssistantOpen,
  subscribeAssistantActive,
} from '../src/runtime/assistant-events.ts';
import { ContentAssistantBridge } from '../src/runtime/content-assistant-bridge.ts';
import type { ContentRequest } from '../src/runtime/messages.ts';
import { sendRuntimeRequest } from '../src/runtime/runtime-client.ts';
import {
  currentViewportMetrics,
  mapViewportRectToImage,
} from '../src/runtime/screenshot.ts';
import floatingAssistantCss from '../src/styles/floating-assistant.css?inline';

const UI_ATTRIBUTE = 'data-context-reader-ui';
const CONTENT_RUNTIME_KEY = '__contextReaderRuntimeMounted__';
type RuntimeGlobal = typeof globalThis &
  Partial<Record<typeof CONTENT_RUNTIME_KEY, boolean>>;

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function sectionFor(element: Element | null): string {
  const fallback =
    cleanText(document.querySelector('h1')?.textContent) ||
    document.title;
  return sectionPathForElement(document, element, fallback);
}

interface SelectionToolbar {
  element: HTMLDivElement;
  askButton: HTMLButtonElement;
  translateButton: HTMLButtonElement;
}

function createSelectionAction(
  label: string,
  emphasized = false,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', `${label}选中文字`);
  Object.assign(button.style, {
    all: 'initial',
    boxSizing: 'border-box',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '28px',
    padding: '0 9px',
    border: '0',
    borderRadius: '5px',
    background: emphasized ? '#e75a2c' : 'transparent',
    color: emphasized ? '#fff' : '#272925',
    font: '600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    cursor: 'pointer',
  });
  return button;
}

function createSelectionToolbar(): SelectionToolbar {
  const element = document.createElement('div');
  element.setAttribute(UI_ATTRIBUTE, 'selection-toolbar');
  Object.assign(element.style, {
    all: 'initial',
    boxSizing: 'border-box',
    position: 'fixed',
    zIndex: '2147483647',
    display: 'none',
    alignItems: 'center',
    gap: '2px',
    padding: '3px',
    border: '1px solid rgba(39,41,37,.16)',
    borderRadius: '8px',
    background: '#fffdf8',
    boxShadow: '0 7px 20px rgba(30,22,15,.18)',
  });
  const askButton = createSelectionAction('提问');
  askButton.setAttribute(UI_ATTRIBUTE, 'selection-button');
  const translateButton = createSelectionAction('翻译', true);
  translateButton.setAttribute(UI_ATTRIBUTE, 'translation-button');
  element.append(askButton, translateButton);
  document.documentElement.append(element);
  return { element, askButton, translateButton };
}

function createTranslationBubble(): HTMLDivElement {
  const bubble = document.createElement('div');
  bubble.setAttribute(UI_ATTRIBUTE, 'translation');
  bubble.setAttribute('role', 'status');
  bubble.setAttribute('aria-label', '划词译文');
  bubble.setAttribute('aria-live', 'polite');
  Object.assign(bubble.style, {
    all: 'initial',
    boxSizing: 'border-box',
    position: 'fixed',
    zIndex: '2147483646',
    display: 'none',
    width: 'max-content',
    maxWidth: 'min(360px, calc(100vw - 24px))',
    maxHeight: 'min(280px, calc(100vh - 24px))',
    overflow: 'auto',
    padding: '10px 12px',
    border: '1px solid rgba(39,41,37,.15)',
    borderRadius: '8px',
    background: '#fffdf8',
    boxShadow: '0 10px 30px rgba(30,22,15,.2)',
    color: '#272925',
    font: '500 13px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    cursor: 'grab',
    touchAction: 'none',
    userSelect: 'none',
  });
  document.documentElement.append(bubble);
  return bubble;
}

function positionNearSelection(
  element: HTMLElement,
  rect: DOMRect,
  preferBelow: boolean,
): void {
  const bounds = element.getBoundingClientRect();
  const width = bounds.width || Math.min(360, window.innerWidth - 24);
  const height = bounds.height || 40;
  const left = Math.min(
    Math.max(12, rect.left + rect.width / 2 - width / 2),
    Math.max(12, window.innerWidth - width - 12),
  );
  const above = rect.top - height - 8;
  const below = rect.bottom + 8;
  const preferredTop = preferBelow ? below : above;
  const fallbackTop = preferBelow ? above : below;
  const top =
    preferredTop >= 8 &&
    preferredTop + height <= window.innerHeight - 8
      ? preferredTop
      : Math.min(
          Math.max(8, fallbackTop),
          Math.max(8, window.innerHeight - height - 8),
        );
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function makeDraggable(
  element: HTMLElement,
  onDrag: () => void,
): () => void {
  let drag:
    | { pointerId: number; offsetX: number; offsetY: number }
    | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const rect = element.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    element.setPointerCapture(event.pointerId);
    element.style.cursor = 'grabbing';
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rect = element.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, event.clientX - drag.offsetX),
      Math.max(8, window.innerWidth - rect.width - 8),
    );
    const top = Math.min(
      Math.max(8, event.clientY - drag.offsetY),
      Math.max(8, window.innerHeight - rect.height - 8),
    );
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    onDrag();
  };
  const stopDragging = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    drag = null;
    element.style.cursor = 'grab';
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', stopDragging);
  element.addEventListener('pointercancel', stopDragging);
  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', stopDragging);
    element.removeEventListener('pointercancel', stopDragging);
  };
}

function installTextSelection(openAssistant: () => void): () => void {
  document
    .querySelectorAll(
      `[${UI_ATTRIBUTE}="selection-toolbar"], [${UI_ATTRIBUTE}="selection-button"], [${UI_ATTRIBUTE}="translation"]`,
    )
    .forEach((element) => element.remove());
  const toolbar = createSelectionToolbar();
  const translation = createTranslationBubble();
  let selectedText = '';
  let selectedElement: Element | null = null;
  let selectedRect: DOMRect | null = null;
  let translationRequest = 0;
  let translationMoved = false;
  let enabled = false;
  const removeTranslationDrag = makeDraggable(
    translation,
    () => {
      translationMoved = true;
    },
  );

  const hideToolbar = () => {
    toolbar.element.style.display = 'none';
  };
  const hideTranslation = () => {
    translationRequest += 1;
    translation.style.display = 'none';
  };
  const showTranslation = (
    text: string,
    rect: DOMRect,
    failed = false,
    reposition = true,
  ) => {
    translation.textContent = text;
    translation.style.color = failed ? '#a33a22' : '#272925';
    translation.style.display = 'block';
    if (reposition) positionNearSelection(translation, rect, true);
  };

  const showForSelection = () => {
    if (!enabled) {
      hideToolbar();
      return;
    }
    const selection = window.getSelection();
    const text = cleanText(selection?.toString());
    if (!selection || selection.isCollapsed || text.length < 2) {
      hideToolbar();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const node = range.startContainer;
    selectedElement =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
    if (selectedElement?.closest(`[${UI_ATTRIBUTE}]`)) return;

    selectedText = text.slice(0, 4_000);
    selectedRect = rect;
    hideTranslation();
    toolbar.element.style.display = 'inline-flex';
    positionNearSelection(toolbar.element, rect, false);
  };

  const onMouseUp = (event: MouseEvent) => {
    if ((event.target as Element | null)?.closest?.(`[${UI_ATTRIBUTE}]`)) {
      return;
    }
    window.setTimeout(showForSelection, 0);
  };

  const onButtonClick = async () => {
    if (!enabled) return;
    const focus: FocusContext = {
      type: 'text',
      text: selectedText,
      section: sectionFor(selectedElement),
    };
    hideToolbar();
    hideTranslation();
    await sendRuntimeRequest({ type: 'focus:set', focus })
      .then(openAssistant)
      .catch(() => undefined);
  };
  const onTranslateClick = async () => {
    if (!enabled || !selectedText || !selectedRect) return;
    const text = selectedText;
    const section = sectionFor(selectedElement);
    const rect = selectedRect;
    const request = ++translationRequest;
    translationMoved = false;
    hideToolbar();
    showTranslation('翻译中...', rect);
    try {
      const result = await sendRuntimeRequest<string>({
        type: 'translate',
        text,
        section,
      });
      if (request !== translationRequest) return;
      showTranslation(
        result.trim() || '未返回译文',
        rect,
        false,
        !translationMoved,
      );
    } catch (cause) {
      if (request !== translationRequest) return;
      const message =
        cause instanceof Error ? cause.message : '操作失败，请重试。';
      showTranslation(
        `翻译失败：${message}`,
        rect,
        true,
        !translationMoved,
      );
    }
  };
  const onActiveChange = (active: boolean) => {
    enabled = active;
    if (!enabled) {
      hideToolbar();
      hideTranslation();
    }
  };

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('scroll', hideToolbar, true);
  const unsubscribeActive = subscribeAssistantActive(onActiveChange);
  toolbar.askButton.addEventListener('mousedown', (event) =>
    event.preventDefault(),
  );
  toolbar.translateButton.addEventListener('mousedown', (event) =>
    event.preventDefault(),
  );
  toolbar.askButton.addEventListener('click', onButtonClick);
  toolbar.translateButton.addEventListener('click', onTranslateClick);

  return () => {
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('scroll', hideToolbar, true);
    unsubscribeActive();
    toolbar.askButton.removeEventListener('click', onButtonClick);
    toolbar.translateButton.removeEventListener('click', onTranslateClick);
    removeTranslationDrag();
    toolbar.element.remove();
    translation.remove();
  };
}

function openFloatingAssistant(activate = false): void {
  publishAssistantOpen({ activate });
}

interface MountedAssistant {
  host: HTMLElement;
  root: Root;
  removeEventIsolation: () => void;
}

function mountFloatingAssistant(): MountedAssistant {
  document
    .querySelector(`[${UI_ATTRIBUTE}="assistant-root"]`)
    ?.remove();

  const host = document.createElement('div');
  host.setAttribute(UI_ATTRIBUTE, 'assistant-root');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = floatingAssistantCss;
  const container = document.createElement('div');
  shadow.append(style, container);
  document.documentElement.append(host);

  const isolatedEvents = [
    'click',
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'keydown',
    'keyup',
    'keypress',
  ];
  const stopPropagation = (event: Event) => event.stopPropagation();
  for (const eventName of isolatedEvents) {
    shadow.addEventListener(eventName, stopPropagation);
  }

  const root = createRoot(container);
  root.render(
    createElement(FloatingAssistant, {
      bridge: new ContentAssistantBridge(),
    }),
  );

  return {
    host,
    root,
    removeEventIsolation: () => {
      for (const eventName of isolatedEvents) {
        shadow.removeEventListener(eventName, stopPropagation);
      }
    },
  };
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('截图无法读取'));
    image.src = source;
  });
}

async function cropVisibleScreenshot(rect: DOMRect): Promise<string> {
  const screenshot = await sendRuntimeRequest<string>({
    type: 'capture:visible',
  });
  const source = await loadImage(screenshot);
  const crop = mapViewportRectToImage(
    rect,
    source.naturalWidth,
    source.naturalHeight,
    currentViewportMetrics(),
  );
  const outputScale = Math.min(1, 1600 / crop.width, 1600 / crop.height);
  const width = Math.max(1, Math.round(crop.width * outputScale));
  const height = Math.max(1, Math.round(crop.height * outputScale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持截图裁剪');

  context.drawImage(
    source,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    width,
    height,
  );
  return canvas.toDataURL('image/jpeg', 0.9);
}

function imageFromTarget(target: Element | null): HTMLImageElement | null {
  const image =
    target?.closest('img') ??
    target?.closest('figure')?.querySelector('img');
  return image instanceof HTMLImageElement ? image : null;
}

function imageDescription(image: HTMLImageElement): string {
  const figure = image.closest('figure');
  return [
    image.alt,
    figure?.querySelector('figcaption')?.textContent,
    figure?.previousElementSibling?.textContent,
    figure?.nextElementSibling?.textContent,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(' ')
    .slice(0, 1_200);
}

function afterRepaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

async function capturePageRegion(rect: DOMRect): Promise<string> {
  const assistant = document.querySelector<HTMLElement>(
    `[${UI_ATTRIBUTE}="assistant-root"]`,
  );
  const previousVisibility = assistant?.style.visibility ?? '';
  if (assistant) assistant.style.visibility = 'hidden';
  try {
    await afterRepaint();
    return await cropVisibleScreenshot(rect);
  } finally {
    if (assistant) assistant.style.visibility = previousVisibility;
  }
}

async function quoteImage(
  image: HTMLImageElement,
  openAssistant: () => void,
): Promise<void> {
  const rect = image.getBoundingClientRect();
  const originalUrl = image.currentSrc || image.src;
  const screenshot = await capturePageRegion(rect).catch(() => '');
  const imageUrl = screenshot || originalUrl;
  if (!imageUrl) throw new Error('无法读取这张图片');

  await sendRuntimeRequest({
    type: 'focus:set',
    focus: {
      type: 'image',
      imageUrl,
      alt: cleanText(image.alt),
      text: imageDescription(image),
      section: sectionFor(image),
      source: screenshot ? 'screenshot' : 'original',
    },
  });
  openAssistant();
}

function startImagePicker(openAssistant: () => void): void {
  let hovered: HTMLElement | null = null;
  let previousOutline = '';
  let previousOutlineOffset = '';
  const previousCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';

  const restoreHovered = () => {
    if (hovered) {
      hovered.style.outline = previousOutline;
      hovered.style.outlineOffset = previousOutlineOffset;
    }
    hovered = null;
  };
  const cleanup = () => {
    restoreHovered();
    document.documentElement.style.cursor = previousCursor;
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  };
  const onMouseOver = (event: MouseEvent) => {
    const image = imageFromTarget(event.target as Element | null);
    restoreHovered();
    if (image instanceof HTMLElement) {
      hovered = image;
      previousOutline = image.style.outline;
      previousOutlineOffset = image.style.outlineOffset;
      image.style.outline = '3px solid #e75a2c';
      image.style.outlineOffset = '4px';
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cleanup();
  };
  const onClick = async (event: MouseEvent) => {
    const image = imageFromTarget(event.target as Element | null);
    if (!image) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    cleanup();
    await quoteImage(image, openAssistant).catch(openAssistant);
  };

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
}

function installImageDoubleClick(openAssistant: () => void): () => void {
  let enabled = false;
  const onActiveChange = (active: boolean) => {
    enabled = active;
  };
  const onDoubleClick = (event: MouseEvent) => {
    if (!enabled) return;
    const target = event.target as Element | null;
    if (target?.closest(`[${UI_ATTRIBUTE}]`)) return;
    const image = imageFromTarget(target);
    if (image) void quoteImage(image, openAssistant).catch(() => undefined);
  };

  const unsubscribeActive = subscribeAssistantActive(onActiveChange);
  document.addEventListener('dblclick', onDoubleClick, true);
  return () => {
    unsubscribeActive();
    document.removeEventListener('dblclick', onDoubleClick, true);
  };
}

function showRegionPreview(
  imageUrl: string,
  onConfirm: () => void | Promise<void>,
): void {
  const previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const backdrop = document.createElement('div');
  backdrop.setAttribute(UI_ATTRIBUTE, 'region-preview');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', '确认框选区域');
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    display: 'grid',
    placeItems: 'center',
    background: 'rgba(25, 24, 21, .36)',
    backdropFilter: 'blur(6px)',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    width: 'min(420px, calc(100vw - 32px))',
    padding: '14px',
    border: '1px solid rgba(255,255,255,.35)',
    borderRadius: '16px',
    background: '#fbf7ef',
    boxShadow: '0 24px 80px rgba(20,18,14,.28)',
    font: '14px/1.5 "Avenir Next", sans-serif',
  });
  const preview = document.createElement('img');
  preview.src = imageUrl;
  preview.alt = '框选区域预览';
  Object.assign(preview.style, {
    display: 'block',
    width: '100%',
    maxHeight: '55vh',
    objectFit: 'contain',
    borderRadius: '9px',
    background: '#e9e4db',
  });
  const actions = document.createElement('div');
  Object.assign(actions.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '12px',
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  cancel.style.cssText =
    'border:1px solid #d6d0c6;border-radius:999px;background:#fffaf2;padding:8px 14px;cursor:pointer;';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.textContent = '使用这一区域';
  confirm.style.cssText =
    'border:1px solid #d64b22;border-radius:999px;background:#e75a2c;color:white;padding:8px 14px;cursor:pointer;';
  actions.append(cancel, confirm);
  card.append(preview, actions);
  backdrop.append(card);
  document.documentElement.append(backdrop);

  const close = () => {
    backdrop.remove();
    previousFocus?.focus();
  };
  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    close();
    void onConfirm();
  });
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  confirm.focus();
}

function startRegionPicker(openAssistant: () => void): void {
  const overlay = document.createElement('div');
  const box = document.createElement('div');
  overlay.setAttribute(UI_ATTRIBUTE, 'region-picker');
  overlay.setAttribute('aria-label', '拖动框选页面区域，按 Escape 取消');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    cursor: 'crosshair',
    background: 'rgba(28, 27, 24, .12)',
  });
  Object.assign(box.style, {
    position: 'fixed',
    display: 'none',
    border: '2px solid #e75a2c',
    background: 'rgba(231, 90, 44, .08)',
    boxShadow: '0 0 0 9999px rgba(28, 27, 24, .22)',
  });
  overlay.append(box);
  document.documentElement.append(overlay);

  let startX = 0;
  let startY = 0;
  let dragging = false;
  let selectedRect: DOMRect | null = null;

  const cleanup = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown, true);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cleanup();
  };
  const updateBox = (x: number, y: number) => {
    const left = Math.min(startX, x);
    const top = Math.min(startY, y);
    const width = Math.abs(x - startX);
    const height = Math.abs(y - startY);
    Object.assign(box.style, {
      display: 'block',
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    selectedRect = new DOMRect(left, top, width, height);
  };

  overlay.addEventListener('pointerdown', (event) => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    updateBox(startX, startY);
    overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener('pointermove', (event) => {
    if (dragging) updateBox(event.clientX, event.clientY);
  });
  overlay.addEventListener('pointerup', async (event) => {
    if (!dragging) return;
    dragging = false;
    overlay.releasePointerCapture(event.pointerId);
    const rect = selectedRect;
    cleanup();
    if (!rect || rect.width < 12 || rect.height < 12) return;

    const imageUrl = await capturePageRegion(rect).catch(() => '');
    if (!imageUrl) return;
    const centerElement = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    const nearby = cleanText(
      centerElement?.closest('p, pre, figure, section, article')?.textContent,
    ).slice(0, 1_200);
    const focus: FocusContext = {
      type: 'region',
      imageUrl,
      text: nearby,
      section: sectionFor(centerElement),
      source: 'screenshot',
    };
    showRegionPreview(imageUrl, () => {
      return sendRuntimeRequest({ type: 'focus:set', focus })
        .then(openAssistant)
        .catch(() => undefined);
    });
  });
  document.addEventListener('keydown', onKeyDown, true);
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    const runtimeGlobal = globalThis as RuntimeGlobal;
    if (runtimeGlobal[CONTENT_RUNTIME_KEY]) return;
    runtimeGlobal[CONTENT_RUNTIME_KEY] = true;

    const onMessage = (request: ContentRequest) => {
      switch (request.type) {
        case 'page:extract':
          return Promise.resolve(extractArticle(document, location.href));
        case 'assistant:open':
          window.setTimeout(
            () => openFloatingAssistant(request.activate !== false),
            0,
          );
          return Promise.resolve({ ok: true });
        case 'picker:image:start':
          startImagePicker(() => openFloatingAssistant(false));
          return Promise.resolve({ ok: true });
        case 'picker:region:start':
          startRegionPicker(() => openFloatingAssistant(false));
          return Promise.resolve({ ok: true });
      }
    };

    browser.runtime.onMessage.addListener(onMessage);
    const assistant = mountFloatingAssistant();
    const uninstallTextSelection = installTextSelection(
      () => openFloatingAssistant(false),
    );
    const uninstallImageDoubleClick = installImageDoubleClick(
      () => openFloatingAssistant(false),
    );

    const cleanup = () => {
      uninstallTextSelection();
      uninstallImageDoubleClick();
      browser.runtime.onMessage.removeListener(onMessage);
      assistant.removeEventIsolation();
      assistant.root.unmount();
      assistant.host.remove();
      delete runtimeGlobal[CONTENT_RUNTIME_KEY];
      window.removeEventListener('pagehide', onPageHide);
    };
    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) cleanup();
    };
    window.addEventListener('pagehide', onPageHide);
  },
});

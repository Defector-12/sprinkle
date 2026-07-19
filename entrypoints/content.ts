import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { extractArticle } from '../src/core/article-extractor.ts';
import type { FocusContext } from '../src/core/types.ts';
import type {
  ContentRequest,
  ExtensionRequest,
  RuntimeResult,
} from '../src/runtime/messages.ts';

const UI_ATTRIBUTE = 'data-context-reader-ui';

async function sendRuntime<T>(request: ExtensionRequest): Promise<T> {
  const response = (await browser.runtime.sendMessage(
    request,
  )) as RuntimeResult<T>;
  if (!response?.ok) {
    throw new Error(response?.error || '扩展后台没有响应');
  }
  return response.data;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function sectionFor(element: Element | null): string {
  if (!element) return cleanText(document.querySelector('h1')?.textContent);
  let section = cleanText(document.querySelector('h1')?.textContent);
  for (const heading of document.querySelectorAll(
    'h1, h2, h3, h4, h5, h6',
  )) {
    if (
      heading === element ||
      heading.compareDocumentPosition(element) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      section = cleanText(heading.textContent) || section;
      continue;
    }
    break;
  }
  return section || document.title;
}

function createSelectionButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute(UI_ATTRIBUTE, 'selection-button');
  button.textContent = '提问';
  Object.assign(button.style, {
    all: 'initial',
    position: 'fixed',
    zIndex: '2147483647',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    height: '32px',
    padding: '0 13px',
    border: '1px solid rgba(255,255,255,.2)',
    borderRadius: '999px',
    background: '#1f211f',
    color: '#fffaf1',
    boxShadow: '0 8px 28px rgba(30,22,15,.24)',
    font: '600 13px/1 "Avenir Next", sans-serif',
    cursor: 'pointer',
  });
  document.documentElement.append(button);
  return button;
}

function installTextSelection(): () => void {
  const button = createSelectionButton();
  let selectedText = '';
  let selectedElement: Element | null = null;

  const hide = () => {
    button.style.display = 'none';
  };

  const showForSelection = () => {
    const selection = window.getSelection();
    const text = cleanText(selection?.toString());
    if (!selection || selection.isCollapsed || text.length < 2) {
      hide();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const node = range.commonAncestorContainer;
    selectedElement =
      node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
    if (selectedElement?.closest(`[${UI_ATTRIBUTE}]`)) return;

    selectedText = text.slice(0, 4_000);
    button.style.left = `${Math.min(
      window.innerWidth - 74,
      Math.max(8, rect.left + rect.width / 2 - 30),
    )}px`;
    button.style.top = `${Math.max(8, rect.top - 42)}px`;
    button.style.display = 'inline-flex';
  };

  const onMouseUp = (event: MouseEvent) => {
    if ((event.target as Element | null)?.closest?.(`[${UI_ATTRIBUTE}]`)) {
      return;
    }
    window.setTimeout(showForSelection, 0);
  };

  const onButtonClick = async () => {
    const focus: FocusContext = {
      type: 'text',
      text: selectedText,
      section: sectionFor(selectedElement),
    };
    hide();
    await sendRuntime({ type: 'focus:set', focus }).catch(() => undefined);
  };

  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('scroll', hide, true);
  button.addEventListener('click', onButtonClick);

  return () => {
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('scroll', hide, true);
    button.removeEventListener('click', onButtonClick);
    button.remove();
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
  const screenshot = await sendRuntime<string>({ type: 'capture:visible' });
  const source = await loadImage(screenshot);
  const scaleX = source.naturalWidth / window.innerWidth;
  const scaleY = source.naturalHeight / window.innerHeight;
  const width = Math.max(1, Math.round(rect.width * scaleX));
  const height = Math.max(1, Math.round(rect.height * scaleY));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持截图裁剪');

  context.drawImage(
    source,
    Math.round(rect.left * scaleX),
    Math.round(rect.top * scaleY),
    width,
    height,
    0,
    0,
    width,
    height,
  );
  return canvas.toDataURL('image/png');
}

function startImagePicker(): void {
  let hovered: HTMLElement | null = null;
  let previousOutline = '';
  const previousCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = 'crosshair';

  const restoreHovered = () => {
    if (hovered) hovered.style.outline = previousOutline;
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
    const target = event.target as Element | null;
    const image =
      target?.closest('img') ??
      (target?.closest('figure')?.querySelector('img') as Element | null);
    restoreHovered();
    if (image instanceof HTMLElement) {
      hovered = image;
      previousOutline = image.style.outline;
      image.style.outline = '3px solid #e75a2c';
      image.style.outlineOffset = '4px';
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cleanup();
  };
  const onClick = async (event: MouseEvent) => {
    const target = event.target as Element | null;
    const image =
      target?.closest('img') ??
      (target?.closest('figure')?.querySelector('img') as Element | null);
    if (!(image instanceof HTMLImageElement)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = image.getBoundingClientRect();
    const section = sectionFor(image);
    const figure = image.closest('figure');
    const description = [
      image.alt,
      figure?.querySelector('figcaption')?.textContent,
      figure?.previousElementSibling?.textContent,
      figure?.nextElementSibling?.textContent,
    ]
      .map(cleanText)
      .filter(Boolean)
      .join(' ')
      .slice(0, 1_200);
    const source = image.currentSrc || image.src;
    cleanup();

    let imageUrl = source;
    let focusSource: 'original' | 'screenshot' = 'original';
    if (!imageUrl) {
      imageUrl = await cropVisibleScreenshot(rect);
      focusSource = 'screenshot';
    }

    await sendRuntime({
      type: 'focus:set',
      focus: {
        type: 'image',
        imageUrl,
        alt: cleanText(image.alt),
        text: description,
        section,
        source: focusSource,
      },
    }).catch(() => undefined);
  };

  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
}

function showRegionPreview(
  imageUrl: string,
  onConfirm: () => void,
): void {
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

  const close = () => backdrop.remove();
  cancel.addEventListener('click', close);
  confirm.addEventListener('click', () => {
    close();
    onConfirm();
  });
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  confirm.focus();
}

function startRegionPicker(): void {
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

    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const imageUrl = await cropVisibleScreenshot(rect).catch(() => '');
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
      void sendRuntime({ type: 'focus:set', focus }).catch(() => undefined);
    });
  });
  document.addEventListener('keydown', onKeyDown, true);
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    const uninstallTextSelection = installTextSelection();

    const onMessage = (request: ContentRequest) => {
      switch (request.type) {
        case 'page:extract':
          return Promise.resolve(extractArticle(document, location.href));
        case 'picker:image:start':
          startImagePicker();
          return Promise.resolve({ ok: true });
        case 'picker:region:start':
          startRegionPicker();
          return Promise.resolve({ ok: true });
      }
    };

    browser.runtime.onMessage.addListener(onMessage);
    window.addEventListener(
      'pagehide',
      () => {
        uninstallTextSelection();
        browser.runtime.onMessage.removeListener(onMessage);
      },
      { once: true },
    );
  },
});

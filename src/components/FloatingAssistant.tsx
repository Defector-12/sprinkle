import {
  Check,
  Image,
  KeyRound,
  LibraryBig,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  Minimize2,
  PanelsTopLeft,
  Power,
  RefreshCw,
  Scan,
  Send,
  Settings,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { ImageFocus, PageContext } from '../core/types.ts';
import {
  publishAssistantActive,
  subscribeAssistantOpen,
  type AssistantOpenDetail,
} from '../runtime/assistant-events.ts';
import { ArticleDiagnosticsPanel } from './ArticleDiagnosticsPanel.tsx';
import {
  AssistantMarkdown,
  messageAuthor,
  MessageReferenceCard,
} from './MessageContent.tsx';
import {
  imageFileFromClipboard,
  LOCAL_IMAGE_ACCEPT,
  readLocalImage,
} from './local-image.ts';
import { QuestionHistoryRail } from './QuestionHistoryRail.tsx';
import { useAutoGrowTextarea } from './use-auto-grow-textarea.ts';
import { useStreamedAnswer } from './use-streamed-answer.ts';

export interface FloatingAssistantBridge {
  initialize(): Promise<PageContext>;
  activate(): Promise<PageContext>;
  deactivate(): Promise<PageContext>;
  hasApiKey(): Promise<boolean>;
  ask(question: string): Promise<PageContext>;
  startImagePicker(): Promise<void>;
  startRegionPicker(): Promise<void>;
  setImageFocus(focus: ImageFocus): Promise<PageContext>;
  clearFocus(): Promise<PageContext>;
  openStudy(): Promise<void>;
  openHistory(): Promise<void>;
  openSettings(): Promise<void>;
  subscribe(listener: (context: PageContext) => void): () => void;
}

export interface FloatingAssistantProps {
  bridge: FloatingAssistantBridge;
}

const ORB_SIZE = 48;
const EDGE_MARGIN = 18;
const DIALOG_MARGIN = 12;
const DIALOG_GAP = 12;
const DIALOG_DEFAULT_WIDTH = 400;
const DIALOG_MIN_WIDTH = 300;
const DIALOG_MIN_HEIGHT = 260;
const DIALOG_MAX_WIDTH = 720;
const DIALOG_MAX_HEIGHT = 640;
const DRAG_THRESHOLD = 4;

interface OrbPosition {
  x: number;
  y: number;
}

interface DialogSize {
  width: number;
  height: number;
}

interface DialogPosition {
  x: number;
  y: number;
}

interface ViewportBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface DialogLayout {
  style: CSSProperties;
  opensBelow: boolean;
  growsLeft: boolean;
  maxWidth: number;
  maxHeight: number;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

function viewport(): ViewportBounds {
  if (typeof window === 'undefined') {
    return {
      left: 0,
      top: 0,
      width: 400,
      height: 800,
      right: 400,
      bottom: 800,
    };
  }

  const visual = window.visualViewport;
  const left = finiteOr(visual?.offsetLeft, 0);
  const top = finiteOr(visual?.offsetTop, 0);
  const width = Math.max(1, finiteOr(visual?.width, window.innerWidth));
  const height = Math.max(1, finiteOr(visual?.height, window.innerHeight));
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampOrb({ x, y }: OrbPosition): OrbPosition {
  const bounds = viewport();
  const minX = bounds.left + EDGE_MARGIN;
  const minY = bounds.top + EDGE_MARGIN;
  const maxX = Math.max(minX, bounds.right - ORB_SIZE - EDGE_MARGIN);
  const maxY = Math.max(minY, bounds.bottom - ORB_SIZE - EDGE_MARGIN);
  return {
    x: clamp(Number.isFinite(x) ? x : maxX, minX, maxX),
    y: clamp(Number.isFinite(y) ? y : maxY, minY, maxY),
  };
}

function defaultOrbPosition(): OrbPosition {
  const bounds = viewport();
  return clampOrb({ x: bounds.right, y: bounds.bottom });
}

function snapToEdge({ x, y }: OrbPosition): OrbPosition {
  const bounds = viewport();
  const center = x + ORB_SIZE / 2;
  const edgeX =
    center < bounds.left + bounds.width / 2
      ? bounds.left + EDGE_MARGIN
      : bounds.right - ORB_SIZE - EDGE_MARGIN;
  return clampOrb({ x: edgeX, y });
}

function dialogLayout(
  { x, y }: OrbPosition,
  requestedSize: DialogSize | null,
  requestedPosition: DialogPosition | null,
): DialogLayout {
  const bounds = viewport();
  const viewportWidth = Math.max(160, bounds.width - DIALOG_MARGIN * 2);
  const viewportHeight = Math.max(120, bounds.height - DIALOG_MARGIN * 2);

  if (requestedPosition && requestedSize) {
    const maxWidth = Math.min(DIALOG_MAX_WIDTH, viewportWidth);
    const maxHeight = Math.min(DIALOG_MAX_HEIGHT, viewportHeight);
    const width = clamp(
      requestedSize.width,
      Math.min(DIALOG_MIN_WIDTH, maxWidth),
      maxWidth,
    );
    const height = clamp(
      requestedSize.height,
      Math.min(DIALOG_MIN_HEIGHT, maxHeight),
      maxHeight,
    );
    const left = clamp(
      requestedPosition.x,
      bounds.left + DIALOG_MARGIN,
      Math.max(
        bounds.left + DIALOG_MARGIN,
        bounds.right - DIALOG_MARGIN - width,
      ),
    );
    const top = clamp(
      requestedPosition.y,
      bounds.top + DIALOG_MARGIN,
      Math.max(
        bounds.top + DIALOG_MARGIN,
        bounds.bottom - DIALOG_MARGIN - height,
      ),
    );

    return {
      opensBelow: true,
      growsLeft: left + width / 2 >= bounds.left + bounds.width / 2,
      maxWidth,
      maxHeight,
      style: {
        left,
        top,
        width,
        height,
        maxWidth,
        maxHeight,
      },
    };
  }

  const orbCenterX = x + ORB_SIZE / 2;
  const growsLeft = orbCenterX >= bounds.left + bounds.width / 2;
  const anchorLeft = Math.max(bounds.left + DIALOG_MARGIN, x);
  const anchorRight = Math.min(bounds.right - DIALOG_MARGIN, x + ORB_SIZE);
  const availableWidth = growsLeft
    ? anchorRight - (bounds.left + DIALOG_MARGIN)
    : bounds.right - DIALOG_MARGIN - anchorLeft;
  const maxWidth = Math.min(
    DIALOG_MAX_WIDTH,
    viewportWidth,
    Math.max(160, availableWidth),
  );
  const minWidth = Math.min(DIALOG_MIN_WIDTH, maxWidth);
  const width = clamp(
    requestedSize?.width ?? Math.min(DIALOG_DEFAULT_WIDTH, maxWidth),
    minWidth,
    maxWidth,
  );

  const spaceBelow =
    bounds.bottom - DIALOG_MARGIN - (y + ORB_SIZE + DIALOG_GAP);
  const spaceAbove = y - DIALOG_GAP - (bounds.top + DIALOG_MARGIN);
  const opensBelow = spaceBelow >= spaceAbove;
  const maxHeight = Math.min(
    DIALOG_MAX_HEIGHT,
    Math.max(120, opensBelow ? spaceBelow : spaceAbove),
  );
  const minHeight = Math.min(DIALOG_MIN_HEIGHT, maxHeight);
  const height = requestedSize
    ? clamp(requestedSize.height, minHeight, maxHeight)
    : undefined;

  const horizontalStyle: CSSProperties = growsLeft
    ? { right: Math.max(0, window.innerWidth - anchorRight) }
    : { left: anchorLeft };
  const verticalStyle: CSSProperties = opensBelow
    ? { top: y + ORB_SIZE + DIALOG_GAP }
    : { bottom: Math.max(0, window.innerHeight - (y - DIALOG_GAP)) };

  return {
    opensBelow,
    growsLeft,
    maxWidth,
    maxHeight,
    style: {
      ...horizontalStyle,
      ...verticalStyle,
      width,
      height,
      maxWidth,
      maxHeight,
    },
  };
}

function statusLabel(context: PageContext | null): string {
  switch (context?.status) {
    case 'unactivated':
      return '尚未启用';
    case 'parsing':
      return '正在理解页面';
    case 'answering':
      return '正在生成回答';
    case 'partial':
      return '部分内容已理解';
    case 'ready':
      return '页面内容已理解';
    case 'failed':
      return '页面理解失败';
    default:
      return '正在启动';
  }
}

interface StatusPanelProps {
  context: PageContext | null;
  hasApiKey: boolean | null;
  onOpenSettings: () => void;
  onOpenDiagnostics: () => void;
  onRetry: () => void;
}

function StatusPanel({
  context,
  hasApiKey,
  onOpenSettings,
  onOpenDiagnostics,
  onRetry,
}: StatusPanelProps) {
  const blockCount = context?.article?.blocks.length ?? 0;

  if (!context || context.status === 'parsing') {
    return (
      <div className="cr-state cr-state--loading" role="status" aria-live="polite">
        <LoaderCircle className="cr-spin" size={18} aria-hidden="true" />
        <div>
          <strong>正在理解页面内容</strong>
          <p>正在提取标题、段落和代码块</p>
          <div
            className="cr-progress"
            role="progressbar"
            aria-label="页面理解进度"
            aria-valuetext="正在分析"
          >
            <span />
          </div>
        </div>
      </div>
    );
  }

  if (context.status === 'failed') {
    return (
      <div className="cr-state cr-state--error" role="status" aria-live="polite">
        <RefreshCw size={18} aria-hidden="true" />
        <div>
          <strong>页面理解失败</strong>
          <p>{context.warning || '当前页面暂时无法读取。'}</p>
          <button type="button" onClick={onRetry}>
            重新理解页面
          </button>
        </div>
      </div>
    );
  }

  if (
    (context.status === 'ready' || context.status === 'partial') &&
    hasApiKey === false
  ) {
    return (
      <div className="cr-state cr-state--warning" role="status" aria-live="polite">
        <KeyRound size={18} aria-hidden="true" />
        <div>
          <strong>尚未配置 API Key</strong>
          <p>页面已经理解，填写 API Key 后即可提问。</p>
          <button type="button" onClick={onOpenSettings}>
            填写 API Key
          </button>
          {context.status === 'partial' && (
            <button type="button" onClick={onOpenDiagnostics}>
              查看读取诊断
            </button>
          )}
        </div>
      </div>
    );
  }

  if (context.status === 'answering') {
    return (
      <div className="cr-state cr-state--loading" role="status" aria-live="polite">
        <LoaderCircle className="cr-spin" size={18} aria-hidden="true" />
        <div>
          <strong>正在生成回答</strong>
          <p>页面上下文已经准备好，请稍候。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="cr-state cr-state--ready" role="status" aria-live="polite">
      <Check size={18} aria-hidden="true" />
      <div>
        <strong>
          {context.status === 'partial' ? '部分内容已理解' : '页面内容已理解'}
        </strong>
        <p>已读取 {blockCount} 个内容块，可以开始提问。</p>
        {context.status === 'partial' && (
          <button type="button" onClick={onOpenDiagnostics}>
            查看读取诊断
          </button>
        )}
      </div>
    </div>
  );
}

export function FloatingAssistant({ bridge }: FloatingAssistantProps) {
  const [context, setContext] = useState<PageContext | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [question, setQuestion] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isComposerMaximized, setIsComposerMaximized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orbPos, setOrbPos] = useState<OrbPosition>(() =>
    defaultOrbPosition(),
  );
  const [dialogSize, setDialogSize] = useState<DialogSize | null>(null);
  const [dialogPosition, setDialogPosition] =
    useState<DialogPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isMovingDialog, setIsMovingDialog] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const {
    target: streamingTarget,
    revealedCount,
    waitForAnswer,
    acceptAnswer,
    cancelAnswer,
    finishStreaming,
    visibleContent,
    isStreaming: isMessageStreaming,
  } = useStreamedAnswer();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const localImageInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const messagesRef = useRef<HTMLOListElement>(null);
  const messagesEndRef = useRef<HTMLLIElement>(null);
  const explicitActivationRef = useRef(false);
  const dragState = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const resizeState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    startRight: number;
    startWidth: number;
    startHeight: number;
    growsLeft: boolean;
    maxWidth: number;
    maxHeight: number;
  } | null>(null);
  const moveState = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const draggedRef = useRef(false);
  const layout = dialogLayout(orbPos, dialogSize, dialogPosition);
  useAutoGrowTextarea(inputRef, question, isComposerMaximized, 64);

  async function refreshApiKeyStatus() {
    try {
      setHasApiKey(await bridge.hasApiKey());
    } catch {
      setHasApiKey(false);
    }
  }

  async function activatePage() {
    explicitActivationRef.current = true;
    setIsVisible(true);
    setIsOpen(true);
    setError(null);
    setContext((current) =>
      current
        ? {
            ...current,
            status: 'parsing',
            warning: null,
          }
        : current,
    );
    void refreshApiKeyStatus();

    try {
      setContext(await bridge.activate());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '页面理解失败，请稍后重试。',
      );
    }
  }

  async function deactivatePage() {
    finishStreaming();
    setError(null);
    try {
      const nextContext = await bridge.deactivate();
      setContext(nextContext);
      setIsOpen(false);
      setIsVisible(false);
      setShowDiagnostics(false);
      setDialogSize(null);
      setDialogPosition(null);
      setQuestion('');
      setIsComposerMaximized(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '停止理解失败，请稍后重试。',
      );
    }
  }

  function closeDialog() {
    finishStreaming();
    setShowDiagnostics(false);
    setIsComposerMaximized(false);
    setIsOpen(false);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([bridge.initialize(), bridge.hasApiKey()])
      .then(([nextContext, nextHasApiKey]) => {
        if (!active || explicitActivationRef.current) return;
        setContext(nextContext);
        setHasApiKey(nextHasApiKey);
        setIsVisible(nextContext.status !== 'unactivated');
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : '无法读取当前页面');
        }
      });

    const unsubscribe = bridge.subscribe((nextContext) => {
      if (!active) return;
      acceptAnswer(nextContext);
      setContext(nextContext);
      setIsVisible(nextContext.status !== 'unactivated');
    });
    const openFromPage = (detail: AssistantOpenDetail) => {
      setIsVisible(true);
      setIsOpen(true);
      if (detail?.activate !== false) void activatePage();
      else void refreshApiKeyStatus();
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog();
    };
    const refreshAfterSettings = () => void refreshApiKeyStatus();

    const unsubscribeOpen = subscribeAssistantOpen(openFromPage);
    window.addEventListener('keydown', closeWithEscape);
    window.addEventListener('focus', refreshAfterSettings);

    return () => {
      active = false;
      unsubscribe();
      unsubscribeOpen();
      window.removeEventListener('keydown', closeWithEscape);
      window.removeEventListener('focus', refreshAfterSettings);
    };
  }, [acceptAnswer, bridge]);

  useEffect(() => {
    const enabled =
      isVisible && Boolean(context && context.status !== 'unactivated');
    publishAssistantActive(enabled);
  }, [context, isVisible]);

  useEffect(() => {
    const keepInView = () => setOrbPos((position) => clampOrb(position));
    const visual = window.visualViewport;
    window.addEventListener('resize', keepInView);
    visual?.addEventListener('resize', keepInView);
    visual?.addEventListener('scroll', keepInView);
    return () => {
      window.removeEventListener('resize', keepInView);
      visual?.removeEventListener('resize', keepInView);
      visual?.removeEventListener('scroll', keepInView);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isComposerMaximized, isOpen]);

  useEffect(() => {
    if (!isOpen || isComposerMaximized) return;
    messagesEndRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'end',
    });
  }, [context?.messages, isComposerMaximized, isOpen]);

  useEffect(() => {
    if (!isOpen || isComposerMaximized || !streamingTarget) return;
    messagesEndRef.current?.scrollIntoView?.({
      behavior: 'auto',
      block: 'end',
    });
  }, [isComposerMaximized, isOpen, revealedCount, streamingTarget]);

  async function sendQuestion() {
    const value = question.trim();
    if (!value || isSending || isUploadingImage) return;

    setIsSending(true);
    waitForAnswer(context);
    setError(null);
    setQuestion('');
    try {
      const nextContext = await bridge.ask(value);
      acceptAnswer(nextContext);
      setContext(nextContext);
    } catch (cause) {
      cancelAnswer();
      setError(cause instanceof Error ? cause.message : '问题发送失败');
    } finally {
      setIsSending(false);
    }
  }

  async function startImagePicker() {
    finishStreaming();
    setError(null);
    setIsOpen(false);
    try {
      await bridge.startImagePicker();
    } catch (cause) {
      setIsOpen(true);
      setError(cause instanceof Error ? cause.message : '无法开始选择图片');
    }
  }

  async function startRegionPicker() {
    finishStreaming();
    setError(null);
    setIsOpen(false);
    try {
      await bridge.startRegionPicker();
    } catch (cause) {
      setIsOpen(true);
      setError(cause instanceof Error ? cause.message : '无法开始框选区域');
    }
  }

  async function uploadLocalImage(file: File) {
    setIsUploadingImage(true);
    setError(null);
    try {
      const imageUrl = await readLocalImage(file);
      setContext(
        await bridge.setImageFocus({
          type: 'image',
          imageUrl,
          alt: file.name || '本地图片',
          text: file.name || '本地上传图片',
          section: '本地上传',
          source: 'upload',
        }),
      );
      inputRef.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法上传图片');
    } finally {
      setIsUploadingImage(false);
    }
  }

  async function clearFocus() {
    setError(null);
    try {
      setContext(await bridge.clearFocus());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法移除引用');
    }
  }

  function onOrbPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    dragState.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onOrbPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    state.moved = true;
    setIsDragging(true);
    setOrbPos(
      clampOrb({
        x: event.clientX - state.offsetX,
        y: event.clientY - state.offsetY,
      }),
    );
  }

  function endOrbDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const state = dragState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (state.moved) {
      draggedRef.current = true;
      setOrbPos((position) => snapToEdge(position));
    }
    setIsDragging(false);
  }

  function onOrbClick() {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setIsOpen(true);
  }

  function onResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    const bounds = viewport();
    const growsLeft = layout.growsLeft;
    const maxWidth = growsLeft
      ? rect.right - (bounds.left + DIALOG_MARGIN)
      : bounds.right - DIALOG_MARGIN - rect.left;
    const maxHeight = bounds.bottom - DIALOG_MARGIN - rect.top;
    resizeState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      startRight: rect.right,
      startWidth: rect.width,
      startHeight: rect.height,
      growsLeft,
      maxWidth: Math.min(DIALOG_MAX_WIDTH, maxWidth),
      maxHeight: Math.min(DIALOG_MAX_HEIGHT, maxHeight),
    };
    setDialogPosition({ x: rect.left, y: rect.top });
    setDialogSize({ width: rect.width, height: rect.height });
    setIsResizing(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onResizePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = resizeState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const widthDelta = event.clientX - state.startX;
    const heightDelta = event.clientY - state.startY;
    const minWidth = Math.min(DIALOG_MIN_WIDTH, state.maxWidth);
    const minHeight = Math.min(DIALOG_MIN_HEIGHT, state.maxHeight);
    const width = clamp(
      state.startWidth + (state.growsLeft ? -widthDelta : widthDelta),
      minWidth,
      state.maxWidth,
    );
    const height = clamp(
      state.startHeight + heightDelta,
      minHeight,
      state.maxHeight,
    );
    setDialogSize({
      width,
      height,
    });
    setDialogPosition({
      x: state.growsLeft ? state.startRight - width : state.startLeft,
      y: state.startTop,
    });
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>) {
    const state = resizeState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    resizeState.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    setIsResizing(false);
  }

  function onMovePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    moveState.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    setDialogPosition({ x: rect.left, y: rect.top });
    setDialogSize({ width: rect.width, height: rect.height });
    setIsMovingDialog(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function onMovePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = moveState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const bounds = viewport();
    setDialogPosition({
      x: clamp(
        event.clientX - state.offsetX,
        bounds.left + DIALOG_MARGIN,
        Math.max(
          bounds.left + DIALOG_MARGIN,
          bounds.right - DIALOG_MARGIN - state.width,
        ),
      ),
      y: clamp(
        event.clientY - state.offsetY,
        bounds.top + DIALOG_MARGIN,
        Math.max(
          bounds.top + DIALOG_MARGIN,
          bounds.bottom - DIALOG_MARGIN - state.height,
        ),
      ),
    });
  }

  function endDialogMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = moveState.current;
    if (!state || state.pointerId !== event.pointerId) return;
    moveState.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    setIsMovingDialog(false);
  }

  function moveDialogWithKeyboard(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    const step = event.shiftKey ? 32 : 16;
    let x = dialogPosition?.x ?? rect.left;
    let y = dialogPosition?.y ?? rect.top;
    if (event.key === 'ArrowRight') x += step;
    else if (event.key === 'ArrowLeft') x -= step;
    else if (event.key === 'ArrowDown') y += step;
    else if (event.key === 'ArrowUp') y -= step;
    else return;
    const bounds = viewport();
    event.preventDefault();
    setDialogSize({ width: rect.width, height: rect.height });
    setDialogPosition({
      x: clamp(
        x,
        bounds.left + DIALOG_MARGIN,
        Math.max(
          bounds.left + DIALOG_MARGIN,
          bounds.right - DIALOG_MARGIN - rect.width,
        ),
      ),
      y: clamp(
        y,
        bounds.top + DIALOG_MARGIN,
        Math.max(
          bounds.top + DIALOG_MARGIN,
          bounds.bottom - DIALOG_MARGIN - rect.height,
        ),
      ),
    });
  }

  function resizeWithKeyboard(
    event: ReactKeyboardEvent<HTMLDivElement>,
  ): void {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    const step = event.shiftKey ? 32 : 16;
    let width = dialogSize?.width ?? rect.width;
    let height = dialogSize?.height ?? rect.height;
    if (event.key === 'ArrowRight') width += step;
    else if (event.key === 'ArrowLeft') width -= step;
    else if (event.key === 'ArrowDown') height += step;
    else if (event.key === 'ArrowUp') height -= step;
    else return;
    event.preventDefault();
    const bounds = viewport();
    const growsLeft = layout.growsLeft;
    const maxWidth = growsLeft
      ? rect.right - (bounds.left + DIALOG_MARGIN)
      : bounds.right - DIALOG_MARGIN - rect.left;
    const maxHeight = bounds.bottom - DIALOG_MARGIN - rect.top;
    width = clamp(
      width,
      Math.min(DIALOG_MIN_WIDTH, maxWidth),
      Math.min(DIALOG_MAX_WIDTH, maxWidth),
    );
    height = clamp(
      height,
      Math.min(DIALOG_MIN_HEIGHT, maxHeight),
      Math.min(DIALOG_MAX_HEIGHT, maxHeight),
    );
    setDialogSize({ width, height });
    setDialogPosition({
      x: growsLeft ? rect.right - width : rect.left,
      y: rect.top,
    });
  }

  const isBusy =
    context?.status === 'parsing' ||
    context?.status === 'answering' ||
    isSending;
  const canAsk =
    hasApiKey === true &&
    (context?.status === 'ready' || context?.status === 'partial');
  const canSelectImage =
    context?.status === 'ready' || context?.status === 'partial';

  if (!isVisible) return null;

  if (!isOpen) {
    return (
      <button
        className={`cr-orb cr-orb--${context?.status ?? 'loading'}${
          isDragging ? ' cr-orb--dragging' : ''
        }`}
        type="button"
        style={{ left: orbPos.x, top: orbPos.y }}
        aria-label="打开 Context Reader"
        aria-controls="context-reader-dialog"
        aria-expanded="false"
        onPointerDown={onOrbPointerDown}
        onPointerMove={onOrbPointerMove}
        onPointerUp={endOrbDrag}
        onPointerCancel={endOrbDrag}
        onClick={onOrbClick}
      >
        {context?.status === 'parsing' ? (
          <LoaderCircle className="cr-spin" size={20} aria-hidden="true" />
        ) : (
          <MessageCircle size={20} strokeWidth={1.8} aria-hidden="true" />
        )}
        <span className="cr-orb__status" aria-hidden="true" />
      </button>
    );
  }

  const resizeCorner = `bottom-${layout.growsLeft ? 'left' : 'right'}`;

  return (
    <section
      ref={dialogRef}
      id="context-reader-dialog"
      className={`cr-dialog${isResizing ? ' cr-dialog--resizing' : ''}${
        isMovingDialog ? ' cr-dialog--moving' : ''
      }${isComposerMaximized ? ' cr-dialog--composer-maximized' : ''}`}
      role="dialog"
      aria-label="Context Reader 对话"
      onKeyDown={(event) => {
        if (event.key === 'Escape') closeDialog();
      }}
      style={{
        ...layout.style,
        ...(isComposerMaximized && !layout.style.height
          ? { height: layout.maxHeight }
          : {}),
      }}
    >
      <header className="cr-header">
        <div
          className="cr-header__identity cr-header__drag"
          role="button"
          aria-label="移动对话框"
          aria-description="拖动移动窗口，或使用方向键调整位置"
          title="拖动移动整个对话框"
          tabIndex={0}
          onPointerDown={onMovePointerDown}
          onPointerMove={onMovePointerMove}
          onPointerUp={endDialogMove}
          onPointerCancel={endDialogMove}
          onKeyDown={moveDialogWithKeyboard}
        >
          <span className="cr-mark" aria-hidden="true">
            C
          </span>
          <div className="cr-header__copy">
            <strong>Context Reader</strong>
            <span>{statusLabel(context)}</span>
          </div>
        </div>
        <div className="cr-header__actions">
          <button
            className="cr-icon-button"
            type="button"
            aria-label="打开学习记录"
            title="打开学习记录"
            onClick={() => void bridge.openHistory()}
          >
            <LibraryBig size={17} aria-hidden="true" />
          </button>
          <button
            className="cr-icon-button"
            type="button"
            aria-label="打开学习工作台"
            title="打开全页学习工作台"
            onClick={() => void bridge.openStudy()}
          >
            <PanelsTopLeft size={17} aria-hidden="true" />
          </button>
          <button
            className="cr-icon-button"
            type="button"
            aria-label="打开设置"
            onClick={() => void bridge.openSettings()}
          >
            <Settings size={17} aria-hidden="true" />
          </button>
          <button
            className="cr-icon-button"
            type="button"
            aria-label="停止理解当前页面"
            onClick={() => void deactivatePage()}
          >
            <Power size={17} aria-hidden="true" />
          </button>
          <button
            className="cr-icon-button"
            type="button"
            aria-label="收起 Context Reader"
            onClick={closeDialog}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      {showDiagnostics && context?.article ? (
        <ArticleDiagnosticsPanel
          article={context.article}
          onBack={() => setShowDiagnostics(false)}
          onRetry={() => {
            setShowDiagnostics(false);
            void activatePage();
          }}
        />
      ) : (
        <>
          {context?.focus && (
            <aside
              className={`cr-focus cr-focus--${context.focus.type}`}
              aria-label={
                context.focus.type === 'text'
                  ? '已引用的选中文字'
                  : '已引用的图片'
              }
            >
              {context.focus.type === 'text' ? (
                <>
                  <span>已引用</span>
                  <p>{context.focus.text}</p>
                </>
              ) : (
                <>
                  <img src={context.focus.imageUrl} alt="已引用图片预览" />
                  <div>
                    <strong>
                      {context.focus.type === 'image'
                        ? context.focus.alt ||
                          context.focus.text ||
                          '页面图片'
                        : context.focus.text || '框选区域'}
                    </strong>
                  </div>
                  <button
                    type="button"
                    aria-label="移除图片引用"
                    onClick={() => void clearFocus()}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </>
              )}
            </aside>
          )}

          <StatusPanel
            context={context}
            hasApiKey={hasApiKey}
            onOpenSettings={() => void bridge.openSettings()}
            onOpenDiagnostics={() => setShowDiagnostics(true)}
            onRetry={() => void activatePage()}
          />

          {context?.messages.length ? (
            <div className="cr-conversation">
              <ol
                ref={messagesRef}
                className="cr-messages"
                aria-label="当前页面对话"
              >
                {context.messages.map((message) => {
                  const isStreaming = isMessageStreaming(message);
                  const shownText = visibleContent(message);
                  return (
                    <li
                      className={`cr-message cr-message--${message.role}`}
                      key={message.id}
                      data-question-id={
                        message.role === 'user' ? message.id : undefined
                      }
                    >
                      <span>{messageAuthor(message)}</span>
                      <MessageReferenceCard reference={message.reference} />
                      {message.role === 'assistant' ? (
                        <AssistantMarkdown
                          content={shownText}
                          busy={isStreaming}
                          caretClassName="cr-stream-caret"
                        />
                      ) : (
                        <p className="message-plain">{shownText}</p>
                      )}
                    </li>
                  );
                })}
                <li
                  ref={messagesEndRef}
                  className="cr-messages__end"
                  aria-hidden="true"
                />
              </ol>
              <QuestionHistoryRail
                messages={context.messages}
                scrollContainerRef={messagesRef}
              />
            </div>
          ) : context?.status === 'parsing' ? (
        <div className="cr-understanding" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
          ) : (
        <div className="cr-empty">
          <p>
            {hasApiKey === false
              ? '配置后即可提问'
              : '从当前页面开始提问'}
          </p>
          <span>
            {hasApiKey === false
              ? 'API Key 只保存在这个浏览器中。'
              : '回答会结合已理解的页面内容。'}
          </span>
        </div>
          )}

          <div className="cr-feedback" aria-live="polite" aria-atomic="true">
        {error && (
          <p className="cr-error" role="alert">
            {error}
          </p>
        )}
        {!error && context?.warning && context.status !== 'failed' && (
          <p className="cr-warning">{context.warning}</p>
        )}
          </div>

          <div className="cr-composer-tools" aria-label="图片引用工具">
            <button
              type="button"
              aria-label="点选页面图片"
              disabled={!canSelectImage || isSending || isUploadingImage}
              onClick={() => void startImagePicker()}
            >
              <Image size={15} aria-hidden="true" />
              点选图片
            </button>
            <button
              type="button"
              aria-label="框选页面区域"
              disabled={!canSelectImage || isSending || isUploadingImage}
              onClick={() => void startRegionPicker()}
            >
              <Scan size={15} aria-hidden="true" />
              框选区域
            </button>
            <input
              ref={localImageInputRef}
              type="file"
              accept={LOCAL_IMAGE_ACCEPT}
              aria-label="选择本地图片文件"
              disabled={!canSelectImage || isSending || isUploadingImage}
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void uploadLocalImage(file);
              }}
            />
            <button
              type="button"
              aria-label={
                isUploadingImage ? '正在上传图片' : '上传本地图片'
              }
              title="上传本地图片"
              disabled={!canSelectImage || isSending || isUploadingImage}
              onClick={() => localImageInputRef.current?.click()}
            >
              {isUploadingImage ? (
                <LoaderCircle
                  className="cr-spin"
                  size={15}
                  aria-hidden="true"
                />
              ) : (
                <Upload size={15} aria-hidden="true" />
              )}
              上传图片
            </button>
          </div>

          <div className="cr-composer">
        <label className="cr-sr-only" htmlFor="context-reader-question">
          向当前文章提问
        </label>
        <textarea
          id="context-reader-question"
          ref={inputRef}
          rows={2}
          value={question}
          aria-expanded={isComposerMaximized}
          placeholder={
            hasApiKey === false
              ? '请先填写 DeepSeek API Key'
              : canAsk
                ? '输入问题…'
                : statusLabel(context)
          }
          disabled={!canAsk || isSending}
          onChange={(event) => setQuestion(event.target.value)}
          onPaste={(event) => {
            const file = imageFileFromClipboard(event.clipboardData);
            if (!file) return;
            event.preventDefault();
            if (!isUploadingImage) void uploadLocalImage(file);
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !isComposerMaximized &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void sendQuestion();
            }
          }}
        />
        <div className="cr-composer__actions">
          <button
            className="cr-composer__maximize"
            type="button"
            aria-label={
              isComposerMaximized ? '恢复输入框' : '最大化输入框'
            }
            aria-pressed={isComposerMaximized}
            title={isComposerMaximized ? '恢复输入框' : '最大化输入框'}
            onClick={() =>
              setIsComposerMaximized((current) => !current)
            }
          >
            {isComposerMaximized ? (
              <Minimize2 size={15} aria-hidden="true" />
            ) : (
              <Maximize2 size={15} aria-hidden="true" />
            )}
          </button>
          <button
            className="cr-send"
            type="button"
            aria-label="发送问题"
            disabled={
              !canAsk || isSending || isUploadingImage || !question.trim()
            }
            data-state={error ? 'error' : isSending ? 'loading' : 'default'}
            onClick={() => void sendQuestion()}
          >
            {isBusy ? (
              <LoaderCircle className="cr-spin" size={17} aria-hidden="true" />
            ) : (
              <Send size={16} aria-hidden="true" />
            )}
          </button>
        </div>
          </div>
        </>
      )}

      <div
        className={`cr-resize-handle cr-resize-handle--${resizeCorner}`}
        role="separator"
        aria-label="调整对话框大小"
        aria-description="拖动调整大小，或使用方向键调整宽高"
        title="拖动调整整个对话框大小"
        tabIndex={0}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onKeyDown={resizeWithKeyboard}
      />
    </section>
  );
}

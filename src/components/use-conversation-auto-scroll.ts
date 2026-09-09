import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

const SCROLL_KEYS = new Set([
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
  ' ',
]);

interface ConversationAutoScrollOptions {
  containerRef: RefObject<HTMLOListElement | null>;
  endRef: RefObject<HTMLLIElement | null>;
  enabled: boolean;
  messagesVersion: unknown;
  streamingId?: string;
  revealedCount: number;
}

export function useConversationAutoScroll({
  containerRef,
  endRef,
  enabled,
  messagesVersion,
  streamingId,
  revealedCount,
}: ConversationAutoScrollOptions) {
  const followsLatest = useRef(true);
  const wasEnabled = useRef(false);
  const draggingScrollbar = useRef(false);

  const pauseFollowing = useCallback(() => {
    followsLatest.current = false;
  }, []);

  const resumeFollowing = useCallback(() => {
    followsLatest.current = true;
  }, []);

  useEffect(() => {
    if (enabled && !wasEnabled.current) resumeFollowing();
    wasEnabled.current = enabled;
  }, [enabled, resumeFollowing]);

  useEffect(() => {
    if (!enabled || !followsLatest.current) return;
    endRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'end',
    });
  }, [enabled, endRef, messagesVersion]);

  useEffect(() => {
    if (!enabled || !streamingId || !followsLatest.current) return;
    endRef.current?.scrollIntoView?.({
      behavior: 'auto',
      block: 'end',
    });
  }, [enabled, endRef, revealedCount, streamingId]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLOListElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const scrollbarWidth = Math.max(
        12,
        container.offsetWidth - container.clientWidth,
      );
      draggingScrollbar.current =
        event.clientX >= bounds.right - scrollbarWidth;
    },
    [containerRef],
  );

  const finishPointerScroll = useCallback(() => {
    draggingScrollbar.current = false;
  }, []);

  return {
    resumeFollowing,
    scrollIntentHandlers: {
      onWheel: pauseFollowing,
      onTouchMove: pauseFollowing,
      onKeyDown: (event: KeyboardEvent<HTMLOListElement>) => {
        if (!event.altKey && !event.ctrlKey && !event.metaKey) {
          if (SCROLL_KEYS.has(event.key)) pauseFollowing();
        }
      },
      onPointerDown,
      onPointerUp: finishPointerScroll,
      onPointerCancel: finishPointerScroll,
      onScroll: () => {
        if (draggingScrollbar.current) pauseFollowing();
      },
    },
  };
}

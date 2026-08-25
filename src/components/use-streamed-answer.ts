import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChatMessage, PageContext } from '../core/types.ts';

const STREAM_INTERVAL_MS = 18;
const STREAM_STEP = 2;

interface StreamingTarget {
  id: string;
  content: string;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function useStreamedAnswer() {
  const previousAnswerId = useRef<string | null | undefined>(undefined);
  const [target, setTarget] = useState<StreamingTarget | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);

  const waitForAnswer = useCallback((context: PageContext | null) => {
    previousAnswerId.current =
      context?.messages.findLast((message) => message.role === 'assistant')
        ?.id ?? null;
  }, []);

  const cancelAnswer = useCallback(() => {
    previousAnswerId.current = undefined;
  }, []);

  const finishStreaming = useCallback(() => {
    previousAnswerId.current = undefined;
    setTarget(null);
  }, []);

  const acceptAnswer = useCallback((context: PageContext): boolean => {
    const answer = context.messages.at(-1);
    if (
      previousAnswerId.current === undefined ||
      answer?.role !== 'assistant' ||
      answer.id === previousAnswerId.current
    ) {
      return false;
    }

    previousAnswerId.current = undefined;
    setTarget({ id: answer.id, content: answer.content });
    setRevealedCount(
      prefersReducedMotion() ? answer.content.length : 0,
    );
    return true;
  }, []);

  useEffect(() => {
    if (!target || prefersReducedMotion()) return;
    let count = 0;
    const timer = window.setInterval(() => {
      count = Math.min(target.content.length, count + STREAM_STEP);
      setRevealedCount(count);
      if (count >= target.content.length) window.clearInterval(timer);
    }, STREAM_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [target]);

  useEffect(() => {
    const finishWhenHidden = () => {
      if (document.hidden) finishStreaming();
    };
    document.addEventListener('visibilitychange', finishWhenHidden);
    return () =>
      document.removeEventListener('visibilitychange', finishWhenHidden);
  }, [finishStreaming]);

  const visibleContent = useCallback(
    (message: ChatMessage): string =>
      target?.id === message.id
        ? message.content.slice(0, revealedCount)
        : message.content,
    [revealedCount, target],
  );

  const isStreaming = useCallback(
    (message: ChatMessage): boolean =>
      target?.id === message.id &&
      revealedCount < message.content.length,
    [revealedCount, target],
  );

  return {
    target,
    revealedCount,
    waitForAnswer,
    acceptAnswer,
    cancelAnswer,
    finishStreaming,
    visibleContent,
    isStreaming,
  };
}

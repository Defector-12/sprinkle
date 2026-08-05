import {
  useLayoutEffect,
  type RefObject,
} from 'react';

export function useAutoGrowTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
  maximized: boolean,
  minimumHeight: number,
): void {
  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;

    if (maximized) {
      textarea.style.height = '100%';
      textarea.style.overflowY = 'auto';
      return;
    }

    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(minimumHeight, textarea.scrollHeight)}px`;
    textarea.style.overflowY = 'hidden';
  }, [maximized, minimumHeight, ref, value]);
}

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';

import type { ChatMessage } from '../core/types.ts';

interface QuestionHistoryRailProps {
  messages: ChatMessage[];
  scrollContainerRef: RefObject<HTMLElement | null>;
}

interface QuestionHistoryItem {
  id: string;
  text: string;
}

const MIN_QUESTION_COUNT = 3;
const EXPAND_DELAY_MS = 180;

function questionElement(
  container: HTMLElement,
  questionId: string,
): HTMLElement | undefined {
  return Array.from(
    container.querySelectorAll<HTMLElement>('[data-question-id]'),
  ).find((element) => element.dataset.questionId === questionId);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function QuestionHistoryRail({
  messages,
  scrollContainerRef,
}: QuestionHistoryRailProps) {
  const questions = useMemo<QuestionHistoryItem[]>(
    () =>
      messages
        .filter((message) => message.role === 'user')
        .map((message) => ({
          id: message.id,
          text: message.content.replace(/\s+/g, ' ').trim(),
        }))
        .filter((question) => question.text),
    [messages],
  );
  const [expanded, setExpanded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(
    questions.at(-1)?.id ?? null,
  );
  const expandTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!questions.some((question) => question.id === activeId)) {
      setActiveId(questions.at(-1)?.id ?? null);
    }
  }, [activeId, questions]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || questions.length < MIN_QUESTION_COUNT) return;

    const updateActiveQuestion = () => {
      const bounds = container.getBoundingClientRect();
      const readingLine = bounds.top + bounds.height * 0.32;
      let currentId = questions[0]?.id ?? null;
      for (const question of questions) {
        const element = questionElement(container, question.id);
        if (!element || element.getBoundingClientRect().top > readingLine) {
          break;
        }
        currentId = question.id;
      }
      setActiveId(currentId);
    };

    updateActiveQuestion();
    container.addEventListener('scroll', updateActiveQuestion, {
      passive: true,
    });
    window.addEventListener('resize', updateActiveQuestion);
    return () => {
      container.removeEventListener('scroll', updateActiveQuestion);
      window.removeEventListener('resize', updateActiveQuestion);
    };
  }, [questions, scrollContainerRef]);

  useEffect(
    () => () => window.clearTimeout(expandTimer.current),
    [],
  );

  if (questions.length < MIN_QUESTION_COUNT) return null;

  const scheduleExpand = () => {
    window.clearTimeout(expandTimer.current);
    expandTimer.current = window.setTimeout(
      () => setExpanded(true),
      EXPAND_DELAY_MS,
    );
  };

  const collapse = () => {
    window.clearTimeout(expandTimer.current);
    setExpanded(false);
  };

  const navigateTo = (question: QuestionHistoryItem) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    questionElement(container, question.id)?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
    setActiveId(question.id);
  };

  return (
    <nav
      className="question-history"
      aria-label={`问题历史，共 ${questions.length} 个问题`}
      data-expanded={expanded}
      onMouseEnter={scheduleExpand}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) collapse();
      }}
      onFocusCapture={() => {
        window.clearTimeout(expandTimer.current);
        setExpanded(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) collapse();
      }}
    >
      <div className="question-history__surface">
        <ol className="question-history__list">
          {questions.map((question, index) => (
            <li key={question.id}>
              <button
                type="button"
                aria-label={`第 ${index + 1} 个问题：${question.text}`}
                aria-current={activeId === question.id ? 'location' : undefined}
                title={question.text}
                onClick={() => navigateTo(question)}
              >
                <span className="question-history__marker" aria-hidden="true" />
                <span className="question-history__label">{question.text}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuestionHistoryRail } from '../../src/components/QuestionHistoryRail.tsx';
import type { ChatMessage } from '../../src/core/types.ts';

function userMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'user',
    content,
    createdAt: Number(id.replace(/\D/g, '')),
  };
}

function assistantMessage(id: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content: 'Answer',
    createdAt: Number(id.replace(/\D/g, '')),
    answeredBy: 'deepseek',
  };
}

function Harness({ messages }: { messages: ChatMessage[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={containerRef} data-testid="messages">
        {messages.map((message) => (
          <div
            key={message.id}
            data-question-id={
              message.role === 'user' ? message.id : undefined
            }
          >
            {message.content}
          </div>
        ))}
      </div>
      <QuestionHistoryRail
        messages={messages}
        scrollContainerRef={containerRef}
      />
    </div>
  );
}

const history = [
  userMessage('question-1', 'What is working memory?'),
  assistantMessage('answer-1'),
  userMessage('question-2', 'How is it updated?'),
  assistantMessage('answer-2'),
  userMessage('question-3', 'Which tradeoffs matter?'),
];

describe('QuestionHistoryRail', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stays hidden until the conversation has at least three questions', () => {
    render(<Harness messages={history.slice(0, 3)} />);

    expect(
      screen.queryByRole('navigation', { name: /问题历史/ }),
    ).not.toBeInTheDocument();
  });

  it('expands after a short hover delay and collapses on leave', () => {
    vi.useFakeTimers();
    render(<Harness messages={history} />);
    const navigation = screen.getByRole('navigation', { name: /3 个问题/ });

    fireEvent.mouseEnter(navigation);
    act(() => vi.advanceTimersByTime(179));
    expect(navigation).toHaveAttribute('data-expanded', 'false');

    act(() => vi.advanceTimersByTime(1));
    expect(navigation).toHaveAttribute('data-expanded', 'true');

    fireEvent.mouseLeave(navigation);
    expect(navigation).toHaveAttribute('data-expanded', 'false');
  });

  it('scrolls the selected question into view and marks it active', () => {
    render(<Harness messages={history} />);
    const target = screen
      .getByTestId('messages')
      .querySelector<HTMLElement>('[data-question-id="question-2"]');
    if (!target) throw new Error('Question target is missing');
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    fireEvent.click(
      screen.getByRole('button', {
        name: '第 2 个问题：How is it updated?',
      }),
    );

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
    expect(
      screen.getByRole('button', {
        name: '第 2 个问题：How is it updated?',
      }),
    ).toHaveAttribute('aria-current', 'location');
  });
});

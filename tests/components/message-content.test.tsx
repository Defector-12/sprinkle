import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AssistantMarkdown } from '../../src/components/MessageContent.tsx';

describe('AssistantMarkdown', () => {
  it('does not load remote images from model-controlled Markdown', () => {
    const { container } = render(
      <AssistantMarkdown
        content="![tracking pixel](https://attacker.example/pixel)"
      />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('tracking pixel')).toBeVisible();
  });
});

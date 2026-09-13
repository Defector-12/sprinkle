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

  it('repairs detached list content before rendering Markdown', () => {
    const { container } = render(
      <AssistantMarkdown
        content={[
          '1.',
          '',
          '   **harness 的第一项工作：控制入口**',
          '',
          '   - 第一项',
          '',
          '   - 第二项',
        ].join('\n')}
      />,
    );

    const item = container.querySelector('ol > li');
    expect(item).not.toBeNull();
    expect(item).toHaveTextContent('harness 的第一项工作：控制入口');
    expect(item).toHaveTextContent('第一项');
    expect(item).toHaveTextContent('第二项');
    expect(container.querySelector('ol > li:empty')).toBeNull();
  });
});

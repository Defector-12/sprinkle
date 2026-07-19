import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  SettingsApp,
  type SettingsStore,
} from '../../src/components/SettingsApp.tsx';

function createStore(): SettingsStore {
  return {
    load: vi.fn().mockResolvedValue({
      apiKey: '',
      retainConversations: false,
    }),
    save: vi.fn().mockResolvedValue(undefined),
    clearConversations: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SettingsApp', () => {
  it('only exposes the API key and retention preference', async () => {
    const store = createStore();
    render(<SettingsApp store={store} />);

    const apiKey = await screen.findByLabelText('API Key');
    expect(apiKey).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('保留对话记录')).toBeVisible();
    expect(screen.queryByLabelText('模型')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API 地址')).not.toBeInTheDocument();
  });

  it('saves settings without exposing the key in status text', async () => {
    const store = createStore();
    render(<SettingsApp store={store} />);

    await userEvent.type(await screen.findByLabelText('API Key'), 'secret-key');
    await userEvent.click(screen.getByLabelText('保留对话记录'));
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(store.save).toHaveBeenCalledWith({
      apiKey: 'secret-key',
      retainConversations: true,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('设置已保存');
    expect(screen.getByRole('status')).not.toHaveTextContent('secret-key');
  });
});

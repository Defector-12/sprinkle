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
  it('exposes one DeepSeek key with the retention preference', async () => {
    const store = createStore();
    render(<SettingsApp store={store} />);

    expect(await screen.findByLabelText('DeepSeek API Key')).toHaveAttribute(
      'type',
      'password',
    );
    expect(screen.queryByLabelText('Doubao API Key')).not.toBeInTheDocument();
    expect(screen.getByLabelText('保存学习记录')).toBeVisible();
    expect(screen.queryByLabelText('模型')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('API 地址')).not.toBeInTheDocument();
  });

  it('saves settings without exposing the key in status text', async () => {
    const store = createStore();
    render(<SettingsApp store={store} />);

    await userEvent.type(
      await screen.findByLabelText('DeepSeek API Key'),
      'deepseek-key',
    );
    await userEvent.click(screen.getByLabelText('保存学习记录'));
    await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(store.save).toHaveBeenCalledWith({
      apiKey: 'deepseek-key',
      retainConversations: true,
    });
    expect(await screen.findByRole('status')).toHaveTextContent('设置已保存');
    expect(screen.getByRole('status')).not.toHaveTextContent('deepseek-key');
  });

  it('locks editable settings while a save is pending', async () => {
    let finishSave: (() => void) | undefined;
    const store = createStore();
    vi.mocked(store.save).mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
    );
    render(<SettingsApp store={store} />);
    const apiKey = await screen.findByLabelText('DeepSeek API Key');
    const retention = screen.getByLabelText('保存学习记录');

    await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(apiKey).toBeDisabled();
    expect(retention).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '清除全部学习记录' }),
    ).toBeDisabled();

    finishSave?.();
    expect(await screen.findByRole('status')).toHaveTextContent('设置已保存');
  });
});

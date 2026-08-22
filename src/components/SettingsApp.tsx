import { Check, Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { SyntheticEvent } from 'react';

import type { UserSettings } from '../core/types.ts';

export interface SettingsStore {
  load(): Promise<UserSettings>;
  save(settings: UserSettings): Promise<void>;
  clearConversations(): Promise<void>;
}

export interface SettingsAppProps {
  store: SettingsStore;
}

const DEFAULT_SETTINGS: UserSettings = {
  apiKey: '',
  retainConversations: false,
};

export function SettingsApp({ store }: SettingsAppProps) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [showKey, setShowKey] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void store
      .load()
      .then((storedSettings) => {
        if (active) setSettings(storedSettings);
      })
      .catch(() => {
        if (active) setError('无法读取本地设置');
      })
      .finally(() => {
        if (active) setLoaded(true);
      });

    return () => {
      active = false;
    };
  }, [store]);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus('');
    setError('');
    try {
      await store.save(settings);
      setStatus('设置已保存');
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  async function clearConversations() {
    setStatus('');
    setError('');
    try {
      await store.clearConversations();
      setStatus('本地对话记录已清除');
    } catch {
      setError('清除失败，请重试');
    }
  }

  return (
    <main className="settings-shell">
      <header className="settings-hero">
        <p className="eyebrow">Context Reader</p>
        <h1>设置你的阅读环境</h1>
        <p>
          API Key 只保存在这个浏览器中。文章正文、图片和截图不会进入长期存储。
        </p>
      </header>

      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        <section className="settings-section" aria-labelledby="model-heading">
          <div className="section-heading">
            <span className="section-number">01</span>
            <div>
              <h2 id="model-heading">模型访问</h2>
              <p>模型和接口由当前版本固定，你只需要提供访问密钥。</p>
            </div>
          </div>

          <div className="field-stack">
            <div className="field">
              <label htmlFor="api-key">DeepSeek API Key</label>
              <div className="input-frame">
                <KeyRound size={18} aria-hidden="true" />
                <input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  value={settings.apiKey}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!loaded}
                  aria-describedby="api-key-help"
                />
                <button
                  className="inline-icon-button"
                  type="button"
                  aria-label={
                    showKey
                      ? '隐藏 DeepSeek API Key'
                      : '显示 DeepSeek API Key'
                  }
                  onClick={() => setShowKey((current) => !current)}
                >
                  {showKey ? (
                    <EyeOff size={17} aria-hidden="true" />
                  ) : (
                    <Eye size={17} aria-hidden="true" />
                  )}
                </button>
              </div>
              <p id="api-key-help" className="field-help">
                文字与图片问题统一使用 DeepSeek 视觉模型。
              </p>
            </div>
          </div>
        </section>

        <section className="settings-section" aria-labelledby="privacy-heading">
          <div className="section-heading">
            <span className="section-number">02</span>
            <div>
              <h2 id="privacy-heading">会话与隐私</h2>
              <p>默认关闭长期记录，标签页关闭后清理临时上下文。</p>
            </div>
          </div>

          <label className="toggle-row" htmlFor="retain-conversations">
            <span>
              <strong>保留对话记录</strong>
              <small>只保存问答文本，不保存文章全文、图片或截图。</small>
            </span>
            <span className="switch">
              <input
                id="retain-conversations"
                type="checkbox"
                aria-label="保留对话记录"
                checked={settings.retainConversations}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    retainConversations: event.target.checked,
                  }))
                }
                disabled={!loaded}
              />
              <span aria-hidden="true" />
            </span>
          </label>

          <button
            className="danger-button"
            type="button"
            onClick={() => void clearConversations()}
          >
            <Trash2 size={17} aria-hidden="true" />
            清除全部本地对话
          </button>
        </section>

        <footer className="settings-actions">
          <div aria-live="polite" aria-atomic="true">
            {status && (
              <p className="save-status" role="status">
                <Check size={16} aria-hidden="true" />
                {status}
              </p>
            )}
            {error && (
              <p className="save-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <button
            className="primary-button"
            type="submit"
            disabled={!loaded || saving}
          >
            {saving ? '保存中' : '保存设置'}
          </button>
        </footer>
      </form>
    </main>
  );
}

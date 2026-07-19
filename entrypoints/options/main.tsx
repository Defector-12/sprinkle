import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SettingsApp } from '../../src/components/SettingsApp.tsx';
import { BrowserSettingsStore } from '../../src/runtime/settings-store.ts';
import '../../src/styles/base.css';
import '../../src/styles/options.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Options root element is missing');

createRoot(root).render(
  <StrictMode>
    <SettingsApp store={new BrowserSettingsStore()} />
  </StrictMode>,
);

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { HistoryLibrary } from '../../src/components/HistoryLibrary.tsx';
import { HistoryLibraryBridge } from '../../src/runtime/history-bridge.ts';
import '../../src/styles/base.css';
import '../../src/styles/library.css';

const root = document.querySelector('#root');
if (!root) throw new Error('History library root element is missing');

createRoot(root).render(
  <StrictMode>
    <HistoryLibrary bridge={new HistoryLibraryBridge()} />
  </StrictMode>,
);

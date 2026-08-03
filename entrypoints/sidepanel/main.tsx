import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SidePanelApp } from '../../src/components/SidePanelApp.tsx';
import { BrowserExtensionBridge } from '../../src/runtime/extension-bridge.ts';
import '../../src/styles/base.css';
import '../../src/styles/sidepanel.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Side panel root element is missing');

createRoot(root).render(
  <StrictMode>
    <SidePanelApp
      bridge={new BrowserExtensionBridge()}
      supportsVision
    />
  </StrictMode>,
);

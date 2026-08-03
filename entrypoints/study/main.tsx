import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { StudyWorkspace } from '../../src/components/StudyWorkspace.tsx';
import {
  parseStudyTarget,
  StudyWorkspaceBridge,
} from '../../src/runtime/study-bridge.ts';
import '../../src/styles/base.css';
import '../../src/styles/study.css';

const root = document.querySelector('#root');
if (!root) throw new Error('Study workspace root element is missing');

try {
  const target = parseStudyTarget(location.search);
  createRoot(root).render(
    <StrictMode>
      <StudyWorkspace bridge={new StudyWorkspaceBridge(target)} />
    </StrictMode>,
  );
} catch (cause) {
  root.textContent =
    cause instanceof Error ? cause.message : '学习工作台链接无效';
}

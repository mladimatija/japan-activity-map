import '../fonts.ts';
import './setup.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { registerTranslations } from '../i18n.ts';
import { httpApi } from './api.ts';
import { SetupApp } from './App.tsx';
import { SETUP_JA } from './i18n-ja-setup.ts';

// The setup page's Japanese lives in its own file, so the public site's bundle does not carry it.
registerTranslations(SETUP_JA);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <SetupApp api={httpApi} />
    </StrictMode>,
  );
}

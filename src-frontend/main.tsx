import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './services/i18nContext';
import { loadLocale } from './services/i18n';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

// Set before first paint so assistive tech and :lang() see the right language
// from the start, rather than after the provider's first effect.
document.documentElement.lang = loadLocale();

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <I18nProvider>
      <div className="app-container">
        <App />
      </div>
    </I18nProvider>
  </React.StrictMode>,
);

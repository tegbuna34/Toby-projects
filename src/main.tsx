import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { requestPersistence } from './db';
import { initSync } from './sync';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

requestPersistence();
initSync();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

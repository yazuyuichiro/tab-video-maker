import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// 画面のフォントは表示してから読み込む（読み込み中は代わりのフォントで表示）。書き出す動画のフォントは別（lib/renderer.ts）
void import('./fonts');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

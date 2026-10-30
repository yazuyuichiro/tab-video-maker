import { useState } from 'react';
import { Btn } from './ui';

const KEY = 'tab-video-maker:mobile-notice-closed';

/** スマホなど、指で操作する小さな画面か */
function isSmallTouch() {
  return window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 820;
}

/**
 * スマホで開いた人に、パソコン向けのアプリであることを知らせる（SNS から来た人向け）。
 * 「このまま使う」を押したら、次からは出さない。
 */
export function MobileNotice() {
  const [open, setOpen] = useState(() => {
    try {
      if (localStorage.getItem(KEY)) return false;
    } catch {
      // 読めない時は毎回出す
    }
    return isSmallTouch();
  });
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const url = `${location.origin}/`;
  const canShare = typeof navigator.share === 'function';
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // 保存できなくても閉じる
    }
    setOpen(false);
  };
  const share = async () => {
    if (canShare) {
      await navigator.share({ title: 'Tab動画メーカー', url }).catch(() => {});
      return;
    }
    await navigator.clipboard
      .writeText(url)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <div
      data-modal
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-notice-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-700 border-t-4 border-t-(--pedal) bg-zinc-900 p-5 shadow-2xl">
        <h2 id="mobile-notice-title" className="font-display text-lg">
          パソコンで開くのがおすすめです
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          Tab動画メーカーは、パソコンの Chrome / Edge 向けのアプリです。スマホでは画面が狭く操作しにくいうえ、動画の書き出しができないことがあります。
        </p>
        <p className="mt-2 text-sm text-zinc-400">あとでパソコンから開けるように、URL を自分に送っておくと便利です。</p>
        <p className="mt-3 rounded-md bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 select-all">{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="primary" onClick={() => void share()}>
            {canShare ? 'URL を送る' : copied ? 'コピーしました' : 'URL をコピー'}
          </Btn>
          <Btn onClick={close}>このまま使う</Btn>
        </div>
      </div>
    </div>
  );
}

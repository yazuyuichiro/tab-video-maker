import { useEffect, useRef } from 'react';

const CLIENT = import.meta.env.VITE_ADSENSE_CLIENT as string | undefined;

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * Google AdSense の広告枠。
 * VITE_ADSENSE_CLIENT / slot が未設定の時は、本番では何も表示せず、開発時は枠の位置だけ表示する。
 */
export function AdSlot({ slot, className = '' }: { slot: string | undefined; className?: string }) {
  const ref = useRef<HTMLModElement>(null);
  const enabled = !!CLIENT && !!slot;

  useEffect(() => {
    if (!enabled || !ref.current || ref.current.dataset.adsbygoogleStatus) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // 広告ブロッカー等で読み込めない場合は何もしない
    }
  }, [enabled]);

  if (!enabled) {
    if (!import.meta.env.DEV) return null;
    return (
      <div
        className={`flex h-[90px] items-center justify-center rounded-md border border-dashed border-zinc-700 text-xs text-zinc-600 ${className}`}
      >
        広告枠（.env の VITE_ADSENSE_CLIENT / VITE_ADSENSE_SLOT を設定すると表示されます）
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="mb-0.5 text-[10px] text-zinc-600">広告</div>
      <ins
        ref={ref}
        className="adsbygoogle block min-h-[90px]"
        data-ad-client={CLIENT}
        data-ad-slot={slot}
        data-ad-format="horizontal"
        data-full-width-responsive="true"
      />
    </div>
  );
}

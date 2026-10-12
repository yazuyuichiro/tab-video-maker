import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ComboOption {
  value: string;
  label: ReactNode;
  title?: string;
  className?: string;
}

interface Props {
  /** 表示テキスト */
  text: string;
  /** 直接入力（キー入力のたびに呼ばれる） */
  onText: (text: string) => void;
  /** 選択肢（あればクリックでパネルを開く） */
  options?: ComboOption[];
  onPick?: (value: string) => void;
  /** 選択パネルの列数 */
  columns?: number;
  /** 選択パネルの1マスの幅(px) */
  optionWidth?: number;
  row: number;
  col: number;
  className?: string;
  maxLength?: number;
  title?: string;
  onFocus?: () => void;
  onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
}

/**
 * エディタの1マス。文字の直接入力と、クリックで開く選択パネルの両方で入力できる。
 * data-row / data-col は矢印キーでのマス移動に使う。
 */
export function ComboCell({
  text,
  onText,
  options,
  onPick,
  columns = 4,
  optionWidth = 34,
  row,
  col,
  className = '',
  maxLength,
  title,
  onFocus,
  onPaste,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const panelW = columns * optionWidth + 8;

  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    const left = Math.max(4, Math.min(r.left, window.innerWidth - panelW - 4));
    const below = r.bottom + 2;
    // 下に入りきらなければ上に開く
    const estH = Math.ceil((options?.length ?? 0) / columns) * 30 + 10;
    const top = below + estH > window.innerHeight ? Math.max(4, r.top - estH - 2) : below;
    setPos({ left, top });
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, panelW, options, columns]);

  const pick = (v: string) => {
    onPick?.(v);
    setOpen(false);
  };

  return (
    <>
      <input
        ref={inputRef}
        data-row={row}
        data-col={col}
        value={text}
        maxLength={maxLength}
        title={title}
        spellCheck={false}
        autoComplete="off"
        className={`h-full w-full min-w-0 bg-transparent text-center outline-none focus:bg-sky-500/25 focus:ring-1 focus:ring-sky-400 ${className}`}
        onFocus={(e) => {
          e.target.select();
          onFocus?.();
        }}
        onBlur={() => setOpen(false)}
        // マスをまたぐドラッグは範囲選択に使うので、文字のドラッグ＆ドロップは無効にする
        onDragStart={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        // クリックで選択パネルを開閉（矢印キーでの移動時は開かない）
        onClick={() => options && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          } else if (options && (e.key === 'F4' || (e.altKey && e.key === 'ArrowDown'))) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          } else if (open && e.key.startsWith('Arrow')) {
            setOpen(false);
          }
        }}
        onChange={(e) => onText(e.target.value)}
        onPaste={onPaste}
      />
      {open &&
        options &&
        pos &&
        createPortal(
          <div
            className="fixed z-[60] grid gap-0.5 rounded-md border border-zinc-600 bg-zinc-900 p-1 shadow-xl"
            style={{ left: pos.left, top: pos.top, gridTemplateColumns: `repeat(${columns}, ${optionWidth}px)` }}
            // パネル操作中も入力欄のフォーカスを保つ
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                title={o.title}
                onClick={() => pick(o.value)}
                className={`h-7 truncate rounded px-0.5 text-xs font-bold hover:bg-sky-600 ${
                  o.value === text ? 'bg-amber-400 text-zinc-900' : 'bg-zinc-800 text-zinc-100'
                } ${o.className ?? ''}`}
              >
                {o.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

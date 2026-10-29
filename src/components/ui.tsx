import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'danger' | 'ghost' | 'accent';

// 色は index.css の変数から取る（画面上部の塗装面の上では、変数が塗装面用に切り替わる）
const RAISED = 'shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_1px_0_rgb(0_0_0/0.35)]';
const VARIANTS: Record<Variant, string> = {
  default: `bg-(--btn) hover:bg-(--btn-hover) text-(--btn-ink) border-(--btn-line) ${RAISED}`,
  primary: `bg-(--primary) hover:bg-(--primary-hover) text-(--primary-ink) border-(--primary) ${RAISED}`,
  accent: `bg-(--primary) hover:bg-(--primary-hover) text-(--primary-ink) border-(--primary) ${RAISED}`,
  danger: `bg-(--btn) hover:bg-red-700 text-red-300 hover:text-white border-(--btn-line) ${RAISED}`,
  ghost: 'bg-transparent hover:bg-(--btn) text-(--btn-ink) border-transparent',
};

/** オンの表示：沈んだ暗い面に、LED のように光る塗装色 */
export const ON_CLS =
  'bg-(--on) text-(--on-ink) border-black/40 hover:bg-black shadow-[inset_0_1px_3px_rgb(0_0_0/0.6)] [&_svg]:drop-shadow-[0_0_4px_var(--on-ink)]';

export function Btn({
  variant = 'default',
  active = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? ON_CLS : VARIANTS[variant]
      } ${className}`}
    />
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'max-w-3xl',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div data-modal className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        className={`flex max-h-[90vh] w-full ${width} flex-col overflow-hidden rounded-xl border border-zinc-700 border-t-4 border-t-(--pedal) bg-zinc-900 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-zinc-800 px-4 py-2.5">
          <h2 className="font-display text-base">{title}</h2>
          <button type="button" onClick={onClose} className="ml-auto text-xl leading-none text-zinc-400 hover:text-white">
            ×
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

/** フォーカスが外れた時 / Enter で確定する数値入力 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  className = '',
  title,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
  title?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = parseFloat(text);
    if (!Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    const v = Math.max(min, Math.min(max, n));
    setText(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      title={title}
      className={`w-16 rounded-md border border-(--field-line) bg-(--field) px-1.5 py-1 font-mono text-sm text-(--field-ink) tabular-nums ${className}`}
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-xs text-(--label)">{children}</span>;
}

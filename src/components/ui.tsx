import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'default' | 'primary' | 'danger' | 'ghost' | 'accent';

const VARIANTS: Record<Variant, string> = {
  default: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700',
  primary: 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500',
  accent: 'bg-sky-600 hover:bg-sky-500 text-white border-sky-500',
  danger: 'bg-zinc-800 hover:bg-red-700 text-red-300 hover:text-white border-zinc-700',
  ghost: 'bg-transparent hover:bg-zinc-800 text-zinc-300 border-transparent',
};

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
      className={`inline-flex items-center justify-center gap-1 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'border-amber-400 bg-amber-400 text-zinc-900 hover:bg-amber-300' : VARIANTS[variant]
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
        className={`flex max-h-[90vh] w-full ${width} flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center border-b border-zinc-800 px-4 py-2.5">
          <h2 className="font-bold">{title}</h2>
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
      className={`w-16 rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-sm tabular-nums ${className}`}
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
  return <span className="text-xs text-zinc-400">{children}</span>;
}

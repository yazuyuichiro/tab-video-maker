import { useState } from 'react';
import type { Span } from '../App';
import type { SongStore } from '../state/useSongStore';
import { RHYTHM_PRESETS } from '../lib/presets';
import { applyRhythmPreset, measuresInSpan } from '../lib/songOps';
import { Btn, Label, Modal } from './ui';

interface Props {
  store: SongStore;
  /** エディタの選択範囲（これを含む小節に入力する） */
  range: Span;
  onClose: () => void;
}

/** リズムパターンから音符とピッキングを自動入力する */
export function RhythmModal({ store, range, onClose }: Props) {
  const { song, update } = store;
  const [presetId, setPresetId] = useState(RHYTHM_PRESETS[3].id);
  const preset = RHYTHM_PRESETS.find((p) => p.id === presetId)!;
  const targets = measuresInSpan(song, range.start, range.end);
  const first = targets[0] + 1;
  const last = targets[targets.length - 1] + 1;

  const apply = () => {
    update((d) => {
      for (const i of targets) applyRhythmPreset(d.measures[i], preset, d.timeSignature);
    });
    onClose();
  };

  return (
    <Modal
      title="リズムの自動作成"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Btn onClick={onClose}>キャンセル</Btn>
          <Btn variant="primary" onClick={apply}>
            TAB譜に入力
          </Btn>
        </>
      }
    >
      <div className="grid gap-1.5">
        {RHYTHM_PRESETS.map((p) => (
          <label
            key={p.id}
            className={`flex cursor-pointer items-center gap-3 rounded-md border px-2.5 py-1.5 ${
              p.id === presetId ? 'border-amber-400 bg-amber-400/10' : 'border-zinc-800 hover:border-zinc-600'
            }`}
          >
            <input
              type="radio"
              className="accent-amber-400"
              checked={p.id === presetId}
              onChange={() => setPresetId(p.id)}
            />
            <span className="w-48 shrink-0 text-sm">{p.name}</span>
            <PatternPreview pattern={p.pattern} div={p.div} />
          </label>
        ))}
      </div>
      <div className="mt-4 rounded-lg bg-zinc-950 p-2.5 text-sm">
        <Label>入力先（エディタで選択中の範囲を含む小節）</Label>
        <div className="mt-0.5 font-bold text-sky-200">{first === last ? `${first}小節目` : `${first}〜${last}小節目`}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          各小節のコード（「コードから作成」で入力した押さえ方）を使ってフレットも入力します。分割はパターンに合わせて変わり、歌詞はそのまま残ります。
        </p>
      </div>
    </Modal>
  );
}

function PatternPreview({ pattern, div }: { pattern: string; div: number }) {
  return (
    <span className="flex flex-wrap gap-y-0.5 font-mono text-[11px]">
      {Array.from(pattern).map((c, i) => {
        const label = c === 'D' || c === 'A' ? '⊓' : c === 'U' || c === 'a' ? 'V' : c === 'd' ? '⊓' : c === 'u' ? 'V' : '·';
        return (
          <span
            key={i}
            className={`flex h-5 w-5 items-center justify-center ${i % div === 0 ? 'ml-1.5' : ''} ${
              c === '.' ? 'text-zinc-600' : c === 'd' || c === 'u' ? 'rounded bg-zinc-800 text-red-300' : 'rounded bg-zinc-800 text-zinc-200'
            }`}
            title={c === 'd' || c === 'u' ? 'ブラッシング（ミュート）' : undefined}
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}

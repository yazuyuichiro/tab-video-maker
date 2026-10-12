import { useMemo, useState } from 'react';
import type { Span } from '../App';
import type { SongStore } from '../state/useSongStore';
import { COMMON_QUALITIES, ROOTS, fretsToShapeString, generateVoicings, parseChord } from '../lib/chords';
import { applyChordToSpan } from '../lib/songOps';
import { locateTick, positionLabel } from '../lib/timing';
import { ChordDiagram } from './ChordDiagram';
import { Btn, Label, Modal } from './ui';

interface Props {
  store: SongStore;
  /** 入力先（エディタの選択範囲） */
  range: Span;
  onClose: () => void;
}

function splitName(name: string) {
  const m = /^([A-Ga-g][#b♯♭]?)([^/]*)(\/.*)?$/.exec(name.trim());
  if (!m) return { root: '', quality: name, slash: '' };
  return { root: m[1], quality: m[2], slash: m[3] ?? '' };
}

/** コード名から押さえ方を選び、エディタの選択範囲へ自動入力する */
export function ChordModal({ store, range, onClose }: Props) {
  const { song, update } = store;
  const startMeasure = song.measures[locateTick(song, range.start).measure];
  const [name, setName] = useState(startMeasure.chordName ?? 'Am');
  const [chosen, setChosen] = useState(0);
  const parsed = parseChord(name);
  const voicings = useMemo(() => generateVoicings(name), [name]);
  const parts = splitName(name);
  const startLabel = positionLabel(song, range.start);
  const endLabel = positionLabel(song, range.end - 1);

  const changeName = (v: string) => {
    setName(v);
    setChosen(0);
  };

  const apply = (idx = chosen) => {
    const v = voicings[idx];
    if (!v || !parsed) return;
    update((d) => applyChordToSpan(d, range.start, range.end, v.frets, name.trim()));
    onClose();
  };

  return (
    <Modal
      title="コードから作成"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>キャンセル</Btn>
          <Btn variant="primary" disabled={!voicings.length} onClick={() => apply()}>
            TAB譜に入力
          </Btn>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label>コード名</Label>
        <input
          className={`w-32 rounded-md border bg-zinc-950 px-2 py-1 text-base font-bold ${
            parsed ? 'border-zinc-700 text-amber-300' : 'border-red-500 text-red-300'
          }`}
          value={name}
          onChange={(e) => changeName(e.target.value)}
          placeholder="例: Am7, C/G"
          autoFocus
        />
        {!parsed && <span className="text-xs text-red-400">認識できないコード名です</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {ROOTS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => changeName(r + parts.quality + parts.slash)}
            className={`h-7 min-w-8 rounded border px-1 text-xs font-bold ${
              parts.root === r ? 'border-amber-400 bg-amber-400 text-zinc-900' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700'
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {COMMON_QUALITIES.map((q) => (
          <button
            key={q || 'maj'}
            type="button"
            onClick={() => changeName((parts.root || 'C') + q + parts.slash)}
            className={`h-7 min-w-8 rounded border px-1.5 text-xs ${
              parts.quality === q ? 'border-sky-400 bg-sky-500 text-white' : 'border-zinc-700 bg-zinc-800 hover:bg-zinc-700'
            }`}
          >
            {q || 'M'}
          </button>
        ))}
      </div>

      <div className="mt-3 text-xs text-zinc-400">押さえ方を選択</div>
      <div className="mt-1 flex flex-wrap gap-2">
        {voicings.map((v, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setChosen(i)}
            onDoubleClick={() => apply(i)}
            className={`flex flex-col items-center rounded-md border px-1.5 pt-1 pb-1.5 text-zinc-200 ${
              i === chosen ? 'border-amber-400 bg-amber-400/10' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-500'
            }`}
          >
            <ChordDiagram frets={v.frets} baseFret={v.baseFret} />
            <span className="font-mono text-[11px] text-zinc-300">{fretsToShapeString(v.frets)}</span>
            <span className="max-w-24 text-center text-[10px] leading-tight text-zinc-500">{v.label}</span>
          </button>
        ))}
        {parsed && voicings.length === 0 && <p className="text-xs text-zinc-500">押さえ方が見つかりませんでした</p>}
      </div>

      <div className="mt-4 rounded-lg bg-zinc-950 p-2.5 text-sm">
        <Label>入力先（エディタで選択中の範囲）</Label>
        <div className="mt-0.5 font-bold text-sky-200">{startLabel === endLabel ? startLabel : `${startLabel} 〜 ${endLabel}`}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
          範囲内にすでに音符があればそのフレットを差し替え、無ければ先頭に1つ入力します。小節を丸ごと選んだ場合はその小節のコードとして登録され、「リズムの自動作成」で使われます。
        </p>
      </div>
    </Modal>
  );
}

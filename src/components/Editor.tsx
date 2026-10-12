import { useState, type ReactNode } from 'react';
import type { StringSel } from '../types';
import type { EditorCommands, Span } from '../App';
import type { SongStore } from '../state/useSongStore';
import { CHORD_EXPANSIONS, deleteMeasures, insertMeasure, setMeasureCount } from '../lib/songOps';
import { positionLabel } from '../lib/timing';
import { ChordModal } from './ChordModal';
import { RhythmModal } from './RhythmModal';
import { TabGrid } from './TabGrid';
import { Btn, NumberField } from './ui';

interface Props {
  store: SongStore;
  measureIdx: number;
  onMeasureChange: (idx: number) => void;
  range: Span;
  strings: StringSel;
  onSelect: (span: Span, strings: StringSel, extend?: boolean) => void;
  onMove: (dest: number) => void;
  cmd: EditorCommands;
}

/** パレットのボタン（ツールチップにショートカットを表示） */
function P({ children, keys, title, onClick, disabled }: { children: ReactNode; keys: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={`${title}（${keys}）`}
      onClick={onClick}
      className="flex h-6 items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 text-xs text-zinc-100 hover:bg-zinc-700 disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-zinc-500">{label}</span>
      {children}
    </div>
  );
}

export function Editor({ store, measureIdx, onMeasureChange, range, strings, onSelect, onMove, cmd }: Props) {
  const { song, update } = store;
  const total = song.measures.length;
  const [modal, setModal] = useState<'chord' | 'rhythm' | null>(null);
  const startLabel = positionLabel(song, range.start);
  const endLabel = positionLabel(song, range.end - 1);
  const stringLabel = strings ? (strings.length === 1 ? `${strings[0]}弦` : `${strings[0]}〜${strings[strings.length - 1]}弦`) : '全弦';

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-2">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <h2 className="mr-1 text-sm font-bold">エディタ</h2>
        <Btn onClick={() => onMeasureChange(measureIdx - 1)} disabled={measureIdx === 0} title="前の小節">
          ◀
        </Btn>
        <NumberField
          value={measureIdx + 1}
          min={1}
          max={total}
          className="w-12 text-center"
          title="表示中の小節"
          onChange={(v) => onMeasureChange(Math.round(v) - 1)}
        />
        <span className="text-sm text-zinc-500">/</span>
        <NumberField
          value={total}
          min={1}
          max={999}
          className="w-12 text-center"
          title="総小節数"
          onChange={(v) => {
            if (v < total && !confirm(`末尾の${total - v}小節を削除します。よろしいですか？`)) return;
            update((d) => setMeasureCount(d, v));
            if (measureIdx >= v) onMeasureChange(v - 1);
          }}
        />
        <span className="text-xs text-zinc-500">小節</span>
        <Btn onClick={() => onMeasureChange(measureIdx + 1)} disabled={measureIdx >= total - 1} title="次の小節">
          ▶
        </Btn>
        <Btn
          title="この小節の後ろに空の小節を追加"
          onClick={() => {
            update((d) => insertMeasure(d, measureIdx + 1));
            onMeasureChange(measureIdx + 1);
          }}
        >
          小節追加
        </Btn>
        <Btn
          variant="danger"
          title="表示中の小節を削除"
          onClick={() => {
            if (!confirm(`${measureIdx + 1}小節目を削除します。よろしいですか？`)) return;
            update((d) => deleteMeasures(d, measureIdx, measureIdx));
            onMeasureChange(Math.min(measureIdx, total - 2));
          }}
        >
          小節削除
        </Btn>
        <span
          className="ml-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-200 tabular-nums"
          title="拍番号のクリック・ドラッグで選択、Shift+クリックで範囲を広げる。弦のマスをドラッグすると弦も含めて範囲選択"
        >
          選択: {startLabel === endLabel ? startLabel : `${startLabel} 〜 ${endLabel}`}（{stringLabel}）
        </span>

        <div className="ml-auto flex gap-1.5">
          <Btn variant="accent" onClick={() => setModal('chord')}>
            コードから作成
          </Btn>
          <Btn variant="accent" onClick={() => setModal('rhythm')}>
            リズムの自動作成
          </Btn>
        </div>
      </div>

      {/* 操作パレット */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-zinc-950/60 px-2 py-1">
        <Group label="編集">
          <P keys="Ctrl+D" title="選択範囲を右隣に複製" onClick={cmd.duplicate}>右に複製</P>
          <P keys="Del" title="選択範囲を消去（弦を選んでいる時はその弦のフレットだけ）" onClick={cmd.clear}>削除</P>
        </Group>
        <Group label="分割">
          <P keys="E / +" title="選択した拍の分割を細かくする" onClick={() => cmd.split(false)}>分割</P>
          <P keys="Shift+E" title="フレットを複製しながら分割" onClick={() => cmd.split(true)}>複製分割</P>
          <P keys="Q / −" title="選択した拍の分割を粗くする" onClick={cmd.merge}>統合</P>
        </Group>
        <Group label="フレット">
          <P keys="A" title="フレットを1つ下げる" onClick={() => cmd.fretShift(-1)}>−1</P>
          <P keys="D" title="フレットを1つ上げる" onClick={() => cmd.fretShift(1)}>＋1</P>
          <P keys="Alt+↑" title="同じ音のまま1弦側の弦へ移動" onClick={() => cmd.stringMove(-1)}>弦↑</P>
          <P keys="Alt+↓" title="同じ音のまま6弦側の弦へ移動" onClick={() => cmd.stringMove(1)}>弦↓</P>
        </Group>
        <select
          className="h-6 rounded border border-zinc-700 bg-zinc-800 px-1 text-xs"
          value=""
          title="置いた音（一番低い音）をルートにして、選択範囲の音符をコードに展開"
          onChange={(e) => {
            const x = CHORD_EXPANSIONS.find((c) => c.id === e.target.value);
            if (x) cmd.expandChord(x.intervals);
          }}
        >
          <option value="">コード展開…</option>
          {CHORD_EXPANSIONS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <TabGrid
        store={store}
        measureIdx={measureIdx}
        range={range}
        strings={strings}
        onSelect={onSelect}
        onMove={onMove}
        onMeasureChange={onMeasureChange}
      />
      <p className="mt-1 text-[10px] text-zinc-500">
        拍番号のクリック・ドラッグで範囲選択（Shift+クリックで延長、別の小節へも可）／弦のマスをドラッグ（縦方向で同じタイミングの複数弦）またはShift+↑↓で弦も含めた範囲選択 → 数字キーで一括入力・Ctrl+C/Vで弦ごとコピー（選択した一番上の弦に合わせて貼り付け）／マスをダブルクリックで全弦、トリプルクリックで小節を選択／複数マスの選択は拍番号をつかんで移動／歌詞欄に文章を貼り付けると1文字ずつ割り当て
      </p>

      {modal === 'chord' && <ChordModal store={store} range={range} onClose={() => setModal(null)} />}
      {modal === 'rhythm' && <RhythmModal store={store} range={range} onClose={() => setModal(null)} />}
    </section>
  );
}

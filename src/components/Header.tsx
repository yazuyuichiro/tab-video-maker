import { useRef } from 'react';
import type { Song } from '../types';
import { BACKGROUNDS, VIDEO_HEIGHTS, VIDEO_WIDTH } from '../types';
import type { SongStore } from '../state/useSongStore';
import { exportSongJson, importSongJson } from '../lib/storage';
import { setTimeSignature } from '../lib/songOps';
import { Btn, Label, NumberField } from './ui';

const TIME_SIGNATURES = ['4/4', '3/4', '2/4', '6/8', '5/4', '12/8'];
const selectCls = 'rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-sm';

interface Props {
  store: SongStore;
  onExport: () => void;
}

export function Header({ store, onExport }: Props) {
  const { song, update } = store;
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Song>(key: K, value: Song[K]) =>
    update((d) => {
      d[key] = value;
    });

  return (
    <header className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-1.5">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="h-6 w-6 shrink-0">
            <rect width="32" height="32" rx="6" fill="#18181b" stroke="#52525b" />
            <g stroke="#fff" strokeWidth="1.5">
              <path d="M4 9h24M4 14h24M4 19h24M4 24h24" />
            </g>
            <path d="M12 5v24" stroke="#ff2a2a" strokeWidth="3" />
          </svg>
          <span className="text-sm font-bold whitespace-nowrap">Tab動画メーカー</span>
        </div>
        <input
          className="w-44 min-w-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
          value={song.title}
          placeholder="曲名"
          onChange={(e) => update((d) => void (d.title = e.target.value), 'title')}
        />
        <label className="flex items-center gap-1">
          <Label>BPM</Label>
          <NumberField value={song.bpm} min={30} max={300} className="w-14" onChange={(v) => set('bpm', Math.round(v))} />
        </label>
        <label className="flex items-center gap-1">
          <Label>拍子</Label>
          <select
            className={selectCls}
            value={song.timeSignature}
            onChange={(e) => {
              const ts = e.target.value;
              update((d) => setTimeSignature(d, ts));
            }}
          >
            {TIME_SIGNATURES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <Label>サイズ</Label>
          <select className={selectCls} value={song.height} onChange={(e) => set('height', Number(e.target.value) as Song['height'])}>
            {VIDEO_HEIGHTS.map((h) => (
              <option key={h} value={h}>
                {VIDEO_WIDTH}×{h}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <Label>背景</Label>
          {BACKGROUNDS.map((b) => (
            <button
              key={b.value}
              type="button"
              onClick={() => set('backgroundColor', b.value)}
              className={`flex h-7 items-center gap-1 rounded-md border px-1.5 text-xs ${
                song.backgroundColor === b.value ? 'border-amber-400 ring-1 ring-amber-400' : 'border-zinc-700'
              }`}
            >
              <span className="h-3.5 w-3.5 rounded-sm border border-zinc-500" style={{ background: b.value }} />
              {b.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1" title="1画面に表示する小節数。赤線が右端に着いたら次のページへ切り替わります">
          <Label>1ページ</Label>
          <select className={selectCls} value={song.measuresPerPage} onChange={(e) => set('measuresPerPage', Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}小節
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto flex items-center gap-1.5">
          <Btn variant="ghost" onClick={store.undo} disabled={!store.canUndo} title="元に戻す (Ctrl+Z)">
            ↶
          </Btn>
          <Btn variant="ghost" onClick={store.redo} disabled={!store.canRedo} title="やり直し (Ctrl+Y)">
            ↷
          </Btn>
          <Btn
            onClick={() => {
              if (confirm('新しい曲を作成します。現在の曲は「元に戻す」で復元できます。')) store.newSong();
            }}
          >
            新規
          </Btn>
          <Btn onClick={() => fileRef.current?.click()} title="保存したJSONファイルを読み込む">
            読込
          </Btn>
          <Btn onClick={() => exportSongJson(song)} title="曲データをJSONファイルに保存">
            保存
          </Btn>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                store.replace(await importSongJson(f));
              } catch (err) {
                alert(`読み込みに失敗しました: ${(err as Error).message}`);
              }
            }}
          />
          <Btn variant="primary" onClick={onExport}>
            MP4出力
          </Btn>
        </div>
      </div>
    </header>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Nuance, StringNo, StringSel } from './types';
import { TPQ } from './types';
import { useSongStore } from './state/useSongStore';
import {
  buildTimeline,
  locateTick,
  measureCells,
  measureTicks,
  pageCount,
  pageOfMeasure,
  pageRange,
  quarterToSec,
  secToQuarter,
} from './lib/timing';
import {
  applyToNotesInRange,
  clearRange,
  copyRange,
  copyStrings,
  expandChordInRange,
  findNote,
  mergeInRange,
  moveRange,
  moveToAdjacentString,
  pasteClip,
  pasteRhythm,
  pasteStrings,
  setFretInRange,
  setNuance,
  setPicking,
  setRest,
  setStrum,
  shiftFrets,
  shiftStringSel,
  splitInRange,
  type Clip,
} from './lib/songOps';
import { Header } from './components/Header';
import { Preview, type PlayStart } from './components/Preview';
import { Editor } from './components/Editor';
import { ExportDialog } from './components/ExportDialog';
import { HelpDialog } from './components/HelpDialog';
import { MobileNotice } from './components/MobileNotice';
import { AdSlot } from './components/AdSlot';

/** 選択範囲（曲頭からの通し tick） */
export interface Span {
  start: number;
  end: number;
}

/** エディタ操作（キーボードとパレットのボタンで共通） */
export interface EditorCommands {
  copy: () => void;
  cut: () => void;
  paste: () => void;
  pasteRhythm: () => void;
  duplicate: () => void;
  clear: () => void;
  split: (duplicate: boolean) => void;
  merge: () => void;
  picking: (p: 'down' | 'up') => void;
  rest: () => void;
  nuance: (n: Exclude<Nuance, null>) => void;
  strum: (dir: 'up' | 'down') => void;
  fretShift: (delta: number) => void;
  /** 戻り値は移動後の選択弦 */
  stringMove: (dir: -1 | 1) => StringSel;
  expandChord: (intervals: number[]) => void;
  hasClip: boolean;
}

const NUANCE_KEYS: Record<string, Exclude<Nuance, null>> = {
  h: 'hammer',
  p: 'pull',
  s: 'slide',
  c: 'choke',
  b: 'hc',
  m: 'mute',
  t: 'tie',
  l: 'slur',
};

export default function App() {
  const store = useSongStore();
  const { song, update } = store;
  const timeline = useMemo(() => buildTimeline(song), [song]);
  const ts = song.timeSignature;
  const mt = measureTicks(ts);

  const [measureIdx, setMeasureIdx] = useState(0);
  // anchor = 選択の起点、head = Shift+クリック/ドラッグで伸ばした先、strings = 選択中の弦（null=全弦）
  const [sel, setSel] = useState<{ anchor: Span; head: Span; strings: StringSel }>(() => {
    const c = measureCells(song.measures[0], ts)[0];
    const span = { start: 0, end: c.len };
    return { anchor: span, head: span, strings: null };
  });
  const [clip, setClip] = useState<Clip | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playStart, setPlayStart] = useState<PlayStart>({ t: 0, id: 0 });
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const timeRef = useRef(0);
  const digitBuf = useRef<{ t: number; v: number } | null>(null);
  /** Shift+↑↓ で弦を範囲選択する時の起点と先端 */
  const strExtend = useRef<{ anchor: number; head: number } | null>(null);

  const mi = Math.min(measureIdx, song.measures.length - 1);
  const songEnd = song.measures.length * mt;
  const range: Span = {
    start: Math.min(sel.anchor.start, sel.head.start, songEnd - 1),
    end: Math.min(Math.max(sel.anchor.end, sel.head.end), songEnd),
  };
  const strings = sel.strings;

  const select = useCallback((span: Span, str: StringSel, extend = false) => {
    setSel((s) => (extend ? { anchor: s.anchor, head: span, strings: str } : { anchor: span, head: span, strings: str }));
  }, []);

  /** 通し tick の位置のマスを選択し、その小節を表示 */
  const selectAt = useCallback(
    (g: number, str: StringSel = null, extend = false) => {
      const { measure, cell } = locateTick(song, g);
      setMeasureIdx(measure);
      const start = measure * mt + cell.tick;
      select({ start, end: start + cell.len }, str, extend);
    },
    [song, mt, select],
  );

  // プレビューの停止中の表示位置: 表示中の小節内の選択位置（無ければ小節頭）
  const viewStart = mi * mt;
  const overlaps = range.start < viewStart + mt && range.end > viewStart;
  const editTime = quarterToSec(song, (overlaps ? Math.max(range.start, viewStart) : viewStart) / TPQ);

  const startFrom = (t: number) => {
    setPlayStart((p) => ({ t: Math.max(0, t), id: p.id + 1 }));
    setPlaying(true);
  };

  const stop = useCallback(() => {
    setPlaying(false);
    selectAt(Math.max(0, Math.round(secToQuarter(song, timeRef.current) * TPQ)));
  }, [song, selectAt]);

  const togglePlay = () => {
    if (playing) stop();
    else startFrom(editTime < 1e-6 ? 0 : editTime - 60 / song.bpm);
  };

  const currentPage = () =>
    playing ? pageRange(song, secToQuarter(song, timeRef.current)).index : pageOfMeasure(song, mi);

  const goPage = (page: number) => {
    const p = Math.max(0, Math.min(pageCount(song) - 1, page));
    const g = p * song.measuresPerPage * mt;
    if (playing) startFrom(quarterToSec(song, g / TPQ));
    else selectAt(g);
  };

  // ---------------------------------------------------------------------------
  // 編集コマンド
  // ---------------------------------------------------------------------------
  const { start, end } = range;
  const len = end - start;
  const firstNote = () => {
    const { measure, cell } = locateTick(song, start);
    return findNote(song.measures[measure], cell.tick);
  };
  const cmd: EditorCommands = {
    hasClip: !!clip,
    // 弦を選んでいる時はその弦だけ、全弦の時は音符ごと（ピッキング・歌詞など含む）
    copy: () => setClip(strings ? copyStrings(song, start, end, strings) : copyRange(song, start, end)),
    cut: () => {
      setClip(strings ? copyStrings(song, start, end, strings) : copyRange(song, start, end));
      update((d) => (strings ? setFretInRange(d, start, end, strings, null) : clearRange(d, start, end)));
    },
    paste: () => {
      if (!clip) return;
      const span = { start, end: Math.min(start + clip.length, songEnd) };
      if (clip.strings) {
        // 貼り付け先で選んでいる一番上の弦に、コピー元の一番上の弦を合わせる
        const top = strings ? Math.min(...strings.map(Number)) : Math.min(...clip.strings.map(Number));
        const src = clip.strings.map(Number);
        const offset = Math.max(1 - Math.min(...src), Math.min(6 - Math.max(...src), top - Math.min(...src)));
        update((d) => {
          pasteStrings(d, start, clip, top);
        });
        select(span, src.map((n) => String(n + offset) as StringNo));
        return;
      }
      update((d) => pasteClip(d, start, clip));
      select(span, strings);
    },
    pasteRhythm: () => {
      if (!clip) return;
      if (clip.strings) return cmd.paste();
      update((d) => pasteRhythm(d, start, clip));
      select({ start, end: Math.min(start + clip.length, songEnd) }, strings);
    },
    duplicate: () => {
      const c = strings ? copyStrings(song, start, end, strings) : copyRange(song, start, end);
      update((d) => {
        if (c.strings) pasteStrings(d, end, c, Math.min(...c.strings.map(Number)));
        else pasteClip(d, end, c);
      });
      select({ start: end, end: Math.min(end + len, songEnd) }, strings);
    },
    clear: () =>
      update((d) => {
        if (strings) setFretInRange(d, start, end, strings, null);
        else clearRange(d, start, end);
      }),
    split: (dup) => update((d) => splitInRange(d, start, end, dup)),
    merge: () => update((d) => mergeInRange(d, start, end)),
    picking: (p) => update((d) => applyToNotesInRange(d, start, end, (m, t) => setPicking(m, t, p))),
    rest: () => {
      const on = !firstNote()?.rest;
      update((d) => applyToNotesInRange(d, start, end, (m, t) => setRest(m, t, on)));
    },
    nuance: (n) => {
      const v = firstNote()?.nuance === n ? null : n;
      update((d) => applyToNotesInRange(d, start, end, (m, t) => setNuance(m, t, v)));
    },
    strum: (dir) => {
      const v = firstNote()?.strum === dir ? null : dir;
      update((d) => applyToNotesInRange(d, start, end, (m, t) => setStrum(m, t, v)));
    },
    fretShift: (delta) => update((d) => shiftFrets(d, start, end, strings, delta)),
    stringMove: (dir) => {
      update((d) => moveToAdjacentString(d, start, end, strings, dir));
      const next = shiftStringSel(strings, dir);
      select(range, next);
      return next;
    },
    expandChord: (intervals) => update((d) => expandChordInRange(d, start, end, intervals)),
  };

  // ---------------------------------------------------------------------------
  // キーボード
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (exportOpen || document.querySelector('[data-modal]')) return;
      const el = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
      const row = Number((el as HTMLInputElement).dataset?.row);
      // フレットのマスにフォーカスがある時は、数字・x・Delete・矢印以外のキーをコマンドとして扱う
      const inFretCell = typing && row >= 2 && row <= 7;
      const inGrid = !!el.closest('[data-grid]');
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const done = () => e.preventDefault();

      if (mod && (key === 'z' || key === 'y') && (!typing || inGrid)) {
        done();
        if (key === 'z' && !e.shiftKey) store.undo();
        else store.redo();
        return;
      }
      if (typing && !inFretCell) return;

      if (mod) {
        if (key === 'c') cmd.copy();
        else if (key === 'x') cmd.cut();
        else if (key === 'v' && e.shiftKey) cmd.pasteRhythm();
        else if (key === 'v') cmd.paste();
        else if (key === 'd') cmd.duplicate();
        else return;
        return done();
      }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        done();
        const next = cmd.stringMove(e.key === 'ArrowUp' ? -1 : 1);
        if (inFretCell && next?.length === 1) {
          const col = (el as HTMLInputElement).dataset.col;
          setTimeout(() => document.querySelector<HTMLInputElement>(`[data-row="${1 + +next[0]}"][data-col="${col}"]`)?.focus());
        }
        return;
      }
      // E / + = 分割、Shift+E = フレットを複製しながら分割、Q / - = 統合
      if (key === 'e' || e.key === '+') return done(), cmd.split(key === 'e' && e.shiftKey);
      if (key === 'q' || e.key === '-') return done(), cmd.merge();
      if (key === 'a') return done(), cmd.fretShift(-1);
      if (key === 'd') return done(), cmd.fretShift(1);
      if (key === 'n') return done(), cmd.picking('down');
      if (key === 'v') return done(), cmd.picking('up');
      if (key === 'r') return done(), cmd.rest();
      if (key in NUANCE_KEYS) return done(), cmd.nuance(NUANCE_KEYS[key]);
      if (key === 'j') return done(), cmd.strum('up');
      if (key === 'k') return done(), cmd.strum('down');
      // Shift+↑↓: 同じタイミングで弦の選択範囲を広げる/狭める
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && strings) {
        done();
        const nums = strings.map(Number);
        let ext = strExtend.current;
        if (!ext || !nums.includes(ext.anchor) || !nums.includes(ext.head)) ext = { anchor: nums[0], head: nums[0] };
        const head = Math.max(1, Math.min(6, ext.head + (e.key === 'ArrowUp' ? -1 : 1)));
        strExtend.current = { anchor: ext.anchor, head };
        if (inFretCell) (el as HTMLInputElement).blur();
        const lo = Math.min(ext.anchor, head);
        const hi = Math.max(ext.anchor, head);
        select(range, (['1', '2', '3', '4', '5', '6'] as StringNo[]).filter((s) => +s >= lo && +s <= hi));
        return;
      }
      if (inFretCell) return;

      // 以下はマスにフォーカスが無い時（拍番号やドラッグで範囲選択中）
      if (/^[0-9]$/.test(e.key) && strings) {
        const now = performance.now();
        const prev = digitBuf.current;
        const dgt = +e.key;
        const v = prev && now - prev.t < 800 && prev.v > 0 && prev.v < 10 && prev.v * 10 + dgt <= 24 ? prev.v * 10 + dgt : dgt;
        digitBuf.current = { t: now, v };
        update((d) => setFretInRange(d, start, end, strings, v));
        return done();
      }
      if (key === 'x' && strings) return done(), update((d) => setFretInRange(d, start, end, strings, 'x'));
      if (e.key === 'Delete' || e.key === 'Backspace') return done(), cmd.clear();
      if (e.key === ' ') return done(), togglePlay();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        done();
        if (e.key === 'ArrowLeft') selectAt(Math.max(0, (e.shiftKey ? sel.head.start : start) - 1), strings, e.shiftKey);
        else selectAt(Math.min(songEnd - 1, e.shiftKey ? sel.head.end : end), strings, e.shiftKey);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        done();
        const cur = strings?.[0] ?? (e.key === 'ArrowUp' ? '2' : '0');
        const n = Math.max(1, Math.min(6, +cur + (e.key === 'ArrowUp' ? -1 : 1)));
        select(range, [String(n) as StringNo]);
        return;
      }
      if (e.key === 'Enter' && strings?.length === 1) {
        done();
        const { measure, cell } = locateTick(song, start);
        setMeasureIdx(measure);
        setTimeout(() => document.querySelector<HTMLInputElement>(`[data-row="${1 + +strings[0]}"][data-col="${cell.index}"]`)?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const renderSelection = useMemo(
    () => ({ startQ: range.start / TPQ, endQ: range.end / TPQ, string: strings?.length === 1 ? strings[0] : null }),
    [range.start, range.end, strings],
  );

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        store={store}
        onExport={() => {
          if (playing) stop();
          setExportOpen(true);
        }}
        onHelp={() => {
          if (playing) stop();
          setHelpOpen(true);
        }}
      />
      <main className="mx-auto w-full max-w-[1600px] space-y-2 px-4 py-2">
        <Preview
          song={song}
          timeline={timeline}
          playing={playing}
          playStart={playStart}
          editTime={editTime}
          selection={renderSelection}
          onEnded={stop}
          timeRef={timeRef}
          onFirst={() => (playing ? startFrom(0) : selectAt(0))}
          onPrevPage={() => goPage(currentPage() - 1)}
          onTogglePlay={togglePlay}
          onNextPage={() => goPage(currentPage() + 1)}
        />
        <Editor
          store={store}
          measureIdx={mi}
          onMeasureChange={(i) => setMeasureIdx(Math.max(0, Math.min(song.measures.length - 1, i)))}
          range={range}
          strings={strings}
          onSelect={select}
          onMove={(dest) => {
            update((d) => moveRange(d, start, end, dest));
            select({ start: dest, end: Math.min(dest + len, songEnd) }, strings);
          }}
          cmd={cmd}
        />
        <AdSlot slot={import.meta.env.VITE_ADSENSE_SLOT} />
        <footer className="flex justify-center gap-4 pb-2 text-[11px] text-zinc-600">
          <span>Tab動画メーカー v1.0</span>
          <a href="/privacy.html" className="hover:text-zinc-400">
            プライバシーポリシー・免責事項
          </a>
        </footer>
      </main>
      {exportOpen && <ExportDialog song={song} onClose={() => setExportOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      <MobileNotice />
    </div>
  );
}


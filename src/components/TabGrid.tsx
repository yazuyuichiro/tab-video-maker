import { useEffect, useMemo, useRef, useState } from 'react';
import type { FretValue, Note, Nuance, Picking, StringNo, StringSel, Strum } from '../types';
import { NUANCE_LABEL, NUANCE_NAME, SEGMENT_OPTIONS } from '../types';
import type { Span } from '../App';
import type { SongStore } from '../state/useSongStore';
import {
  assignLyrics,
  findNote,
  setAllSegments,
  setChordLabel,
  setFret,
  setLyric,
  setNuance,
  setPicking,
  setRest,
  setSegment,
  setStrum,
} from '../lib/songOps';
import { tokenizeLyrics } from '../lib/lyrics';
import { measureCells, measureTicks, noteEndTick, parseTimeSignature, segmentLabel, type Cell } from '../lib/timing';
import { ComboCell, type ComboOption } from './ComboCell';

interface Props {
  store: SongStore;
  measureIdx: number;
  /** 選択範囲（曲頭からの通し tick）と選択中の弦（null=全弦） */
  range: Span;
  strings: StringSel;
  onSelect: (span: Span, strings: StringSel, extend?: boolean) => void;
  /** 選択範囲を dest（通し tick）へ移動 */
  onMove: (dest: number) => void;
  onMeasureChange: (idx: number) => void;
}

const STRINGS: StringNo[] = ['1', '2', '3', '4', '5', '6'];
/** 行番号: 0=コード 1=ピック 2〜7=1〜6弦 8=奏法 9=歌詞 */
const ROW_CHORD = 0;
const ROW_PICK = 1;
const ROW_NUANCE = 8;
const ROW_LYRIC = 9;
const LAST_ROW = 9;
const stringRow = (s: StringNo) => 1 + parseInt(s, 10);
const stringRange = (a: number, b: number): StringNo[] =>
  STRINGS.filter((s) => +s >= Math.min(a, b) && +s <= Math.max(a, b));

const COMMON_CHORDS = [
  'C', 'D', 'E', 'F', 'G', 'A', 'B', 'Bb',
  'Am', 'Bm', 'Dm', 'Em', 'F#m', 'Gm', 'Cm', 'C#m',
  'C7', 'D7', 'E7', 'G7', 'A7', 'B7', 'CM7', 'FM7',
  'Am7', 'Dm7', 'Em7', 'Asus4', 'Dsus4', 'Cadd9', 'Dadd9', 'G/B',
];


const PICK_OPTIONS: ComboOption[] = [
  { value: '⊓', label: '⊓', title: 'ダウン (D)' },
  { value: 'V', label: 'V', title: 'アップ (U)' },
  { value: '休', label: '休', title: '休符：直前の音をここで止める (R)', className: 'text-red-300' },
  { value: '', label: '消', title: 'なし', className: 'text-zinc-400' },
];

const NUANCES: Exclude<Nuance, null>[] = ['hammer', 'pull', 'slide', 'choke', 'hc', 'mute', 'tie', 'slur'];
const NUANCE_OPTIONS: ComboOption[] = [
  ...NUANCES.map((n) => ({ value: NUANCE_LABEL[n], label: NUANCE_LABEL[n], title: NUANCE_NAME[n] })),
  { value: '↑', label: '↑', title: 'じゃらーん（低音弦→高音弦）' },
  { value: '↓', label: '↓', title: 'じゃらーん（高音弦→低音弦）' },
  { value: '', label: '消', title: 'なし', className: 'text-zinc-400' },
];
const NUANCE_BY_TEXT: Record<string, Nuance> = {
  h: 'hammer', p: 'pull', s: 'slide', c: 'choke', hc: 'hc', b: 'hc', x: 'mute', m: 'mute', t: 'tie', sl: 'slur', l: 'slur',
};
const STRUM_TEXT: Record<'up' | 'down', string> = { up: '↑', down: '↓' };

/** 奏法セルの入力（例: "h" / "↑" / "↑h"、j=↑ k=↓）を 奏法 と 矢印 に分ける */
function parseNuanceText(t: string): { nuance: Nuance | undefined; strum: Strum } {
  let rest = t.trim().toLowerCase();
  let strum: Strum = null;
  if (/[↑j^]/.test(rest)) strum = 'up';
  else if (/[↓k]/.test(rest)) strum = 'down';
  rest = rest.replace(/[↑↓jk^]/g, '');
  const nuance = rest === '' ? null : (NUANCE_BY_TEXT[rest] ?? NUANCE_BY_TEXT[rest.slice(-1)]);
  return { nuance, strum };
}

function parseFret(t: string): FretValue | undefined {
  const v = t.trim();
  if (v === '') return null;
  if (/^x$/i.test(v)) return 'x';
  if (/^\d{1,2}$/.test(v) && parseInt(v, 10) <= 24) return parseInt(v, 10);
  return undefined;
}

function pickText(n: Note | undefined): string {
  if (n?.rest) return '休';
  if (n?.picking === 'down') return '⊓';
  if (n?.picking === 'up') return 'V';
  return '';
}

/** 入力文字からピッキングを判定（最後に打った文字を優先） */
function parsePick(t: string): Picking | 'rest' | undefined {
  if (t === '') return null;
  const c = t.slice(-1);
  if (/[dD⊓↓]/.test(c)) return 'down';
  if (/[uUvV↑]/.test(c)) return 'up';
  if (/[rR休]/.test(c)) return 'rest';
  return undefined;
}

export function TabGrid({ store, measureIdx, range, strings, onSelect, onMove, onMeasureChange }: Props) {
  const { song, update } = store;
  const ts = song.timeSignature;
  const m = song.measures[measureIdx];
  const cells = useMemo(() => measureCells(m, ts), [m, ts]);
  const { num } = parseTimeSignature(ts);
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ row: number; col: 'first' | 'last' } | null>(null);
  const base = measureIdx * measureTicks(ts);
  const spanOf = (c: Cell): Span => ({ start: base + c.tick, end: base + c.tick + c.len });
  const isSelected = (c: Cell) => base + c.tick >= range.start && base + c.tick < range.end;
  const isSelectedString = (c: Cell, st: StringNo) => isSelected(c) && (strings === null || strings.includes(st));
  /** 拍番号の操作は全弦が対象 */
  const onSelectSpan = (span: Span, extend = false) => onSelect(span, null, extend);
  const blurActive = () => (document.activeElement as HTMLElement | null)?.blur();

  // 拍番号行のドラッグ: 範囲選択 / 選択範囲の移動
  const drag = useRef<{ mode: 'select' | 'move'; grab: Cell; moved: boolean } | null>(null);
  const dropRef = useRef(0);
  const [moveDelta, setMoveDelta] = useState<number | null>(null);
  const latest = useRef({ range, onMove, onSelectSpan, spanOf });
  latest.current = { range, onMove, onSelectSpan, spanOf };

  useEffect(() => {
    const up = () => {
      const d = drag.current;
      drag.current = null;
      if (d?.mode === 'move') {
        const l = latest.current;
        const delta = dropRef.current;
        if (d.moved && delta !== 0 && l.range.start + delta >= 0) l.onMove(l.range.start + delta);
        else if (!d.moved) l.onSelectSpan(l.spanOf(d.grab));
      }
      setMoveDelta(null);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const headerDown = (c: Cell, e: React.MouseEvent) => {
    e.preventDefault();
    blurActive();
    // 複数マスの選択範囲をつかんだ時だけ移動（1マスだけの選択からのドラッグは範囲選択）
    const multi = range.end - range.start > c.len;
    if (!e.shiftKey && isSelected(c) && multi) {
      drag.current = { mode: 'move', grab: c, moved: false };
      dropRef.current = 0;
      setMoveDelta(0);
    } else {
      onSelectSpan(spanOf(c), e.shiftKey);
      drag.current = { mode: 'select', grab: c, moved: false };
    }
  };

  const headerEnter = (c: Cell) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'select') onSelectSpan(spanOf(c), true);
    else {
      d.moved = true;
      dropRef.current = c.tick - d.grab.tick;
      setMoveDelta(dropRef.current);
    }
  };

  // 移動先のプレビュー
  const inDrop = (c: Cell) =>
    moveDelta !== null &&
    moveDelta !== 0 &&
    base + c.tick >= range.start + moveDelta &&
    base + c.tick < range.end + moveDelta;

  const focusCell = (c: Cell, st: StringNo | null) => {
    if (rect.current?.active) return;
    onSelect(spanOf(c), st ? [st] : null);
  };

  // 弦のマスのドラッグ: 時間 × 弦の範囲選択（その後 数字キーで一括入力）
  const rect = useRef<{ c: Cell; s: StringNo; active: boolean } | null>(null);
  useEffect(() => {
    const up = () => {
      rect.current = null;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  const stringDown = (c: Cell, st: StringNo, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.detail === 2) {
      // ダブルクリック: その位置の全弦を選択
      e.preventDefault();
      blurActive();
      onSelect(spanOf(c), null);
      return;
    }
    if (e.detail >= 3) {
      // トリプルクリック: 小節全体を選択
      e.preventDefault();
      blurActive();
      onSelect({ start: base, end: base + measureTicks(ts) }, null);
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      blurActive();
      const lo = Math.min(+st, ...(strings ?? [st]).map(Number));
      const hi = Math.max(+st, ...(strings ?? [st]).map(Number));
      onSelect(spanOf(c), stringRange(lo, hi), true);
      return;
    }
    rect.current = { c, s: st, active: false };
  };
  const stringEnter = (c: Cell, st: StringNo) => {
    const r = rect.current;
    if (!r || (r.c.index === c.index && r.s === st && !r.active)) return;
    if (!r.active) {
      r.active = true;
      blurActive();
      window.getSelection()?.removeAllRanges();
    }
    const a = spanOf(r.c);
    const b = spanOf(c);
    onSelect({ start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) }, stringRange(+r.s, +st));
  };

  const chordOptions = useMemo<ComboOption[]>(() => {
    const used = new Set<string>();
    for (const mm of song.measures) {
      if (mm.chordName) used.add(mm.chordName);
      for (const n of mm.notes) if (n.chord) used.add(n.chord);
    }
    const all = [...used, ...COMMON_CHORDS.filter((c) => !used.has(c))].slice(0, 39);
    return [...all.map((c) => ({ value: c, label: c })), { value: '', label: '消', className: 'text-zinc-400' }];
  }, [song.measures]);

  // 各弦について音が伸びているマス
  const sustain = useMemo(() => {
    const map = new Map<StringNo, Set<number>>(STRINGS.map((s) => [s, new Set<number>()]));
    for (const n of m.notes) {
      if (n.rest || n.nuance === 'mute') continue;
      const end = noteEndTick(m, n, ts);
      for (const s of STRINGS) {
        if (typeof n.frets[s] !== 'number') continue;
        for (const c of cells) if (c.tick > n.tick && c.tick < end) map.get(s)!.add(c.index);
      }
    }
    return map;
  }, [m, ts, cells]);

  // 小節をまたいだ移動後のフォーカス
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    pendingFocus.current = null;
    const col = p.col === 'first' ? 0 : cells.length - 1;
    gridRef.current?.querySelector<HTMLInputElement>(`[data-row="${p.row}"][data-col="${col}"]`)?.focus();
  }, [measureIdx, cells.length]);

  const edit = (fn: (mm: typeof m) => void, mergeKey?: string) => update((d) => fn(d.measures[measureIdx]), mergeKey);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLInputElement;
    // Alt / Ctrl 付きはエディタのコマンド（弦移動など）なのでマス移動しない
    if (el.tagName !== 'INPUT' || el.dataset.row === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
    // Shift+↑↓ は弦の範囲選択（エディタ側で処理）
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
    const row = Number(el.dataset.row);
    const col = Number(el.dataset.col);
    let dr = 0;
    let dc = 0;
    const len = el.value.length;
    if (e.key === 'ArrowUp') dr = -1;
    else if (e.key === 'ArrowDown') dr = 1;
    else if (e.key === 'ArrowLeft' && el.selectionStart === 0) dc = -1;
    else if (e.key === 'ArrowRight' && el.selectionEnd === len) dc = 1;
    else if (e.key === 'Enter') dc = 1;
    else return;
    e.preventDefault();
    const nr = Math.max(0, Math.min(LAST_ROW, row + dr));
    const nc = col + dc;
    if (nc < 0) {
      if (measureIdx > 0) {
        pendingFocus.current = { row: nr, col: 'last' };
        onMeasureChange(measureIdx - 1);
      }
      return;
    }
    if (nc >= cells.length) {
      if (measureIdx < song.measures.length - 1) {
        pendingFocus.current = { row: nr, col: 'first' };
        onMeasureChange(measureIdx + 1);
      }
      return;
    }
    gridRef.current?.querySelector<HTMLInputElement>(`[data-row="${nr}"][data-col="${nc}"]`)?.focus();
  };

  // 小節の長さを常に同じ幅にし、マスの幅を音の長さに比例させる
  const cols = `44px ${cells.map((c) => `minmax(0, ${c.len}fr)`).join(' ')}`;
  const head = 'sticky left-0 z-10 flex items-center bg-zinc-950 pl-1.5 text-[10px] font-bold';
  const cellBase = 'relative h-6 border-l text-xs';
  const border = (sub: number) => (sub === 0 ? 'border-l-zinc-500' : 'border-l-zinc-800');
  const plain = (c: Cell) => (c.segIndex % 2 === 0 ? 'bg-zinc-900' : 'bg-zinc-900/40');
  const bg = (c: Cell) => (isSelected(c) && strings === null ? 'bg-sky-500/15' : plain(c));
  const bgString = (c: Cell, st: StringNo) => (isSelectedString(c, st) ? 'bg-sky-500/30' : plain(c));

  let beatCursor = 0;
  const segStarts = m.segments.map((sg) => {
    const b = beatCursor;
    beatCursor += sg.beats;
    return b;
  });
  const allSame = m.segments.every((sg) => sg.beats === 1 && sg.div === m.segments[0].div);

  return (
    <div className="overflow-x-auto rounded-md border border-zinc-800">
      <div
        ref={gridRef}
        data-grid
        className="grid min-w-[860px]"
        style={{ gridTemplateColumns: cols }}
        onKeyDown={onKeyDown}
      >
        {/* 分割（左端で全拍一括、各拍で個別） */}
        <div className={`${head} pr-0.5`}>
          <select
            className="w-full rounded border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-300"
            value={allSame ? String(m.segments[0].div) : ''}
            title="全ての拍の分割を一括変更"
            onChange={(e) => e.target.value && edit((mm) => setAllSegments(mm, ts, Number(e.target.value)))}
          >
            <option value="">一括</option>
            {SEGMENT_OPTIONS.filter((o) => o.beats === 1).map((o) => (
              <option key={o.div} value={o.div}>
                {segmentLabel(o, ts)}
              </option>
            ))}
          </select>
        </div>
        {m.segments.map((sg, si) => {
          const startCell = cells.findIndex((c) => c.segIndex === si);
          return (
            <div
              key={`seg${si}`}
              className="border-l border-l-zinc-500 bg-zinc-950 px-0.5 py-px"
              style={{ gridColumn: `${startCell + 2} / span ${sg.div}` }}
            >
              <select
                className="w-full rounded border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-200"
                value={`${sg.beats}:${sg.div}`}
                title={`${segStarts[si] + 1}拍目の分割`}
                onChange={(e) => {
                  const [beats, div] = e.target.value.split(':').map(Number);
                  edit((mm) => setSegment(mm, ts, si, { beats, div }));
                }}
              >
                {SEGMENT_OPTIONS.filter((o) => segStarts[si] + o.beats <= num).map((o) => (
                  <option key={`${o.beats}:${o.div}`} value={`${o.beats}:${o.div}`}>
                    {segmentLabel(o, ts)}
                  </option>
                ))}
              </select>
            </div>
          );
        })}

        {/* 拍-マス番号 */}
        <div
          className={`${head} cursor-pointer text-zinc-500 hover:text-sky-300`}
          title="クリックで小節全体を選択"
          onMouseDown={(e) => {
            e.preventDefault();
            blurActive();
            onSelectSpan({ start: base, end: base + measureTicks(ts) }, e.shiftKey);
          }}
        >
          拍
        </div>
        {cells.map((c) => (
          <div
            key={`h${c.index}`}
            onMouseDown={(e) => headerDown(c, e)}
            onMouseEnter={() => headerEnter(c)}
            title={isSelected(c) && range.end - range.start > c.len ? 'ドラッグで選択範囲を移動' : 'クリック・ドラッグで範囲選択（Shift+クリックで範囲を広げる）'}
            className={`${cellBase} ${border(c.sub)} flex h-5 items-center justify-center overflow-hidden text-[9px] tabular-nums select-none ${
              inDrop(c)
                ? 'bg-amber-400/40 text-zinc-100 outline-1 -outline-offset-1 outline-amber-300 outline-dashed'
                : isSelected(c)
                  ? `${range.end - range.start > c.len ? 'cursor-grab' : 'cursor-pointer'} bg-sky-500 text-white`
                  : `cursor-pointer hover:bg-zinc-700 ${c.sub === 0 ? 'bg-zinc-800 font-bold text-zinc-300' : 'bg-zinc-800/60 text-zinc-500'}`
            }`}
          >
            {c.beat + 1}-{c.sub + 1}
          </div>
        ))}

        {/* コード */}
        <div className={`${head} text-amber-300`}>コード</div>
        {cells.map((c) => (
          <div key={`c${c.index}`} className={`${cellBase} ${border(c.sub)} ${bg(c)}`}>
            <ComboCell
              row={ROW_CHORD}
              col={c.index}
              text={(c.tick === 0 ? m.chordName : findNote(m, c.tick)?.chord) ?? ''}
              onText={(t) => edit((mm) => setChordLabel(mm, c.tick, t), `chord-${measureIdx}-${c.tick}`)}
              options={chordOptions}
              onPick={(v) => edit((mm) => setChordLabel(mm, c.tick, v))}
              columns={4}
              optionWidth={46}
              className="font-bold text-amber-300"
              onFocus={() => focusCell(c, null)}
            />
          </div>
        ))}

        {/* ピッキング */}
        <div className={`${head} text-zinc-400`}>ピック</div>
        {cells.map((c) => {
          const n = findNote(m, c.tick);
          const apply = (v: Picking | 'rest' | undefined) => {
            if (v === undefined) return;
            edit((mm) => {
              if (v === 'rest') setRest(mm, c.tick, true);
              else {
                if (findNote(mm, c.tick)?.rest) setRest(mm, c.tick, false);
                setPicking(mm, c.tick, v);
              }
            });
          };
          return (
            <div key={`p${c.index}`} className={`${cellBase} ${border(c.sub)} ${bg(c)}`}>
              <ComboCell
                row={ROW_PICK}
                col={c.index}
                text={pickText(n)}
                onText={(t) => apply(parsePick(t))}
                options={PICK_OPTIONS}
                onPick={(v) => apply(parsePick(v))}
                columns={4}
                title="D=ダウン U=アップ R=休符"
                className={n?.rest ? 'font-bold text-red-400' : 'font-bold text-zinc-100'}
                onFocus={() => focusCell(c, null)}
              />
            </div>
          );
        })}

        {/* 弦 */}
        {STRINGS.map((s) => (
          <Row key={s} label={`${s}弦`} className={head}>
            {cells.map((c) => {
              const n = findNote(m, c.tick);
              const v = n?.frets[s] ?? null;
              const sounding = typeof v === 'number' && n?.nuance !== 'mute';
              const sus = sustain.get(s)!.has(c.index);
              const apply = (t: string) => {
                const fv = parseFret(t);
                if (fv !== undefined) edit((mm) => setFret(mm, c.tick, s, fv));
              };
              return (
                <div
                  key={`${s}-${c.index}`}
                  className={`${cellBase} ${border(c.sub)} ${bgString(c, s)}`}
                  onMouseDown={(e) => stringDown(c, s, e)}
                  onMouseEnter={() => stringEnter(c, s)}
                >
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-zinc-600" />
                  {(sus || sounding) && (
                    <div
                      className={`pointer-events-none absolute top-1/2 right-0 h-1 -translate-y-1/2 bg-amber-400/60 ${
                        sounding ? 'left-1/2' : 'left-0'
                      }`}
                    />
                  )}
                  {v !== null && (
                    <div className="pointer-events-none absolute inset-y-0.5 left-1/2 w-5 -translate-x-1/2 rounded-sm bg-zinc-200" />
                  )}
                  <div className="absolute inset-0">
                    <ComboCell
                      row={stringRow(s)}
                      col={c.index}
                      text={v === null ? '' : String(v)}
                      onText={apply}
                      maxLength={2}
                      className={`relative font-bold tabular-nums ${
                        v === 'x' || (v !== null && n?.nuance === 'mute') ? 'text-red-600' : 'text-zinc-900'
                      }`}
                      onFocus={() => focusCell(c, s)}
                    />
                  </div>
                </div>
              );
            })}
          </Row>
        ))}

        {/* 奏法 */}
        <div className={`${head} text-fuchsia-300`}>奏法</div>
        {cells.map((c) => {
          const note = findNote(m, c.tick);
          const nu = note?.nuance ?? null;
          const st = note?.strum ?? null;
          const text = (st ? STRUM_TEXT[st] : '') + (nu ? NUANCE_LABEL[nu] : '');
          const apply = (t: string) => {
            const { nuance, strum } = parseNuanceText(t);
            if (nuance === undefined) return;
            edit((mm) => {
              setStrum(mm, c.tick, strum);
              setNuance(mm, c.tick, nuance);
            });
          };
          // 候補パネル: 矢印は奏法と別に切り替える
          const pick = (v: string) => {
            if (v === '↑' || v === '↓') {
              const dir = v === '↑' ? 'up' : 'down';
              edit((mm) => setStrum(mm, c.tick, st === dir ? null : dir));
            } else if (v === '') edit((mm) => {
              setStrum(mm, c.tick, null);
              setNuance(mm, c.tick, null);
            });
            else {
              const { nuance } = parseNuanceText(v);
              if (nuance !== undefined) edit((mm) => setNuance(mm, c.tick, nuance));
            }
          };
          return (
            <div key={`n${c.index}`} className={`${cellBase} ${border(c.sub)} ${bg(c)}`}>
              <ComboCell
                row={ROW_NUANCE}
                col={c.index}
                text={text}
                onText={apply}
                options={NUANCE_OPTIONS}
                onPick={pick}
                columns={4}
                maxLength={3}
                title={
                  [st ? `じゃらーん${STRUM_TEXT[st]}` : '', nu ? NUANCE_NAME[nu] : ''].filter(Boolean).join(' / ') ||
                  'h p s c hc x t(タイ) sl(スラー) ↑↓(j/k)'
                }
                className="font-bold italic text-fuchsia-300"
                onFocus={() => focusCell(c, null)}
              />
            </div>
          );
        })}

        {/* 歌詞（文章を貼り付けると後ろの音符へ順に割り当て） */}
        <div className={`${head} text-emerald-300`}>歌詞</div>
        {cells.map((c) => (
          <div key={`l${c.index}`} className={`${cellBase} ${border(c.sub)} ${bg(c)}`}>
            <ComboCell
              row={ROW_LYRIC}
              col={c.index}
              text={findNote(m, c.tick)?.lyric ?? ''}
              onText={(t) => edit((mm) => setLyric(mm, c.tick, t), `lyric-${measureIdx}-${c.tick}`)}
              className="text-emerald-200"
              title="文章を貼り付けると、後ろの音符へ1文字ずつ割り当てます（_ で1音符飛ばす）"
              onFocus={() => focusCell(c, null)}
              onPaste={(e) => {
                const tokens = tokenizeLyrics(e.clipboardData.getData('text'));
                if (tokens.length <= 1) return;
                e.preventDefault();
                update((d) => {
                  assignLyrics(d, measureIdx, c.tick, tokens);
                });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, className, children }: { label: string; className: string; children: React.ReactNode }) {
  return (
    <>
      <div className={`${className} text-zinc-300`}>{label}</div>
      {children}
    </>
  );
}

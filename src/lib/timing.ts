import type { Measure, Note, Segment, Song } from '../types';
import { TPQ } from '../types';

/** BPM は常に4分音符基準。tick は 4分音符 = TPQ(480) */

export function parseTimeSignature(ts: string): { num: number; den: number } {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(ts.trim());
  if (!m) return { num: 4, den: 4 };
  const num = Math.max(1, Math.min(16, parseInt(m[1], 10)));
  const den = [2, 4, 8, 16].includes(parseInt(m[2], 10)) ? parseInt(m[2], 10) : 4;
  return { num, den };
}

/** 1小節の長さ（4分音符何個分か） */
export function measureQuarters(ts: string): number {
  const { num, den } = parseTimeSignature(ts);
  return (num * 4) / den;
}

/** 1拍（拍子の分母の音符）の tick 数 */
export function beatTicks(ts: string): number {
  return (TPQ * 4) / parseTimeSignature(ts).den;
}

export function measureTicks(ts: string): number {
  return parseTimeSignature(ts).num * beatTicks(ts);
}

export function defaultSegments(ts: string, div = 2): Segment[] {
  return Array.from({ length: parseTimeSignature(ts).num }, () => ({ beats: 1, div }));
}

/** 区間の合計拍数を拍子に合わせる（不足分は最後の分割で埋め、超過分は切り詰める） */
export function conformSegments(segs: Segment[], ts: string): Segment[] {
  const num = parseTimeSignature(ts).num;
  const out: Segment[] = [];
  let used = 0;
  for (const s of segs) {
    const beats = Math.max(1, Math.round(s.beats));
    const div = Math.max(1, Math.min(16, Math.round(s.div)));
    if (used + beats > num) break;
    out.push({ beats, div });
    used += beats;
  }
  const fill = out.length ? out[out.length - 1].div : 2;
  while (used < num) {
    out.push({ beats: 1, div: out.length && out[out.length - 1].beats === 1 ? fill : 2 });
    used++;
  }
  return out;
}

export interface Cell {
  index: number;
  tick: number;
  len: number;
  segIndex: number;
  /** 区間内での位置 */
  sub: number;
  /** 区間の開始拍（0始まり） */
  beat: number;
}

export function measureCells(m: Measure, ts: string): Cell[] {
  const bt = beatTicks(ts);
  const cells: Cell[] = [];
  let beat = 0;
  m.segments.forEach((seg, si) => {
    const segStart = beat * bt;
    const segLen = seg.beats * bt;
    for (let k = 0; k < seg.div; k++) {
      const t0 = segStart + Math.round((k * segLen) / seg.div);
      const t1 = segStart + Math.round(((k + 1) * segLen) / seg.div);
      cells.push({ index: cells.length, tick: t0, len: t1 - t0, segIndex: si, sub: k, beat });
    }
    beat += seg.beats;
  });
  return cells;
}

/** tick を含むセルの番号 */
export function cellIndexAt(cells: Cell[], tick: number): number {
  let idx = 0;
  for (const c of cells) {
    if (c.tick <= tick) idx = c.index;
    else break;
  }
  return idx;
}

/** tick に最も近いセルの番号 */
export function nearestCellIndex(cells: Cell[], tick: number): number {
  let best = 0;
  let bestD = Infinity;
  for (const c of cells) {
    const d = Math.abs(c.tick - tick);
    if (d < bestD) {
      bestD = d;
      best = c.index;
    }
  }
  return best;
}

const LEN_NAMES: Record<number, string> = {
  1920: '全',
  960: '2分',
  640: '2分3連',
  480: '4分',
  320: '4分3連',
  240: '8分',
  192: '4分5連',
  160: '3連',
  120: '16分',
  96: '5連',
  80: '6連',
  60: '32分',
  48: '10連',
  40: '12連',
  30: '64分',
};

/** 区間の分割名（例: 16分 / 3連 / 2拍3連） */
export function segmentLabel(seg: Segment, ts: string): string {
  const len = (seg.beats * beatTicks(ts)) / seg.div;
  if (seg.beats === 2 && seg.div === 3) return '2拍3連';
  return LEN_NAMES[len] ?? `${seg.beats}拍${seg.div}分割`;
}

/** 音を鳴らす（長さの区切りになる）音符か */
export function isEvent(n: Note): boolean {
  return !!n.rest || n.picking !== null || Object.values(n.frets).some((v) => v !== null);
}

/** 音符の終わり（次の音符/休符、なければ小節末）の tick */
export function noteEndTick(m: Measure, n: Note, ts: string): number {
  let end = measureTicks(ts);
  for (const o of m.notes) {
    if (o.tick > n.tick && o.tick < end && isEvent(o)) end = o.tick;
  }
  return end;
}

export interface TimelineNote {
  /** 曲頭からの位置（4分音符単位） */
  q: number;
  /** 音の長さ（4分音符単位） */
  len: number;
  measure: number;
  note: Note;
}

export interface TimelineChord {
  q: number;
  name: string;
}

export interface Timeline {
  notes: TimelineNote[];
  chords: TimelineChord[];
  /** 各小節の開始位置（4分音符単位）。最後の要素は曲の終端 */
  barQ: number[];
  /** 拍の位置（4分音符単位、小節頭を除く） */
  beatQ: number[];
  totalQuarters: number;
}

export function buildTimeline(song: Song): Timeline {
  const ts = song.timeSignature;
  const mq = measureQuarters(ts);
  const mt = measureTicks(ts);
  const { num } = parseTimeSignature(ts);
  const notes: TimelineNote[] = [];
  const chords: TimelineChord[] = [];
  const barQ: number[] = [];
  const beatQ: number[] = [];
  song.measures.forEach((m, i) => {
    const start = i * mq;
    barQ.push(start);
    for (let b = 1; b < num; b++) beatQ.push(start + (b * mq) / num);
    if (m.chordName) chords.push({ q: start, name: m.chordName });
    const sorted = [...m.notes].filter((n) => n.tick < mt).sort((a, b) => a.tick - b.tick);
    for (const n of sorted) {
      const q = start + n.tick / TPQ;
      const end = noteEndTick(m, n, ts);
      notes.push({ q, len: (end - n.tick) / TPQ, measure: i, note: n });
      if (n.chord && n.tick > 0) chords.push({ q, name: n.chord });
    }
  });
  const total = song.measures.length * mq;
  barQ.push(total);
  return { notes, chords, barQ, beatQ, totalQuarters: total };
}

export function quarterToSec(song: Song, q: number): number {
  return (q * 60) / song.bpm;
}

export function secToQuarter(song: Song, t: number): number {
  return (t * song.bpm) / 60;
}

// ---------------------------------------------------------------------------
// 曲全体での位置（通し tick = 小節番号 × 小節の tick 数 + 小節内 tick）
// ---------------------------------------------------------------------------

/** 通し tick を含む小節とマス */
export function locateTick(song: Song, g: number): { measure: number; cell: Cell } {
  const mt = measureTicks(song.timeSignature);
  const measure = Math.max(0, Math.min(song.measures.length - 1, Math.floor(g / mt)));
  const cells = measureCells(song.measures[measure], song.timeSignature);
  return { measure, cell: cells[cellIndexAt(cells, g - measure * mt)] };
}

/** 例: "2小節 3-1" */
export function positionLabel(song: Song, g: number): string {
  const { measure, cell } = locateTick(song, g);
  return `${measure + 1}小節 ${cell.beat + 1}-${cell.sub + 1}`;
}

// ---------------------------------------------------------------------------
// ページ
// ---------------------------------------------------------------------------

export function pageCount(song: Song): number {
  return Math.max(1, Math.ceil(song.measures.length / Math.max(1, song.measuresPerPage)));
}

/** 位置 q（4分音符単位）を含むページ。範囲外は先頭/最終ページに丸める */
export function pageRange(song: Song, q: number): { index: number; start: number; end: number } {
  const pageQ = Math.max(1, song.measuresPerPage) * measureQuarters(song.timeSignature);
  const index = Math.min(pageCount(song) - 1, Math.max(0, Math.floor(q / pageQ + 1e-9)));
  return { index, start: index * pageQ, end: (index + 1) * pageQ };
}

export function pageOfMeasure(song: Song, measureIdx: number): number {
  return Math.floor(measureIdx / Math.max(1, song.measuresPerPage));
}

/** 動画の総尺（秒）。最後の小節の後に少し余韻を残す */
export function songDurationSec(song: Song): number {
  const tail = 2;
  return quarterToSec(song, song.measures.length * measureQuarters(song.timeSignature)) + tail;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

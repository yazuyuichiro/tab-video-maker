/**
 * 検出ノート → 既存の曲データ（Song / Measure / Note）への変換。
 * クオンタイズ（BPM・グリッド）と、弦・フレットの割り当て（動的計画法）を行う。
 */
import type { Measure, Song, StringNo } from '../../types';
import { OPEN_PITCH, STRING_NOS, TPQ } from '../../types';
import { createMeasure, createNote } from '../songOps';
import { normalizeSong } from '../storage';
import { beatTicks, defaultSegments, locateTick, measureTicks } from '../timing';
import { cleanNotes } from './cleanup';
import type { RawNote } from './protocol';

export type Grid = 8 | 16;

export interface TabSettings {
  bpm: number;
  grid: Grid;
  /** 感度 1〜10（cleanup.ts の ampThreshold） */
  sensitivity: number;
  capo: number;
  /** フレットの上限（カポからの数え方＝Tabに書く数字） */
  maxFret: number;
}

export const BPM_MIN = 30;
export const BPM_MAX = 300;
export const CAPO_MAX = 12;
export const FRET_LIMIT_MIN = 5;
export const FRET_LIMIT_MAX = 24;

export type ReviewReason = 'low' | 'high' | 'no-string';

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  low: '音域より低いため、オクターブ上げて配置',
  high: '音域より高いため、オクターブ下げて配置',
  'no-string': '同時に鳴る音に弦が足りないため、配置していません',
};

export interface ReviewItem {
  /** 曲頭からの通し tick */
  tick: number;
  /** 小節（1始まり） */
  measure: number;
  /** 拍とマス（例: "3-1" = 3拍目の1つ目。エディタの拍番号と同じ） */
  beat: string;
  /** 検出した音（MIDI） */
  pitch: number;
  /** オクターブを移して配置した音（未配置は null） */
  placed: number | null;
  reason: ReviewReason;
}

export interface TabResult {
  /** エディタに反映する曲（今の曲の設定 + BPM + 生成した小節） */
  song: Song;
  /** 後処理後の検出ノート数 */
  detected: number;
  /** Tab に置いた音の数（同じマスに入った同じ音は1つにまとめる） */
  placed: number;
  review: ReviewItem[];
  /** 1小節目の頭にした、音源の中の時刻（秒） */
  offsetSec: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function pitchName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

// ---------------------------------------------------------------------------
// 同時に鳴る音のまとまり（ストロークのずれを吸収してからマスに揃える）
// ---------------------------------------------------------------------------

/** 直前の音からこれ以内に始まった音は同じまとまり（秒） */
const CHORD_STEP_SEC = 0.035;
/** まとまりの最初の音からこれ以内（秒） */
const CHORD_SPAN_SEC = 0.08;

interface Group {
  tick: number;
  /** 音の終わり（通し tick） */
  end: number;
  /** 音の高さ → 強さ */
  pitches: Map<number, number>;
}

function groupNotes(notes: RawNote[], offset: number, bpm: number, gridTicks: number): Group[] {
  const secPerTick = 60 / bpm / TPQ;
  const toGrid = (sec: number) => Math.max(0, Math.round((sec - offset) / secPerTick / gridTicks) * gridTicks);
  const byTick = new Map<number, Group>();
  let i = 0;
  while (i < notes.length) {
    const first = notes[i];
    let j = i + 1;
    while (j < notes.length && notes[j].start - notes[j - 1].start <= CHORD_STEP_SEC && notes[j].start - first.start <= CHORD_SPAN_SEC) j++;
    const tick = toGrid(first.start);
    const g = byTick.get(tick) ?? { tick, end: tick + gridTicks, pitches: new Map() };
    for (let k = i; k < j; k++) {
      const n = notes[k];
      g.pitches.set(n.pitch, Math.max(g.pitches.get(n.pitch) ?? 0, n.amp));
      g.end = Math.max(g.end, toGrid(n.start + n.dur));
    }
    byTick.set(tick, g);
    i = j;
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

// ---------------------------------------------------------------------------
// 弦・フレットの割り当て
// ---------------------------------------------------------------------------

/** 1つのまとまりで考える音の数の上限（それより弱い音は弦が足りない扱い） */
const MAX_PITCHES = 8;
/** 1つのまとまりの押さえ方の候補の上限 */
const MAX_CANDIDATES = 40;
/** 候補を探す数の上限（組み合わせが爆発しないように） */
const MAX_LEAVES = 4000;

interface Candidate {
  frets: Partial<Record<StringNo, number>>;
  /** 置けなかった音 */
  dropped: number[];
  /** 押さえるフレットの平均（開放弦だけなら null） */
  pos: number | null;
  cost: number;
}

/** 低いフレットへの軽い優遇（フレット1つあたり） */
const LOW_FRET_WEIGHT = 0.15;
/** 指が届きにくい幅（これを超えた分に罰則） */
const COMFORT_SPAN = 3;

function localCost(frets: Partial<Record<StringNo, number>>, droppedAmp: number): { pos: number | null; cost: number } {
  const fretted = Object.values(frets).filter((f): f is number => f !== undefined && f > 0);
  const pos = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : null;
  const span = fretted.length > 1 ? Math.max(...fretted) - Math.min(...fretted) : 0;
  return { pos, cost: Math.max(0, span - COMFORT_SPAN) * 3 + (pos ?? 0) * LOW_FRET_WEIGHT + droppedAmp * 10 };
}

/** 同時に鳴る音を、弦が重ならないように置く候補を列挙する（置ける音が最も多いものだけ） */
function candidatesFor(pitches: { pitch: number; amp: number }[], capo: number, maxFret: number): Candidate[] {
  const opts = pitches.map(({ pitch }) =>
    STRING_NOS.filter((s) => {
      const f = pitch - OPEN_PITCH[s] - capo;
      return f >= 0 && f <= maxFret;
    }),
  );
  const n = pitches.length;
  for (let k = Math.min(n, STRING_NOS.length); k >= 1; k--) {
    const out: Candidate[] = [];
    const frets: Partial<Record<StringNo, number>> = {};
    const dropped: number[] = [];
    let leaves = 0;
    const rec = (i: number, placed: number) => {
      if (leaves >= MAX_LEAVES) return;
      if (i === n) {
        if (placed !== k) return;
        leaves++;
        const droppedAmp = dropped.reduce((a, p) => a + (pitches.find((x) => x.pitch === p)?.amp ?? 0), 0);
        out.push({ frets: { ...frets }, dropped: [...dropped], ...localCost(frets, droppedAmp) });
        return;
      }
      if (placed + (n - i) < k) return;
      for (const s of opts[i]) {
        if (frets[s] !== undefined) continue;
        frets[s] = pitches[i].pitch - OPEN_PITCH[s] - capo;
        rec(i + 1, placed + 1);
        delete frets[s];
      }
      if (dropped.length < n - k) {
        dropped.push(pitches[i].pitch);
        rec(i + 1, placed);
        dropped.pop();
      }
    };
    rec(0, 0);
    if (out.length) return out.sort((a, b) => a.cost - b.cost).slice(0, MAX_CANDIDATES);
  }
  return [{ frets: {}, dropped: pitches.map((p) => p.pitch), pos: null, cost: 0 }];
}

/** 押さえる位置の移動量（開放弦だけの時は軽く見る。間が空いている時は移動しやすい） */
function moveCost(a: Candidate, b: Candidate, gapBeats: number): number {
  const d = Math.abs((a.pos ?? 0) - (b.pos ?? 0));
  const open = a.pos === null || b.pos === null ? 0.3 : 1;
  const rest = gapBeats >= 2 ? 0.5 : 1;
  return d * open * rest;
}

/** フレーズ全体で移動量が最小になる押さえ方を選ぶ（Viterbi） */
function assign(cands: Candidate[][], ticks: number[], beat: number): Candidate[] {
  if (!cands.length) return [];
  let cost = cands[0].map((c) => c.cost);
  const back: number[][] = [cands[0].map(() => -1)];
  for (let g = 1; g < cands.length; g++) {
    const gap = (ticks[g] - ticks[g - 1]) / beat;
    const next: number[] = [];
    const from: number[] = [];
    for (const c of cands[g]) {
      let best = Infinity;
      let arg = 0;
      cands[g - 1].forEach((p, pi) => {
        const v = cost[pi] + moveCost(p, c, gap);
        if (v < best) {
          best = v;
          arg = pi;
        }
      });
      next.push(best + c.cost);
      from.push(arg);
    }
    cost = next;
    back.push(from);
  }
  let k = cost.indexOf(Math.min(...cost));
  const out: Candidate[] = [];
  for (let g = cands.length - 1; g >= 0; g--) {
    out.push(cands[g][k]);
    k = back[g][k];
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------
// 曲データへの変換
// ---------------------------------------------------------------------------

export function buildTab(raw: RawNote[], settings: TabSettings, base: Song): TabResult {
  const ts = base.timeSignature;
  const bpm = Math.round(Math.max(BPM_MIN, Math.min(BPM_MAX, settings.bpm)));
  const capo = Math.max(0, Math.min(CAPO_MAX, Math.round(settings.capo)));
  const maxFret = Math.max(FRET_LIMIT_MIN, Math.min(FRET_LIMIT_MAX, Math.round(settings.maxFret)));
  const bt = beatTicks(ts);
  // 8分 = 240 / 16分 = 120 tick。拍より細かくできない拍子（x/16 の8分）は拍に合わせる
  const gridTicks = Math.min((TPQ * 4) / settings.grid, bt);
  const mt = measureTicks(ts);

  const notes = cleanNotes(raw, settings.sensitivity);
  const offsetSec = notes.length ? notes[0].start : 0;
  const groups = groupNotes(notes, offsetSec, bpm, gridTicks);

  // 音域の外の音はオクターブを移す（要確認）
  const lowest = OPEN_PITCH['6'] + capo;
  const highest = OPEN_PITCH['1'] + capo + maxFret;
  const review: Omit<ReviewItem, 'measure' | 'beat'>[] = [];
  const groupPitches = groups.map((g) => {
    const out = new Map<number, number>();
    for (const [pitch, amp] of g.pitches) {
      let p = pitch;
      while (p < lowest) p += 12;
      while (p > highest) p -= 12;
      if (p !== pitch) review.push({ tick: g.tick, pitch, placed: p, reason: p > pitch ? 'low' : 'high' });
      out.set(p, Math.max(out.get(p) ?? 0, amp));
    }
    return [...out].map(([pitch, amp]) => ({ pitch, amp })).sort((a, b) => b.amp - a.amp);
  });

  const cands = groupPitches.map((ps, gi) => {
    const kept = ps.slice(0, MAX_PITCHES);
    for (const p of ps.slice(MAX_PITCHES)) review.push({ tick: groups[gi].tick, pitch: p.pitch, placed: null, reason: 'no-string' });
    return candidatesFor(kept, capo, maxFret);
  });
  const chosen = assign(
    cands,
    groups.map((g) => g.tick),
    bt,
  );

  // 小節を作る（最後の音を含む小節まで）
  const count = groups.length ? Math.floor(groups[groups.length - 1].tick / mt) + 1 : 1;
  const div = bt / gridTicks;
  const measures: Measure[] = Array.from({ length: count }, (_, i) => createMeasure(i + 1, ts, defaultSegments(ts, div)));
  const at = (tick: number) => ({ m: measures[Math.floor(tick / mt)], t: tick % mt });

  let placed = 0;
  groups.forEach((g, gi) => {
    const c = chosen[gi];
    const { m, t } = at(g.tick);
    const note = createNote(t);
    for (const s of STRING_NOS) if (c.frets[s] !== undefined) note.frets[s] = c.frets[s]!;
    placed += Object.keys(c.frets).length;
    if (Object.keys(c.frets).length) m.notes.push(note);
    for (const p of c.dropped) review.push({ tick: g.tick, pitch: p, placed: null, reason: 'no-string' });
  });

  // 休符: どの音も鳴っていない区間の始まり（小節の頭から無音の時はその小節の頭にも）
  const starts = new Set(groups.map((g) => g.tick));
  const sounding = (tick: number) => groups.some((g) => g.tick < tick && tick < g.end);
  const rests = new Set<number>();
  for (const g of groups) if (!sounding(g.end) && !starts.has(g.end)) rests.add(g.end);
  for (let i = 1; i < count; i++) if (!starts.has(i * mt) && !sounding(i * mt)) rests.add(i * mt);
  for (const tick of rests) {
    if (tick >= count * mt) continue;
    const { m, t } = at(tick);
    m.notes.push({ ...createNote(t), rest: true });
  }
  for (const m of measures) m.notes.sort((a, b) => a.tick - b.tick);

  // 既存の読み込みと同じ正規化を通して、エディタ・保存・動画出力で扱える形にそろえる
  const song = normalizeSong({ ...base, bpm, measures });
  const items = review
    .sort((a, b) => a.tick - b.tick || a.pitch - b.pitch)
    .map((r) => {
      const { measure, cell } = locateTick(song, r.tick);
      return { ...r, measure: measure + 1, beat: `${cell.beat + 1}-${cell.sub + 1}` };
    });
  return { song, detected: notes.length, placed, review: items, offsetSec };
}

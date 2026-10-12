import type { Frets, Measure, Note, Nuance, Picking, Segment, Song, StringNo, StringSel, Strum } from '../types';
import { OPEN_PITCH, STRING_NOS } from '../types';
import { emptyFrets } from './chords';
import { SKIP_TOKEN } from './lyrics';
import type { RhythmPreset } from './presets';
import {
  beatTicks,
  cellIndexAt,
  conformSegments,
  defaultSegments,
  measureCells,
  measureTicks,
  nearestCellIndex,
  parseTimeSignature,
} from './timing';

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

export function createMeasure(index: number, ts: string, segments?: Segment[]): Measure {
  return {
    measureIndex: index,
    segments: segments ? segments.map((s) => ({ ...s })) : defaultSegments(ts, 2),
    chordName: null,
    notes: [],
    chordShape: null,
  };
}

export function createEmptySong(measureCount = 16): Song {
  const ts = '4/4';
  return {
    title: '新しい曲',
    bpm: 120,
    timeSignature: ts,
    height: 250,
    backgroundColor: '#FFFFFF',
    measuresPerPage: 2,
    measures: Array.from({ length: measureCount }, (_, i) => createMeasure(i + 1, ts)),
  };
}

export function createNote(tick: number): Note {
  return { tick, picking: null, frets: emptyFrets(), nuance: null, lyric: null, chord: null, rest: false };
}

// ---------------------------------------------------------------------------
// 音符操作（immer の draft に対して使用）
// ---------------------------------------------------------------------------

export function findNote(m: Measure, tick: number): Note | undefined {
  return m.notes.find((n) => n.tick === tick);
}

export function ensureNote(m: Measure, tick: number): Note {
  let n = findNote(m, tick);
  if (!n) {
    m.notes.push(createNote(tick));
    m.notes.sort((a, b) => a.tick - b.tick);
    n = findNote(m, tick)!;
  }
  return n;
}

export function hasFrets(n: Note): boolean {
  return STRING_NOS.some((s) => n.frets[s] !== null);
}

export function isNoteEmpty(n: Note): boolean {
  return !hasFrets(n) && !n.picking && !n.nuance && !n.lyric && !n.chord && !n.rest && !n.strum;
}

/** 音を鳴らす音符か（フレットまたはピッキングがある） */
export function isPlayed(n: Note): boolean {
  return !n.rest && (hasFrets(n) || n.picking !== null);
}

export function pruneNote(m: Measure, tick: number) {
  const idx = m.notes.findIndex((n) => n.tick === tick);
  if (idx >= 0 && isNoteEmpty(m.notes[idx])) m.notes.splice(idx, 1);
}

export function setFret(m: Measure, tick: number, s: StringNo, v: number | 'x' | null) {
  const n = ensureNote(m, tick);
  n.frets[s] = v;
  if (v !== null) n.rest = false;
  pruneNote(m, tick);
}

export function setPicking(m: Measure, tick: number, p: Picking) {
  const n = ensureNote(m, tick);
  n.picking = p;
  if (p) n.rest = false;
  pruneNote(m, tick);
}

export function setStrum(m: Measure, tick: number, v: Strum) {
  ensureNote(m, tick).strum = v;
  pruneNote(m, tick);
}

export function setNuance(m: Measure, tick: number, v: Nuance) {
  const n = ensureNote(m, tick);
  n.nuance = v;
  if (v) n.rest = false;
  pruneNote(m, tick);
}

/** 休符: 直前の音をここで止める（フレット・ピッキング・奏法は消去） */
export function setRest(m: Measure, tick: number, on: boolean) {
  const n = ensureNote(m, tick);
  n.rest = on;
  if (on) {
    n.frets = emptyFrets();
    n.picking = null;
    n.nuance = null;
  }
  pruneNote(m, tick);
}

export function setLyric(m: Measure, tick: number, v: string) {
  ensureNote(m, tick).lyric = v === '' ? null : v;
  pruneNote(m, tick);
}

export function setChordLabel(m: Measure, tick: number, name: string | null) {
  const v = name && name.trim() ? name.trim() : null;
  if (tick === 0) {
    m.chordName = v;
    const n = findNote(m, 0);
    if (n) {
      n.chord = null;
      pruneNote(m, 0);
    }
  } else {
    ensureNote(m, tick).chord = v;
    pruneNote(m, tick);
  }
}

function cloneFrets(f: Frets): Frets {
  return { ...f };
}

function playedStrings(f: Frets): StringNo[] {
  // 低音弦(6)→高音弦(1)の順
  return (['6', '5', '4', '3', '2', '1'] as StringNo[]).filter((s) => f[s] !== null);
}

/**
 * コードフォームを音符に適用する。
 * 単音（アルペジオ）の音符は同じ弦の音だけを差し替え、その弦が無ければベース弦を使う。
 */
function applyShapeToNote(n: Note, shape: Frets) {
  const strings = playedStrings(n.frets);
  if (strings.length === 1 && playedStrings(shape).length > 1) {
    const s = strings[0];
    const target = shape[s] !== null ? s : playedStrings(shape)[0];
    n.frets = emptyFrets();
    n.frets[target] = shape[target];
    return;
  }
  n.frets = cloneFrets(shape);
}

/**
 * 指定範囲（tick, 両端含む）にコードを適用する。
 * 範囲内に既存の(鳴らす)音符があればそれら全てに、無ければ範囲の先頭に配置する。
 */
export function applyChordToRange(
  m: Measure,
  startTick: number,
  endTick: number,
  shape: Frets,
  name: string | null,
) {
  const targets = m.notes.filter((n) => n.tick >= startTick && n.tick <= endTick && isPlayed(n));
  if (targets.length === 0) {
    const n = ensureNote(m, startTick);
    n.rest = false;
    n.frets = cloneFrets(shape);
  } else {
    for (const n of targets) applyShapeToNote(n, shape);
  }
  if (name !== null) setChordLabel(m, startTick, name);
  if (startTick === 0) m.chordShape = cloneFrets(shape);
}

/** 小節全体に適用（コード名は小節頭） */
export function applyChordToMeasure(m: Measure, shape: Frets, name: string | null, ts: string) {
  for (const n of m.notes) if (n.chord && n.tick > 0) n.chord = null;
  applyChordToRange(m, 0, measureTicks(ts) - 1, shape, name);
  m.chordShape = cloneFrets(shape);
  m.notes = m.notes.filter((n) => !isNoteEmpty(n));
}

// ---------------------------------------------------------------------------
// 分割（拍ごと） / リズムプリセット
// ---------------------------------------------------------------------------

/** 全音符を現在の分割の最も近いマスへ移動する（衝突時は先勝ち。歌詞は引き継ぐ） */
function snapNotes(m: Measure, ts: string) {
  const cells = measureCells(m, ts);
  const mt = measureTicks(ts);
  const kept = new Map<number, Note>();
  for (const n of [...m.notes].filter((x) => x.tick < mt).sort((a, b) => a.tick - b.tick)) {
    const t = cells[nearestCellIndex(cells, n.tick)].tick;
    const ex = kept.get(t);
    if (ex) {
      if (!ex.lyric && n.lyric) ex.lyric = n.lyric;
      if (!ex.chord && n.chord) ex.chord = n.chord;
      continue;
    }
    kept.set(t, { ...n, tick: t });
  }
  m.notes = [...kept.values()].sort((a, b) => a.tick - b.tick);
}

/** 1つの区間の分割を変更する（2拍3連などは後ろの拍を取り込む） */
export function setSegment(m: Measure, ts: string, segIndex: number, seg: Segment) {
  const num = parseTimeSignature(ts).num;
  const startBeat = m.segments.slice(0, segIndex).reduce((a, s) => a + s.beats, 0);
  if (startBeat + seg.beats > num) return;
  // 拍ごとの所属区間
  const owner: number[] = [];
  m.segments.forEach((s, i) => {
    for (let k = 0; k < s.beats; k++) owner.push(i);
  });
  const out: Segment[] = [];
  let b = 0;
  while (b < num) {
    if (b === startBeat) {
      out.push({ ...seg });
      b += seg.beats;
      continue;
    }
    const old = m.segments[owner[b]];
    const oldStart = m.segments.slice(0, owner[b]).reduce((a, s) => a + s.beats, 0);
    const oldEnd = oldStart + old.beats;
    const overlaps = oldStart < startBeat + seg.beats && oldEnd > startBeat;
    if (b === oldStart && !overlaps) {
      out.push({ ...old });
      b += old.beats;
    } else {
      // 新しい区間に一部を取られた区間は1拍ずつに分解
      out.push({ beats: 1, div: old.beats === 1 ? old.div : Math.max(1, Math.round(old.div / old.beats)) });
      b++;
    }
  }
  m.segments = out;
  snapNotes(m, ts);
}

/** 小節の全拍を同じ分割にする */
export function setAllSegments(m: Measure, ts: string, div: number) {
  m.segments = defaultSegments(ts, div);
  snapNotes(m, ts);
}

/** 拍子変更時などに区間・音符を拍子に合わせる */
export function conformMeasure(m: Measure, ts: string) {
  m.segments = conformSegments(m.segments, ts);
  snapNotes(m, ts);
}

function reflectIndex(idx: number, len: number): number {
  if (len <= 0) return 0;
  if (idx <= len) return idx;
  const period = len * 2;
  const r = idx % period;
  return r <= len ? r : period - r;
}

export function applyRhythmPreset(m: Measure, preset: RhythmPreset, ts: string) {
  const firstWithFrets = m.notes.find((n) => hasFrets(n) && playedStrings(n.frets).length > 1);
  const shape: Frets | null = m.chordShape ?? (firstWithFrets ? cloneFrets(firstWithFrets.frets) : null);
  const oldNotes = m.notes;

  m.segments = defaultSegments(ts, preset.div);
  const cells = measureCells(m, ts);
  // 既存の歌詞・途中コード名を最も近いマスで保持する
  const keep = new Map<number, { lyric: string | null; chord: string | null | undefined }>();
  for (const n of oldNotes) {
    if (!n.lyric && !n.chord) continue;
    const t = cells[nearestCellIndex(cells, n.tick)].tick;
    if (!keep.has(t)) keep.set(t, { lyric: n.lyric, chord: n.chord });
  }

  const notes: Note[] = [];
  for (const c of cells) {
    const ch = preset.pattern[c.index % preset.pattern.length];
    const kept = keep.get(c.tick);
    if (ch === '.' || ch === undefined) {
      if (kept) notes.push({ ...createNote(c.tick), lyric: kept.lyric, chord: kept.chord ?? null });
      continue;
    }
    const n = createNote(c.tick);
    n.picking = ch === 'D' || ch === 'd' || ch === 'A' ? 'down' : 'up';
    if (ch === 'd' || ch === 'u') n.nuance = 'mute';
    if (shape) {
      if (ch === 'A' || ch === 'a') {
        const strings = playedStrings(shape);
        const order = preset.arpOrder ?? [0];
        const idx = reflectIndex(order[c.index % order.length], strings.length - 1);
        const s = strings[Math.min(idx, strings.length - 1)];
        n.frets[s] = shape[s];
      } else {
        n.frets = cloneFrets(shape);
      }
    }
    if (kept) {
      n.lyric = kept.lyric;
      n.chord = kept.chord ?? null;
    }
    notes.push(n);
  }
  m.notes = notes;
}

// ---------------------------------------------------------------------------
// 小節操作
// ---------------------------------------------------------------------------

export function reindex(song: Song) {
  song.measures.forEach((m, i) => (m.measureIndex = i + 1));
}

export function cloneMeasure(m: Measure): Measure {
  return JSON.parse(JSON.stringify(m)) as Measure;
}

export function pasteOverwrite(song: Song, at: number, clip: Measure[]) {
  clip.forEach((m, k) => {
    const idx = at + k;
    const copy = cloneMeasure(m);
    if (idx < song.measures.length) song.measures[idx] = copy;
    else song.measures.push(copy);
  });
  reindex(song);
}

export function insertMeasure(song: Song, at: number) {
  const ref = song.measures[Math.min(at, song.measures.length - 1)];
  song.measures.splice(at, 0, createMeasure(at + 1, song.timeSignature, ref?.segments));
  reindex(song);
}

export function deleteMeasures(song: Song, from: number, to: number) {
  song.measures.splice(from, to - from + 1);
  if (song.measures.length === 0) song.measures.push(createMeasure(1, song.timeSignature));
  reindex(song);
}

export function setMeasureCount(song: Song, count: number) {
  const n = Math.max(1, Math.min(999, Math.floor(count)));
  if (n < song.measures.length) song.measures.splice(n);
  while (song.measures.length < n) {
    const last = song.measures[song.measures.length - 1];
    song.measures.push(createMeasure(song.measures.length + 1, song.timeSignature, last?.segments));
  }
  reindex(song);
}

export function setTimeSignature(song: Song, ts: string) {
  song.timeSignature = ts;
  for (const m of song.measures) conformMeasure(m, ts);
}

// ---------------------------------------------------------------------------
// 歌詞
// ---------------------------------------------------------------------------

/**
 * 歌詞トークンを指定位置から順番に割り当てる。
 * 最初のトークンは指定位置のマスに、以降は音を鳴らす音符に1つずつ入る。
 * "_" はその音符を飛ばす。戻り値: 割り当てたトークン数
 */
export function assignLyrics(song: Song, startMeasure: number, startTick: number, tokens: string[]): number {
  let t = 0;
  for (let mi = startMeasure; mi < song.measures.length && t < tokens.length; mi++) {
    const m = song.measures[mi];
    for (const c of measureCells(m, song.timeSignature)) {
      if (t >= tokens.length) break;
      if (mi === startMeasure && c.tick < startTick) continue;
      const isStart = mi === startMeasure && c.tick === startTick;
      if (!isStart) {
        const n = findNote(m, c.tick);
        if (!n || !isPlayed(n)) continue;
      }
      const tok = tokens[t++];
      setLyric(m, c.tick, tok === SKIP_TOKEN ? '' : tok);
    }
  }
  return t;
}

// ---------------------------------------------------------------------------
// 範囲の コピー / 消去 / 貼り付け / 移動
// 位置は曲頭からの通し tick（小節番号 × 小節の tick 数 + 小節内 tick）で扱う
// ---------------------------------------------------------------------------

export interface Clip {
  /** 範囲の長さ（tick） */
  length: number;
  /** 範囲の先頭からの位置と音符（小節頭のコード名は note.chord に入れる） */
  notes: { rel: number; note: Note }[];
  /** 範囲に丸ごと含まれる分割（拍の頭から貼り付ける場合に再現する） */
  segments: { rel: number; seg: Segment }[];
  /** 弦単位でコピーした場合のコピー元の弦（無ければ全弦・音符ごと） */
  strings?: StringNo[];
}

function eachMeasureIn(song: Song, start: number, end: number, fn: (m: Measure, base: number) => void) {
  const mt = measureTicks(song.timeSignature);
  const last = Math.min(song.measures.length - 1, Math.floor((end - 1) / mt));
  for (let mi = Math.max(0, Math.floor(start / mt)); mi <= last; mi++) fn(song.measures[mi], mi * mt);
}

export function copyRange(song: Song, start: number, end: number): Clip {
  const bt = beatTicks(song.timeSignature);
  const clip: Clip = { length: end - start, notes: [], segments: [] };
  eachMeasureIn(song, start, end, (m, base) => {
    const headInRange = base >= start && base < end;
    let hasHead = false;
    for (const n of m.notes) {
      const g = base + n.tick;
      if (g < start || g >= end) continue;
      const copy: Note = JSON.parse(JSON.stringify(n));
      if (n.tick === 0) {
        hasHead = true;
        if (m.chordName) copy.chord = m.chordName;
      }
      clip.notes.push({ rel: g - start, note: copy });
    }
    if (headInRange && !hasHead && m.chordName) {
      clip.notes.push({ rel: base - start, note: { ...createNote(0), chord: m.chordName } });
    }
    let beat = 0;
    for (const seg of m.segments) {
      const s0 = base + beat * bt;
      const s1 = s0 + seg.beats * bt;
      if (s0 >= start && s1 <= end) clip.segments.push({ rel: s0 - start, seg: { ...seg } });
      beat += seg.beats;
    }
  });
  clip.notes.sort((a, b) => a.rel - b.rel);
  return clip;
}

/** 範囲内の音符と小節頭のコード名を消去（分割はそのまま） */
export function clearRange(song: Song, start: number, end: number) {
  eachMeasureIn(song, start, end, (m, base) => {
    m.notes = m.notes.filter((n) => base + n.tick < start || base + n.tick >= end);
    if (base >= start && base < end) m.chordName = null;
  });
}

/** 指定の拍から始まる区間を作る（2拍にまたがる区間の途中なら分解する） */
function setSegmentAtBeat(m: Measure, ts: string, beat: number, seg: Segment) {
  const starts = () => {
    let b = 0;
    return m.segments.map((s) => {
      const r = b;
      b += s.beats;
      return r;
    });
  };
  let idx = starts().indexOf(beat);
  if (idx < 0) {
    const st = starts();
    const containing = st.findIndex((b, i) => b < beat && beat < b + m.segments[i].beats);
    if (containing < 0) return;
    const old = m.segments[containing];
    setSegment(m, ts, containing, { beats: 1, div: Math.max(1, Math.round(old.div / old.beats)) });
    idx = starts().indexOf(beat);
    if (idx < 0) return;
  }
  setSegment(m, ts, idx, seg);
}

/** クリップを dest から貼り付ける（貼り付け先の範囲は上書き） */
export function pasteClip(song: Song, dest: number, clip: Clip) {
  const ts = song.timeSignature;
  const mt = measureTicks(ts);
  const bt = beatTicks(ts);
  clearRange(song, dest, dest + clip.length);
  // 分割: 貼り付け先が拍の頭なら元の分割を再現
  for (const { rel, seg } of clip.segments) {
    const g = dest + rel;
    const mi = Math.floor(g / mt);
    if (g % bt !== 0 || mi >= song.measures.length) continue;
    const beat = (g % mt) / bt;
    if (beat + seg.beats <= parseTimeSignature(ts).num) setSegmentAtBeat(song.measures[mi], ts, beat, seg);
  }
  // 音符: 貼り付け先の最も近いマスへ
  for (const { rel, note } of clip.notes) {
    const g = dest + rel;
    const mi = Math.floor(g / mt);
    if (g < 0 || mi >= song.measures.length) continue;
    const m = song.measures[mi];
    const cells = measureCells(m, ts);
    const tick = cells[nearestCellIndex(cells, g % mt)].tick;
    if (findNote(m, tick)) continue;
    const n: Note = { ...JSON.parse(JSON.stringify(note)), tick };
    if (tick === 0 && n.chord) {
      m.chordName = n.chord;
      n.chord = null;
    }
    m.notes.push(n);
    m.notes.sort((a, b) => a.tick - b.tick);
    pruneNote(m, tick);
  }
}

export function moveRange(song: Song, start: number, end: number, dest: number) {
  const clip = copyRange(song, start, end);
  clearRange(song, start, end);
  pasteClip(song, dest, clip);
}

/** 選択範囲にコードを入力する（小節を丸ごと含む部分は小節全体に、それ以外はその範囲に） */
export function applyChordToSpan(song: Song, start: number, end: number, shape: Frets, name: string | null) {
  const ts = song.timeSignature;
  const mt = measureTicks(ts);
  eachMeasureIn(song, start, end, (m, base) => {
    const s = Math.max(start, base) - base;
    const e = Math.min(end, base + mt) - base;
    if (s === 0 && e === mt) {
      applyChordToMeasure(m, shape, name, ts);
      return;
    }
    const cells = measureCells(m, ts);
    applyChordToRange(m, cells[cellIndexAt(cells, s)].tick, cells[cellIndexAt(cells, e - 1)].tick, shape, name);
  });
}

/** 選択範囲を含む小節の番号（0始まり） */
export function measuresInSpan(song: Song, start: number, end: number): number[] {
  const mt = measureTicks(song.timeSignature);
  const out: number[] = [];
  for (let i = Math.floor(start / mt); i <= Math.floor((end - 1) / mt) && i < song.measures.length; i++) out.push(i);
  return out;
}

// ---------------------------------------------------------------------------
// 選択範囲（時間 × 弦）への編集コマンド
// ---------------------------------------------------------------------------

/** 範囲内の各マスを列挙する */
function eachCellIn(song: Song, start: number, end: number, fn: (m: Measure, tick: number) => void) {
  eachMeasureIn(song, start, end, (m, base) => {
    for (const c of measureCells(m, song.timeSignature)) {
      const g = base + c.tick;
      if (g >= start && g < end) fn(m, c.tick);
    }
  });
}

/** 範囲内の音を鳴らす音符を列挙する */
function eachPlayedIn(song: Song, start: number, end: number, fn: (n: Note, m: Measure) => void) {
  eachMeasureIn(song, start, end, (m, base) => {
    for (const n of m.notes) if (base + n.tick >= start && base + n.tick < end && isPlayed(n)) fn(n, m);
  });
}

/** 範囲内の全マス × 指定弦にフレットを一括入力 */
export function setFretInRange(song: Song, start: number, end: number, strings: StringNo[], v: number | 'x' | null) {
  eachCellIn(song, start, end, (m, tick) => {
    for (const s of strings) setFret(m, tick, s, v);
  });
}

/**
 * ピッキング・奏法・休符などを範囲に付与する。
 * 範囲内に音符があればその全てに、無ければ各マスに付ける。
 */
export function applyToNotesInRange(song: Song, start: number, end: number, fn: (m: Measure, tick: number) => void) {
  const targets: [Measure, number][] = [];
  eachPlayedIn(song, start, end, (n, m) => targets.push([m, n.tick]));
  if (targets.length === 0) eachCellIn(song, start, end, (m, tick) => targets.push([m, tick]));
  for (const [m, tick] of targets) fn(m, tick);
}

/** 選択弦のフレットを delta だけずらす（A / D キー） */
export function shiftFrets(song: Song, start: number, end: number, strings: StringSel, delta: number) {
  eachPlayedIn(song, start, end, (n) => {
    for (const s of strings ?? STRING_NOS) {
      const v = n.frets[s];
      if (typeof v === 'number') n.frets[s] = Math.max(0, Math.min(24, v + delta));
    }
  });
}

/**
 * 同じ音の高さのまま隣の弦へ移動する（Alt+↑↓）。
 * dir = -1: 1弦側（上）へ / +1: 6弦側（下）へ
 */
export function moveToAdjacentString(
  song: Song,
  start: number,
  end: number,
  strings: StringSel,
  dir: -1 | 1,
) {
  const sel = strings ?? STRING_NOS;
  // 移動方向の先にある弦から順に処理して、移動同士がぶつからないようにする
  const order = [...sel].sort((a, b) => (dir < 0 ? +a - +b : +b - +a));
  eachPlayedIn(song, start, end, (n) => {
    for (const s of order) {
      const v = n.frets[s];
      const t = String(+s + dir) as StringNo;
      if (typeof v !== 'number' || !STRING_NOS.includes(t) || n.frets[t] !== null) continue;
      const fret = OPEN_PITCH[s] + v - OPEN_PITCH[t];
      if (fret < 0 || fret > 24) continue;
      n.frets[t] = fret;
      n.frets[s] = null;
    }
  });
}

/** 弦の選択を隣の弦へずらす */
export function shiftStringSel(strings: StringSel, dir: -1 | 1): StringSel {
  return strings ? strings.map((s) => String(Math.max(1, Math.min(6, +s + dir))) as StringNo) : null;
}

/** 範囲に掛かる拍の分割を細かく（2倍）する。duplicate=true なら新しいマスに直前の音を複製 */
export function splitInRange(song: Song, start: number, end: number, duplicate: boolean) {
  const ts = song.timeSignature;
  const bt = beatTicks(ts);
  eachMeasureIn(song, start, end, (m, base) => {
    const before = new Set(measureCells(m, ts).map((c) => c.tick));
    let beat = 0;
    m.segments.forEach((seg, i) => {
      const s0 = base + beat * bt;
      const s1 = s0 + seg.beats * bt;
      beat += seg.beats;
      if (s1 <= start || s0 >= end || seg.beats !== 1 || seg.div * 2 > 8) return;
      setSegment(m, ts, i, { beats: 1, div: seg.div * 2 });
    });
    if (!duplicate) return;
    let prev: Note | undefined;
    for (const c of measureCells(m, ts)) {
      const g = base + c.tick;
      const n = findNote(m, c.tick);
      if (!before.has(c.tick) && g >= start && g < end && !n && prev && isPlayed(prev)) {
        const copy = createNote(c.tick);
        copy.frets = cloneFrets(prev.frets);
        copy.picking = prev.picking === 'down' ? 'up' : prev.picking === 'up' ? 'down' : null;
        if (prev.nuance === 'mute') copy.nuance = 'mute';
        m.notes.push(copy);
        m.notes.sort((a, b) => a.tick - b.tick);
        prev = copy;
        continue;
      }
      if (n) prev = n;
    }
  });
}

/** 範囲に掛かる拍の分割を粗く（半分）する */
export function mergeInRange(song: Song, start: number, end: number) {
  const ts = song.timeSignature;
  const bt = beatTicks(ts);
  eachMeasureIn(song, start, end, (m, base) => {
    let beat = 0;
    m.segments.forEach((seg, i) => {
      const s0 = base + beat * bt;
      const s1 = s0 + seg.beats * bt;
      beat += seg.beats;
      if (s1 <= start || s0 >= end || seg.beats !== 1 || seg.div === 1) return;
      setSegment(m, ts, i, { beats: 1, div: seg.div % 2 === 0 ? seg.div / 2 : 1 });
    });
  });
}

export const CHORD_EXPANSIONS: { id: string; name: string; intervals: number[] }[] = [
  { id: 'power', name: 'パワーコード（ルート＋5度）', intervals: [0, 7] },
  { id: 'power8', name: 'パワーコード＋オクターブ', intervals: [0, 7, 12] },
  { id: 'octave', name: 'オクターブ', intervals: [0, 12] },
  { id: 'major', name: 'メジャー', intervals: [0, 7, 12, 16, 19, 24] },
  { id: 'minor', name: 'マイナー', intervals: [0, 7, 12, 15, 19, 24] },
  { id: 'seventh', name: 'セブンス', intervals: [0, 7, 10, 16, 19, 24] },
  { id: 'm7', name: 'マイナーセブンス', intervals: [0, 7, 10, 15, 19, 24] },
];

/**
 * 置いた音（一番低い音）をルートにしてコードへ展開する。
 * 構成音はルートより高い弦へ順に、ルートのフレットから4フレット以内で配置する。
 */
export function expandChordInRange(song: Song, start: number, end: number, intervals: number[]) {
  eachPlayedIn(song, start, end, (n) => {
    const fretted = STRING_NOS.filter((s) => typeof n.frets[s] === 'number');
    if (fretted.length === 0) return;
    const pitch = (s: StringNo) => OPEN_PITCH[s] + (n.frets[s] as number);
    const rootString = fretted.reduce((a, b) => (pitch(b) < pitch(a) ? b : a));
    const rootFret = n.frets[rootString] as number;
    const rootPitch = pitch(rootString);
    const frets = emptyFrets();
    frets[rootString] = rootFret;
    let last = +rootString;
    for (const iv of intervals) {
      if (iv === 0) continue;
      for (let s = last - 1; s >= 1; s--) {
        const sn = String(s) as StringNo;
        const f = rootPitch + iv - OPEN_PITCH[sn];
        if (f >= 0 && f <= 24 && Math.abs(f - rootFret) <= 4) {
          frets[sn] = f;
          last = s;
          break;
        }
      }
    }
    n.frets = frets;
  });
}

/**
 * リズムだけを貼り付ける（タイミング・ピッキング・奏法・休符はコピー元から、フレットは貼り付け先のコードから）。
 * 単音（アルペジオ）は同じ弦の音を、和音は貼り付け先のコードの押さえ方を使う。
 */
export function pasteRhythm(song: Song, dest: number, clip: Clip) {
  const ts = song.timeSignature;
  const mt = measureTicks(ts);
  const end = dest + clip.length;
  // 貼り付け先のコードの押さえ方
  let shape: Frets | null = null;
  eachPlayedIn(song, dest, end, (n) => {
    if (!shape && playedStrings(n.frets).length > 1) shape = cloneFrets(n.frets);
  });
  if (!shape) {
    const m = song.measures[Math.min(song.measures.length - 1, Math.floor(dest / mt))];
    if (m.chordShape) shape = cloneFrets(m.chordShape);
  }
  if (!shape) {
    eachPlayedIn(song, dest, end, (n) => {
      if (!shape && hasFrets(n)) shape = cloneFrets(n.frets);
    });
  }
  // 歌詞・コード名は残し、分割はコピー元に合わせる
  const keep: Clip = copyRange(song, dest, end);
  keep.length = clip.length;
  keep.notes = keep.notes
    .filter(({ note }) => note.lyric || note.chord)
    .map(({ rel, note }) => ({ rel, note: { ...createNote(0), lyric: note.lyric, chord: note.chord } }));
  keep.segments = clip.segments;
  pasteClip(song, dest, keep);
  // コピー元で一番低い弦（ベース）。単音はベース→ベース、それ以外は同じ弦（無ければ近い弦）に対応させる
  const srcBass = Math.max(0, ...clip.notes.flatMap(({ note }) => STRING_NOS.filter((st) => note.frets[st] !== null).map(Number)));
  const mapString = (st: StringNo, target: Frets): StringNo => {
    const avail = playedStrings(target);
    if (+st === srcBass) return avail[0];
    if (target[st] !== null) return st;
    return avail.reduce((a, b) => (Math.abs(+b - +st) < Math.abs(+a - +st) ? b : a));
  };
  for (const { rel, note } of clip.notes) {
    if (!isPlayed(note) && !note.rest) continue;
    const g = dest + rel;
    const mi = Math.floor(g / mt);
    if (mi >= song.measures.length) continue;
    const m = song.measures[mi];
    const cells = measureCells(m, ts);
    const tick = cells[nearestCellIndex(cells, g % mt)].tick;
    const n = ensureNote(m, tick);
    n.picking = note.picking;
    n.nuance = note.nuance;
    n.strum = note.strum ?? null;
    n.rest = note.rest;
    n.frets = cloneFrets(note.frets);
    const target: Frets | null = shape;
    if (target && hasFrets(note)) {
      const own = playedStrings(note.frets);
      if (own.length === 1 && playedStrings(target).length > 1) {
        const st = mapString(own[0], target);
        n.frets = emptyFrets();
        n.frets[st] = target[st];
      } else {
        n.frets = cloneFrets(target);
      }
    }
    pruneNote(m, tick);
  }
}

// ---------------------------------------------------------------------------
// 弦単位のコピー / 貼り付け（例: 6〜4弦をコピーして 5〜3弦へ貼り付け）
// ---------------------------------------------------------------------------

/** 指定した弦のフレットだけをコピーする */
export function copyStrings(song: Song, start: number, end: number, strings: StringNo[]): Clip {
  const clip: Clip = { length: end - start, notes: [], segments: [], strings: [...strings] };
  eachMeasureIn(song, start, end, (m, base) => {
    for (const n of m.notes) {
      const g = base + n.tick;
      if (g < start || g >= end || !strings.some((s) => n.frets[s] !== null)) continue;
      const note = createNote(0);
      for (const s of strings) note.frets[s] = n.frets[s];
      clip.notes.push({ rel: g - start, note });
    }
  });
  clip.notes.sort((a, b) => a.rel - b.rel);
  return clip;
}

/**
 * 弦単位のクリップを貼り付ける。コピー元の一番上の弦を topString に合わせ、
 * 1〜6弦からはみ出す場合は収まるようにずらす。戻り値は貼り付け先の弦
 */
export function pasteStrings(song: Song, dest: number, clip: Clip, topString: number): StringNo[] {
  const src = clip.strings ?? [];
  const lo = Math.min(...src.map(Number));
  const hi = Math.max(...src.map(Number));
  const offset = Math.max(1 - lo, Math.min(6 - hi, topString - lo));
  const target = (s: StringNo) => String(+s + offset) as StringNo;
  const ts = song.timeSignature;
  const mt = measureTicks(ts);
  setFretInRange(song, dest, dest + clip.length, src.map(target), null);
  for (const { rel, note } of clip.notes) {
    const g = dest + rel;
    const mi = Math.floor(g / mt);
    if (mi >= song.measures.length) continue;
    const m = song.measures[mi];
    const cells = measureCells(m, ts);
    const tick = cells[nearestCellIndex(cells, g % mt)].tick;
    for (const s of src) if (note.frets[s] !== null) setFret(m, tick, target(s), note.frets[s]);
  }
  return src.map(target);
}

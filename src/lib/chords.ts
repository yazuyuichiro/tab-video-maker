import type { Frets, StringNo } from '../types';

export const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

interface QualityDef {
  names: string[];
  intervals: number[];
  /** 省略しても良い構成音（主に5度） */
  optional?: number[];
}

const QUALITIES: QualityDef[] = [
  { names: ['', 'M', 'maj', 'Maj'], intervals: [0, 4, 7] },
  { names: ['m', 'min', '-'], intervals: [0, 3, 7] },
  { names: ['7', 'dom7'], intervals: [0, 4, 7, 10], optional: [7] },
  { names: ['M7', 'maj7', 'Maj7', '△7', '△', 'ma7'], intervals: [0, 4, 7, 11], optional: [7] },
  { names: ['m7', 'min7', '-7', 'mi7'], intervals: [0, 3, 7, 10], optional: [7] },
  { names: ['mM7', 'm(maj7)', 'mmaj7', 'm△7', 'm(M7)', 'mMaj7'], intervals: [0, 3, 7, 11], optional: [7] },
  { names: ['6'], intervals: [0, 4, 7, 9], optional: [7] },
  { names: ['m6'], intervals: [0, 3, 7, 9], optional: [7] },
  { names: ['69', '6(9)', '6/9'], intervals: [0, 4, 7, 9, 2], optional: [7] },
  { names: ['9', '7(9)'], intervals: [0, 4, 7, 10, 2], optional: [7] },
  { names: ['m9', 'm7(9)'], intervals: [0, 3, 7, 10, 2], optional: [7] },
  { names: ['M9', 'maj9', 'M7(9)'], intervals: [0, 4, 7, 11, 2], optional: [7] },
  { names: ['add9', '(9)', 'add2'], intervals: [0, 4, 7, 2], optional: [7] },
  { names: ['madd9', 'm(9)', 'madd2', 'm(add9)'], intervals: [0, 3, 7, 2], optional: [7] },
  { names: ['add11', '(11)'], intervals: [0, 4, 7, 5], optional: [7] },
  { names: ['sus4', 'sus'], intervals: [0, 5, 7] },
  { names: ['sus2'], intervals: [0, 2, 7] },
  { names: ['7sus4', '7sus'], intervals: [0, 5, 7, 10], optional: [7] },
  { names: ['dim', 'o', '°'], intervals: [0, 3, 6] },
  { names: ['dim7', 'o7', '°7'], intervals: [0, 3, 6, 9] },
  { names: ['m7b5', 'm7-5', 'm7(b5)', 'm7(-5)', 'ø', 'ø7'], intervals: [0, 3, 6, 10] },
  { names: ['aug', '+', '(#5)', '+5'], intervals: [0, 4, 8] },
  { names: ['aug7', '7#5', '7(#5)', '7+5', '7(+5)', '+7'], intervals: [0, 4, 8, 10] },
  { names: ['7b5', '7(b5)', '7-5', '7(-5)'], intervals: [0, 4, 6, 10] },
  { names: ['7b9', '7(b9)', '7(-9)', '7-9'], intervals: [0, 4, 7, 10, 1], optional: [7] },
  { names: ['7#9', '7(#9)', '7(+9)', '7+9'], intervals: [0, 4, 7, 10, 3], optional: [7] },
  { names: ['11', '7(11)'], intervals: [0, 5, 7, 10, 2], optional: [7, 2] },
  { names: ['13', '7(13)'], intervals: [0, 4, 7, 10, 9], optional: [7] },
  { names: ['5', '(omit3)'], intervals: [0, 7] },
];

const QUALITY_MAP = new Map<string, QualityDef>();
for (const q of QUALITIES) for (const n of q.names) QUALITY_MAP.set(n, q);

/** UI用のよく使う種類 */
export const COMMON_QUALITIES = [
  '', 'm', '7', 'M7', 'm7', 'sus4', '7sus4', 'add9', 'sus2', '6', 'm6', 'dim', 'm7b5', 'aug', 'mM7', '9', '5',
];

export interface ParsedChord {
  name: string;
  root: number;
  bass: number;
  intervals: number[];
  optional: number[];
}

function parseNote(s: string): { pc: number; rest: string } | null {
  const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(s);
  if (!m) return null;
  let pc = PC[m[1].toUpperCase()];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return { pc: (pc + 12) % 12, rest: m[3] };
}

function normalize(s: string): string {
  return s
    .trim()
    .replace(/[\s　]/g, '')
    .replace(/[＃♯]/g, '#')
    .replace(/[♭]/g, 'b')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[／]/g, '/')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

export function parseChord(input: string): ParsedChord | null {
  const s = normalize(input);
  if (!s) return null;
  const head = parseNote(s);
  if (!head) return null;
  let rest = head.rest;
  let bass = head.pc;
  const slash = rest.lastIndexOf('/');
  if (slash >= 0) {
    const b = parseNote(rest.slice(slash + 1));
    if (b && b.rest === '') {
      bass = b.pc;
      rest = rest.slice(0, slash);
    }
  }
  const q = QUALITY_MAP.get(rest) ?? QUALITY_MAP.get(rest.replace(/[()]/g, ''));
  if (!q) return null;
  return {
    name: s,
    root: head.pc,
    bass,
    intervals: q.intervals,
    optional: q.optional ?? [],
  };
}

// ---------------------------------------------------------------------------
// ボイシング（押さえ方）自動生成
// ---------------------------------------------------------------------------

/** index 0 = 6弦 ... index 5 = 1弦 */
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];
type Shape = (number | null)[];

export interface Voicing {
  frets: Frets;
  label: string;
  /** ダイアグラム表示の開始フレット */
  baseFret: number;
}

export function shapeToFrets(shape: Shape): Frets {
  const f = {} as Frets;
  for (let i = 0; i < 6; i++) f[String(6 - i) as StringNo] = shape[i];
  return f;
}

export function fretsToShapeString(frets: Frets): string {
  return (['6', '5', '4', '3', '2', '1'] as StringNo[])
    .map((s) => (frets[s] === null ? 'x' : String(frets[s])))
    .join(frets && Object.values(frets).some((v) => typeof v === 'number' && v >= 10) ? '-' : '');
}

interface Candidate {
  shape: Shape;
  score: number;
  pos: number;
  bassString: number;
  omitted: boolean;
}

function evaluate(shape: Shape, chord: ParsedChord): Candidate | null {
  const played: number[] = [];
  for (let i = 0; i < 6; i++) if (shape[i] !== null) played.push(i);
  const minStrings = chord.intervals.length <= 2 ? 2 : 3;
  if (played.length < minStrings) return null;

  // ミュートは低音側の連続 + 1弦のみ許容（内側の弦は鳴らす）
  const first = played[0];
  const last = played[played.length - 1];
  if (last - first + 1 !== played.length) return null;
  if (last < 4) return null;

  const pcs = played.map((i) => (OPEN_MIDI[i] + (shape[i] as number)) % 12);
  if (pcs[0] !== chord.bass) return null;
  const tones = new Set(chord.intervals.map((iv) => (chord.root + iv) % 12));
  // 分数コードのベース音（構成音外）は最低音のみに許可
  if (!tones.has(chord.bass) && pcs.slice(1).includes(chord.bass)) return null;
  const required = chord.intervals
    .filter((iv) => !chord.optional.includes(iv))
    .map((iv) => (chord.root + iv) % 12);
  const have = new Set(pcs);
  for (const r of required) if (!have.has(r)) return null;
  if (chord.bass !== chord.root && !tones.has(chord.bass) && !have.has(chord.root)) return null;
  const omitted = chord.intervals.some((iv) => !have.has((chord.root + iv) % 12));

  const fretted = played.filter((i) => (shape[i] as number) > 0);
  const open = played.length - fretted.length;
  let minF = 0;
  let maxF = 0;
  let fingers = 0;
  let barre = false;
  if (fretted.length) {
    const fs = fretted.map((i) => shape[i] as number);
    minF = Math.min(...fs);
    maxF = Math.max(...fs);
    if (maxF - minF > 3) return null;
    const atMin = fretted.filter((i) => shape[i] === minF);
    if (atMin.length > 1) {
      // セーハ可能か: セーハ範囲内に開放弦が無いこと
      const lo = atMin[0];
      const hi = atMin[atMin.length - 1];
      barre = true;
      for (let i = lo; i <= hi; i++) {
        if (shape[i] === 0) barre = false;
      }
      // セーハは最高音側まで押さえるのが自然（範囲より高音側に開放弦がある場合のみ不可）
    }
    const upper = fretted.filter((i) => (shape[i] as number) > minF || !barre);
    // 同フレットで隣接する3弦以上は1本の指（部分セーハ）で押さえられる
    fingers = barre ? 1 : 0;
    let k = 0;
    while (k < upper.length) {
      let j = k;
      while (j + 1 < upper.length && upper[j + 1] === upper[j] + 1 && shape[upper[j + 1]] === shape[upper[k]]) j++;
      fingers += j - k + 1 >= 3 ? 1 : j - k + 1;
      k = j + 1;
    }
    if (fingers > 4) return null;
  }
  if (open > 0 && maxF > 7) return null;

  let score = played.length * 3;
  score -= fingers * 1.2;
  score -= (maxF - minF) * 0.6;
  score -= minF * 0.15;
  if (omitted) score -= 1.5;
  if (pcs[0] === chord.root && first <= 1) score += 2;
  if (shape[5] === null) score -= 2.5;
  if (open > 0 && maxF > 4) score -= 10;
  // 6弦を押さえて5弦を開放にするフォームは一般的でない
  if (shape[0] !== null && (shape[0] as number) > 0 && shape[1] === 0) score -= 3;
  if (open > 0 && maxF <= 3) score += 1.5;
  if (barre && open > 0) score -= 1;
  const roots = pcs.filter((p) => p === chord.root).length;
  score += Math.min(roots - 1, 2) * 0.5;
  // 隣り合う同音の重複を減点
  for (let k = 1; k < played.length; k++) {
    const a = OPEN_MIDI[played[k - 1]] + (shape[played[k - 1]] as number);
    const b = OPEN_MIDI[played[k]] + (shape[played[k]] as number);
    if (a === b) score -= 3;
    if (b < a) score -= 4;
  }
  const pos = open > 0 && minF <= 4 ? 0 : minF;
  return { shape: [...shape], score, pos, bassString: 6 - first, omitted };
}

const CACHE = new Map<string, Voicing[]>();

export function generateVoicings(input: string, max = 8): Voicing[] {
  const chord = parseChord(input);
  if (!chord) return [];
  const key = `${chord.root}:${chord.bass}:${chord.intervals.join(',')}:${max}`;
  const cached = CACHE.get(key);
  if (cached) return cached;

  const tones = new Set(chord.intervals.map((iv) => (chord.root + iv) % 12));
  tones.add(chord.bass);
  const found = new Map<string, Candidate>();
  for (let base = 1; base <= 12; base++) {
    const options: (number | null)[][] = OPEN_MIDI.map((open) => {
      const o: (number | null)[] = [null];
      if (tones.has(open % 12)) o.push(0);
      for (let f = base; f <= base + 3; f++) if (tones.has((open + f) % 12)) o.push(f);
      return o;
    });
    const shape: Shape = new Array(6).fill(null);
    const rec = (i: number) => {
      if (i === 6) {
        const k = shape.join(',');
        if (found.has(k)) return;
        const c = evaluate(shape, chord);
        if (c) found.set(k, c);
        return;
      }
      for (const o of options[i]) {
        shape[i] = o;
        rec(i + 1);
      }
    };
    rec(0);
  }

  const sorted = [...found.values()].sort((a, b) => b.score - a.score);
  const chosen: Candidate[] = [];
  for (const c of sorted) {
    if (chosen.length >= max) break;
    const similar = chosen.some(
      (o) => Math.abs(o.pos - c.pos) <= 1 && o.bassString === c.bassString,
    );
    if (similar) continue;
    chosen.push(c);
  }
  // 省略形も1つは候補に入れる（高音弦4本程度の軽いフォーム）
  if (chosen.length < max) {
    const light = sorted.find(
      (c) => !chosen.includes(c) && c.shape.filter((v) => v !== null).length <= 4,
    );
    if (light) chosen.push(light);
  }
  chosen.sort((a, b) => a.pos - b.pos || b.bassString - a.bassString);

  const result: Voicing[] = chosen.map((c) => {
    const fretted = c.shape.filter((v): v is number => v !== null && v > 0);
    const minF = fretted.length ? Math.min(...fretted) : 1;
    const maxF = fretted.length ? Math.max(...fretted) : 1;
    const baseFret = maxF <= 5 ? 1 : minF;
    const playedCount = c.shape.filter((v) => v !== null).length;
    let label: string;
    if (c.pos === 0) label = 'ローコード';
    else label = `ハイコード ${minF}f (${c.bassString}弦ルート)`;
    if (playedCount <= 4 || c.omitted) label += ' / 省略形';
    return { frets: shapeToFrets(c.shape), label, baseFret };
  });
  CACHE.set(key, result);
  return result;
}

/** パワーコードなど単純なフォーム用：空のフレット */
export function emptyFrets(): Frets {
  return { '1': null, '2': null, '3': null, '4': null, '5': null, '6': null };
}

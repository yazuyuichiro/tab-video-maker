import type { Note, Song, StringNo } from '../types';
import { NUANCE_LABEL, VIDEO_WIDTH } from '../types';
import { beatTicks, isEvent, measureQuarters, pageRange, parseTimeSignature, secToQuarter, type Timeline, type TimelineNote } from './timing';

export const FONT_FAMILY =
  '"Noto Sans JP","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic UI","Yu Gothic","Meiryo",sans-serif';

export interface RenderSelection {
  /** 選択範囲（曲頭からの4分音符単位）: 開始〜終了 */
  startQ: number;
  endQ: number;
  string: StringNo | null;
}

export interface RenderOptions {
  /** 編集位置のハイライト（プレビュー専用。動画書き出しでは渡さない） */
  selection?: RenderSelection | null;
}

/** 基準高さ250pxでのレイアウト（実際は高さに合わせて拡縮） */
const L = {
  chordY: 20,
  pickY: 44,
  stringTop: 64,
  stringGap: 21,
  /** リズム表記: 符尾の上端と連桁の位置 */
  stemTop: 180,
  beamY: 210,
  lyricY: 236,
  labelW: 34,
};

interface Theme {
  text: string;
  outline: string;
  string: string;
  bar: string;
  beat: string;
  target: string;
  noteBox: string;
  noteBorder: string;
  activeBox: string;
  activeText: string;
  highlight: string;
  sustain: string;
  sustainActive: string;
  countBg: string;
  selection: string;
  selectionStroke: string;
}

/** 黒背景用 */
const DARK: Theme = {
  text: '#FFFFFF',
  outline: 'rgba(0,0,0,0.9)',
  string: 'rgba(255,255,255,0.85)',
  bar: '#FFFFFF',
  beat: 'rgba(255,255,255,0.28)',
  target: '#FF2A2A',
  noteBox: '#151515',
  noteBorder: 'rgba(255,255,255,0.8)',
  activeBox: '#FFD400',
  activeText: '#111111',
  highlight: '#FFD400',
  sustain: 'rgba(255,196,0,0.5)',
  sustainActive: 'rgba(255,212,0,0.95)',
  countBg: 'rgba(30,30,30,0.95)',
  selection: 'rgba(0,200,255,0.3)',
  selectionStroke: '#00C8FF',
};

/** 白背景用 */
const LIGHT: Theme = {
  text: '#111111',
  outline: 'rgba(255,255,255,0.95)',
  string: 'rgba(0,0,0,0.8)',
  bar: '#111111',
  beat: 'rgba(0,0,0,0.22)',
  target: '#E00000',
  noteBox: '#FFFFFF',
  noteBorder: '#222222',
  activeBox: '#FF9800',
  activeText: '#111111',
  highlight: '#E65100',
  sustain: 'rgba(255,152,0,0.45)',
  sustainActive: 'rgba(245,124,0,0.95)',
  countBg: '#FFFFFF',
  selection: 'rgba(0,150,255,0.22)',
  selectionStroke: '#0090FF',
};

let C: Theme = DARK;

const ALL_STRINGS: StringNo[] = ['1', '2', '3', '4', '5', '6'];

/** 弦のY座標（TAB標準: 1弦が上、6弦が下） */
function stringY(st: StringNo, s: number): number {
  return (L.stringTop + (parseInt(st, 10) - 1) * L.stringGap) * s;
}

function font(px: number, weight = 700) {
  return `${weight} ${px}px ${FONT_FAMILY}`;
}

function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  outline: number,
) {
  ctx.lineJoin = 'round';
  ctx.lineWidth = outline;
  ctx.strokeStyle = C.outline;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function outlinedStroke(ctx: CanvasRenderingContext2D, color: string, width: number, outline: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = width + outline * 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPicking(ctx: CanvasRenderingContext2D, kind: 'down' | 'up', x: number, y: number, s: number, color: string) {
  const w = 7 * s;
  const h = 7 * s;
  ctx.beginPath();
  if (kind === 'down') {
    ctx.moveTo(x - w, y + h);
    ctx.lineTo(x - w, y - h);
    ctx.lineTo(x + w, y - h);
    ctx.lineTo(x + w, y + h);
  } else {
    ctx.moveTo(x - w, y - h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + w, y - h);
  }
  outlinedStroke(ctx, color, 2.6 * s, 1.6 * s);
  if (kind === 'down') {
    ctx.fillStyle = color;
    ctx.fillRect(x - w, y - h - 1.3 * s, w * 2, 3.6 * s);
  }
}

function lowerBound(notes: TimelineNote[], q: number): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].q < q) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function fretText(n: Note, v: number | 'x' | null): string | null {
  if (v === null) return null;
  if (v === 'x' || n.nuance === 'mute') return 'x';
  if (n.nuance === 'tie') return `(${v})`;
  return String(v);
}

/** じゃらーんと弾く矢印（音符の左側、押さえる弦の範囲に縦線） */
function drawStrum(ctx: CanvasRenderingContext2D, n: Note, x: number, s: number, color: string) {
  const played = ALL_STRINGS.filter((st) => n.frets[st] !== null);
  const strings = played.length ? played : ALL_STRINGS;
  const yTop = stringY(strings[0], s) - 9 * s;
  const yBot = stringY(strings[strings.length - 1], s) + 9 * s;
  const ax = x - 16 * s;
  const up = n.strum === 'up';
  ctx.beginPath();
  ctx.moveTo(ax, up ? yBot : yTop);
  ctx.lineTo(ax, up ? yTop + 4 * s : yBot - 4 * s);
  outlinedStroke(ctx, color, 2.2 * s, 1.2 * s);
  const tip = up ? yTop - 5 * s : yBot + 5 * s;
  const back = up ? tip + 12 * s : tip - 12 * s;
  ctx.beginPath();
  ctx.moveTo(ax, tip);
  ctx.lineTo(ax - 6.5 * s, back);
  ctx.lineTo(ax + 6.5 * s, back);
  ctx.closePath();
  ctx.lineWidth = 2.4 * s;
  ctx.strokeStyle = C.outline;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * 1フレームを描画する。
 * ページ送り方式: 楽譜は止めたまま赤線が左→右へ進み、ページ右端に着いたら次のページへ切り替わる。
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  song: Song,
  tl: Timeline,
  timeSec: number,
  opts: RenderOptions = {},
) {
  const W = VIDEO_WIDTH;
  const H = song.height;
  const s = H / 250;
  const qNow = secToQuarter(song, timeSec);
  const topY = stringY('1', s);
  const botY = stringY('6', s);
  const labelW = L.labelW * s;
  const EPS = 1e-6;
  C = song.backgroundColor === '#FFFFFF' ? LIGHT : DARK;

  // 表示中のページと座標変換
  const { start: pageStart, end: pageEnd } = pageRange(song, qNow);
  /** 拍子記号の列 */
  const tsX = labelW + 20 * s;
  const left = labelW + 46 * s;
  // 各小節は小節線の少し右から始める（音符が小節線に重ならないように）
  const mq = measureQuarters(song.timeSignature);
  const measureW = (W - 20 * s - left) / Math.max(1, Math.round((pageEnd - pageStart) / mq));
  const pad = 20 * s;
  const barX = (q: number) => left + ((q - pageStart) / mq) * measureW;
  /** 音符などの位置（小節頭の音符は小節線＋余白） */
  const xOf = (q: number) => {
    const k = Math.floor((q - pageStart) / mq + EPS);
    return barX(pageStart + k * mq) + pad + ((q - pageStart - k * mq) / mq) * (measureW - pad);
  };
  /** 終わりの位置（ちょうど小節線上なら小節線） */
  const xEnd = (q: number) => {
    const r = (q - pageStart) / mq;
    return Math.abs(r - Math.round(r)) < EPS ? barX(q) : xOf(q);
  };
  const visible = (q: number) => q >= pageStart - EPS && q < pageEnd - EPS;
  const cursorQ = Math.max(pageStart, Math.min(pageEnd, tl.totalQuarters, qNow));
  const cursorX = cursorQ >= Math.min(pageEnd, tl.totalQuarters) - EPS ? barX(cursorQ) : xOf(cursorQ);
  const stringsEnd = barX(Math.min(pageEnd, tl.totalQuarters));

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 1. 背景
  ctx.fillStyle = song.backgroundColor;
  ctx.fillRect(0, 0, W, H);

  // 2. 弦
  for (const st of ALL_STRINGS) {
    const y = Math.round(stringY(st, s)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(labelW, y);
    ctx.lineTo(stringsEnd, y);
    outlinedStroke(ctx, C.string, 1.8 * s, 1.2 * s);
  }

  // 3. 拍線
  ctx.save();
  ctx.setLineDash([3 * s, 4 * s]);
  ctx.strokeStyle = C.beat;
  ctx.lineWidth = 1.5 * s;
  for (const bq of tl.beatQ) {
    if (!visible(bq)) continue;
    const x = Math.round(xOf(bq)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, topY - 6 * s);
    ctx.lineTo(x, botY + 6 * s);
    ctx.stroke();
  }
  ctx.restore();

  // 小節線（ページ右端の閉じ線を含む）と小節番号
  tl.barQ.forEach((bq, i) => {
    if (bq < pageStart - EPS || bq > pageEnd + EPS) return;
    const x = Math.round(barX(bq)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, topY);
    ctx.lineTo(x, botY);
    outlinedStroke(ctx, C.bar, (i === tl.barQ.length - 1 ? 4 : 2) * s, 1.2 * s);
    if (i < tl.barQ.length - 1 && bq < pageEnd - EPS) {
      ctx.font = font(11 * s, 600);
      ctx.textAlign = 'right';
      outlinedText(ctx, String(i + 1), x - 12 * s, topY - 11 * s, C.text, 3 * s);
      ctx.textAlign = 'center';
    }
  });

  // 編集選択のハイライト（プレビュー専用）
  const sel = opts.selection;
  if (sel && sel.endQ > pageStart && sel.startQ < pageEnd) {
    const x0 = xOf(Math.max(sel.startQ, pageStart)) - 13 * s;
    const x1 = Math.max(xEnd(Math.min(sel.endQ, pageEnd)) - 4 * s, x0 + 26 * s);
    ctx.fillStyle = C.selection;
    ctx.fillRect(x0, topY - 14 * s, x1 - x0, botY - topY + 28 * s);
    if (sel.string) {
      const y = stringY(sel.string, s);
      ctx.strokeStyle = C.selectionStroke;
      ctx.lineWidth = 2 * s;
      ctx.strokeRect(x0 + 1, y - 10 * s, x1 - x0 - 2, 20 * s);
    }
  }

  // 4. 現在位置の赤線
  ctx.beginPath();
  ctx.moveTo(cursorX, L.pickY * s - 14 * s);
  ctx.lineTo(cursorX, L.beamY * s + 4 * s);
  outlinedStroke(ctx, C.target, 4 * s, 1.2 * s);
  ctx.fillStyle = C.target;
  for (const [y, dir] of [
    [L.pickY * s - 14 * s, 1],
    [L.beamY * s + 4 * s, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cursorX - 8 * s, y - dir * 4 * s);
    ctx.lineTo(cursorX + 8 * s, y - dir * 4 * s);
    ctx.lineTo(cursorX, y + dir * 8 * s);
    ctx.closePath();
    ctx.fill();
  }

  // 現在のコード / 歌詞（赤線を通過済みで最新のもの）
  let currentChordIdx = -1;
  for (let i = 0; i < tl.chords.length; i++) {
    if (tl.chords[i].q <= qNow + EPS) currentChordIdx = i;
    else break;
  }
  let currentLyricQ = -Infinity;
  {
    const idx = lowerBound(tl.notes, qNow + EPS);
    for (let i = idx - 1; i >= 0; i--) {
      if (tl.notes[i].note.lyric) {
        currentLyricQ = tl.notes[i].q;
        break;
      }
    }
  }

  // 5. コード名
  ctx.font = font(26 * s, 800);
  ctx.textAlign = 'left';
  tl.chords.forEach((c, i) => {
    if (!visible(c.q)) return;
    outlinedText(ctx, c.name, xOf(c.q) - 4 * s, L.chordY * s, i === currentChordIdx ? C.highlight : C.text, 6 * s);
  });
  // ページ頭にコード名が無い場合は、前のページから続くコードを括弧付きで表示
  if (!tl.chords.some((c) => Math.abs(c.q - pageStart) < EPS)) {
    let carried = -1;
    for (let i = 0; i < tl.chords.length && tl.chords[i].q < pageStart - EPS; i++) carried = i;
    if (carried >= 0) {
      const color = carried === currentChordIdx ? C.highlight : C.text;
      outlinedText(ctx, `(${tl.chords[carried].name})`, xOf(pageStart) - 4 * s, L.chordY * s, color, 6 * s);
    }
  }
  ctx.textAlign = 'center';

  // 6. 音の長さ（弦上の帯）
  const first = lowerBound(tl.notes, pageStart - EPS);
  const barH = 7 * s;
  for (let i = first; i < tl.notes.length; i++) {
    const tn = tl.notes[i];
    if (!visible(tn.q)) break;
    const n = tn.note;
    if (n.rest || n.nuance === 'mute' || tn.len <= 0) continue;
    const x0 = xOf(tn.q) + 9 * s;
    const x1 = xEnd(tn.q + tn.len) - 5 * s;
    if (x1 <= x0) continue;
    const passed = tn.q + tn.len <= qNow;
    const active = !passed && tn.q <= qNow + EPS;
    ctx.globalAlpha = passed ? 0.45 : 1;
    ctx.fillStyle = active ? C.sustainActive : C.sustain;
    for (const st of ALL_STRINGS) {
      if (typeof n.frets[st] !== 'number') continue;
      roundRect(ctx, x0, stringY(st, s) - barH / 2, x1 - x0, barH, barH / 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  // 7. 音符
  const fretFont = font(15 * s, 800);
  const boxH = 17 * s;
  for (let i = first; i < tl.notes.length; i++) {
    const tn = tl.notes[i];
    if (!visible(tn.q)) break;
    const n = tn.note;
    const x = xOf(tn.q);
    const passed = tn.q + tn.len <= qNow;
    const active = !passed && tn.q <= qNow + EPS;
    ctx.globalAlpha = passed ? 0.55 : 1;

    // ピッキング
    if (n.picking) drawPicking(ctx, n.picking, x, L.pickY * s, s, active ? C.highlight : C.text);

    // 奏法の接続線（前の音符から）とじゃらーんの矢印
    if (n.nuance && n.nuance !== 'mute') drawNuance(ctx, tl, i, xOf, s, pageStart);
    if (n.strum) drawStrum(ctx, n, x, s, active ? C.highlight : C.text);

    // フレット番号
    ctx.font = fretFont;
    const fretted = ALL_STRINGS.filter((st) => n.frets[st] !== null);
    const strings = fretted.length === 0 && n.nuance === 'mute' ? ALL_STRINGS : fretted;
    for (const st of strings) {
      const txt = fretted.length === 0 ? 'x' : fretText(n, n.frets[st]);
      if (txt === null) continue;
      const y = stringY(st, s);
      const bw = Math.max(ctx.measureText(txt).width + 6 * s, 15 * s);
      roundRect(ctx, x - bw / 2, y - boxH / 2, bw, boxH, 4 * s);
      ctx.fillStyle = active ? C.activeBox : C.noteBox;
      ctx.fill();
      ctx.lineWidth = 1.2 * s;
      ctx.strokeStyle = active ? C.activeBox : C.noteBorder;
      ctx.stroke();
      ctx.fillStyle = active ? C.activeText : C.text;
      ctx.fillText(txt, x, y + 1 * s);
    }

    // 歌詞
    if (n.lyric) {
      ctx.font = font(23 * s, 800);
      ctx.globalAlpha = tn.q < currentLyricQ ? 0.55 : 1;
      outlinedText(ctx, n.lyric, x, L.lyricY * s, tn.q === currentLyricQ ? C.highlight : C.text, 6 * s);
    }
    ctx.globalAlpha = 1;
  }

  // 8. リズム表記（符尾・連桁）
  drawRhythm(ctx, collectRhythm(song, tl, first, visible, xOf, qNow), s);

  // 8b. 弦番号ラベル
  ctx.fillStyle = song.backgroundColor;
  ctx.fillRect(0, 0, labelW, H);
  ctx.font = font(12 * s, 800);
  for (const st of ALL_STRINGS) {
    const y = stringY(st, s);
    ctx.beginPath();
    ctx.arc(labelW / 2 + 2 * s, y, 8 * s, 0, Math.PI * 2);
    ctx.fillStyle = C.noteBox;
    ctx.fill();
    ctx.lineWidth = 1.2 * s;
    ctx.strokeStyle = C.noteBorder;
    ctx.stroke();
    ctx.fillStyle = C.text;
    ctx.fillText(st, labelW / 2 + 2 * s, y + 0.5 * s);
  }

  // 9. 拍子記号（各ページの左端）
  {
    const { num, den } = parseTimeSignature(song.timeSignature);
    const mid = (topY + botY) / 2;
    const half = (botY - topY) / 4;
    ctx.font = font(38 * s, 900);
    for (const [txt, y] of [
      [String(num), mid - half],
      [String(den), mid + half],
    ] as const) {
      const w = ctx.measureText(txt).width + 6 * s;
      ctx.fillStyle = song.backgroundColor;
      ctx.fillRect(tsX - w / 2, y - 19 * s, w, 38 * s);
      ctx.fillStyle = C.text;
      ctx.fillText(txt, tsX, y + 2 * s);
    }
  }

  ctx.restore();
}

function drawNuance(
  ctx: CanvasRenderingContext2D,
  tl: Timeline,
  i: number,
  xOf: (q: number) => number,
  s: number,
  minQ: number,
) {
  const tn = tl.notes[i];
  const n = tn.note;
  const label = NUANCE_LABEL[n.nuance!];
  const x = xOf(tn.q);
  const strings = ALL_STRINGS.filter((st) => typeof n.frets[st] === 'number');
  if (strings.length === 0) return;

  // 前の音符（同じページ内・2拍以内）を探す
  let prev: TimelineNote | null = null;
  for (let k = i - 1; k >= 0; k--) {
    const c = tl.notes[k];
    if (tn.q - c.q > 2 || c.q < minQ - 1e-6) break;
    if (ALL_STRINGS.some((st) => typeof c.note.frets[st] === 'number')) {
      prev = c;
      break;
    }
  }
  const common = prev ? strings.filter((st) => typeof prev!.note.frets[st] === 'number') : [];
  const targets = common.length ? common : strings;
  const half = 10 * s;
  ctx.font = `italic ${font(14 * s, 800)}`;

  for (const st of targets) {
    const y = stringY(st, s);
    if (n.nuance === 'choke' || n.nuance === 'hc') {
      // チョーキング: 右上への矢印
      const ax = x + half + 2 * s;
      ctx.beginPath();
      ctx.moveTo(ax, y);
      ctx.quadraticCurveTo(ax + 9 * s, y, ax + 9 * s, y - 13 * s);
      outlinedStroke(ctx, C.text, 1.8 * s, 1.2 * s);
      ctx.beginPath();
      ctx.moveTo(ax + 5 * s, y - 9 * s);
      ctx.lineTo(ax + 9 * s, y - 15 * s);
      ctx.lineTo(ax + 13 * s, y - 9 * s);
      ctx.closePath();
      ctx.fillStyle = C.text;
      ctx.fill();
      ctx.textAlign = 'left';
      outlinedText(ctx, label, ax + 13 * s, y - 14 * s, C.text, 4 * s);
      ctx.textAlign = 'center';
      if (n.nuance === 'choke' || !prev) continue;
    }
    const arcOnly = n.nuance === 'tie' || n.nuance === 'slur';
    if (!prev || !common.includes(st)) {
      if (arcOnly) {
        ctx.beginPath();
        ctx.moveTo(x - 34 * s, y - 10 * s);
        ctx.quadraticCurveTo(x - 18 * s, y - 20 * s, x - 3 * s, y - 10 * s);
        outlinedStroke(ctx, C.text, 1.8 * s, 1.2 * s);
      } else outlinedText(ctx, label, x - half - 6 * s, y - 12 * s, C.text, 4 * s);
      continue;
    }
    const px = xOf(prev.q);
    if (n.nuance === 'slide') {
      const a = prev.note.frets[st] as number;
      const b = n.frets[st] as number;
      const dy = b >= a ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(px + half + 2 * s, y + dy * -5 * s);
      ctx.lineTo(x - half - 2 * s, y + dy * 5 * s);
      outlinedStroke(ctx, C.text, 2 * s, 1.2 * s);
      outlinedText(ctx, label, (px + x) / 2, y - 12 * s, C.text, 4 * s);
    } else {
      // ハンマリング / プリング: スラー
      const mid = (px + x) / 2;
      ctx.beginPath();
      ctx.moveTo(px + 3 * s, y - 10 * s);
      ctx.quadraticCurveTo(mid, y - 22 * s, x - 3 * s, y - 10 * s);
      outlinedStroke(ctx, C.text, 1.8 * s, 1.2 * s);
      if (n.nuance !== 'hc' && !arcOnly) outlinedText(ctx, label, mid, y - 22 * s, C.text, 4 * s);
    }
  }
}

// ---------------------------------------------------------------------------
// リズム表記（TAB譜の下の符尾・連桁）
// ---------------------------------------------------------------------------

interface RhythmNote {
  x: number;
  /** 基本の音価（4分音符=1）。連符は見かけの音価 */
  base: number;
  dots: number;
  /** 連桁の本数（8分=1, 16分=2, 32分=3） */
  beams: number;
  /** 連符の数（3連なら3、通常は0） */
  tuplet: number;
  /** 連桁でつなぐまとまり（拍ごと） */
  group: string;
  /** 連符の数字を付けるまとまり（区間ごと） */
  tupletGroup: string;
  rest: boolean;
  passed: boolean;
  active: boolean;
}

const BASES = [4, 2, 1, 0.5, 0.25, 0.125, 0.0625];

/** 長さ（4分音符単位）を 音価＋付点 に分解する */
function classify(len: number): { base: number; dots: number } {
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  for (const b of BASES) {
    if (eq(len, b)) return { base: b, dots: 0 };
    if (eq(len, b * 1.5)) return { base: b, dots: 1 };
    if (eq(len, b * 1.75)) return { base: b, dots: 2 };
  }
  // 端数（タイが必要な長さ）は収まる一番長い音価で近似
  return { base: BASES.find((b) => b <= len + 1e-3) ?? 0.0625, dots: 0 };
}

function collectRhythm(
  song: Song,
  tl: Timeline,
  first: number,
  visible: (q: number) => boolean,
  xOf: (q: number) => number,
  qNow: number,
): RhythmNote[] {
  const ts = song.timeSignature;
  const bt = beatTicks(ts);
  const { den } = parseTimeSignature(ts);
  const out: RhythmNote[] = [];
  for (let i = first; i < tl.notes.length; i++) {
    const tn = tl.notes[i];
    if (!visible(tn.q)) break;
    if (!isEvent(tn.note) || tn.len <= 0) continue;
    const m = song.measures[tn.measure];
    // 音符が属する区間（拍）
    let beat = 0;
    let segIndex = 0;
    let seg = m.segments[0];
    for (let k = 0; k < m.segments.length; k++) {
      if (tn.note.tick >= beat * bt && tn.note.tick < (beat + m.segments[k].beats) * bt) {
        segIndex = k;
        seg = m.segments[k];
        break;
      }
      beat += m.segments[k].beats;
    }
    const pow2 = 2 ** Math.floor(Math.log2(seg.div));
    const tuplet = seg.div === pow2 ? 0 : seg.div;
    // 連符は見かけの音価に直す（例: 8分3連 = 1/3拍 × 3/2 = 8分）
    const { base, dots } = classify(tuplet ? (tn.len * seg.div) / pow2 : tn.len);
    const beams = base >= 1 ? 0 : Math.round(Math.log2(1 / base));
    // 8分の拍子（6/8など）は付点4分（3拍）ごとにまとめる
    const groupBeat = den === 8 ? Math.floor(beat / 3) : segIndex;
    const passed = tn.q + tn.len <= qNow;
    out.push({
      x: xOf(tn.q),
      base,
      dots,
      beams,
      tuplet,
      group: `${tn.measure}:${groupBeat}`,
      tupletGroup: `${tn.measure}:${segIndex}`,
      rest: !!tn.note.rest,
      passed,
      active: !passed && tn.q <= qNow + 1e-6,
    });
  }
  return out;
}

function drawRhythm(ctx: CanvasRenderingContext2D, notes: RhythmNote[], s: number) {
  const y0 = L.stemTop * s;
  const y1 = L.beamY * s;
  const beamH = 3.6 * s;
  const beamGap = 5.5 * s;
  const color = (n: RhythmNote) => (n.active ? C.highlight : C.text);
  ctx.save();
  ctx.lineCap = 'butt';

  // 符尾・付点・休符
  for (const n of notes) {
    ctx.globalAlpha = n.passed ? 0.55 : 1;
    ctx.strokeStyle = color(n);
    ctx.fillStyle = color(n);
    if (n.rest) {
      drawRest(ctx, n, y0, y1, s);
      continue;
    }
    const mid = (y0 + y1) / 2;
    if (n.base >= 4) {
      // 全音符: 符尾なしの白丸
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.ellipse(n.x, mid, 4.5 * s, 3.2 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.lineWidth = 1.7 * s;
      ctx.beginPath();
      ctx.moveTo(n.x, y0);
      ctx.lineTo(n.x, n.base === 2 ? mid : y1);
      ctx.stroke();
      if (n.base === 2) {
        // 2分音符: 短い符尾＋白丸
        ctx.beginPath();
        ctx.ellipse(n.x, mid + 3.5 * s, 3.5 * s, 2.6 * s, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (let d = 0; d < n.dots; d++) {
      ctx.beginPath();
      ctx.arc(n.x + (5 + d * 4.5) * s, y1 - 2 * s, 1.7 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 連桁（拍ごとにまとめる）と旗
  let i = 0;
  while (i < notes.length) {
    const g = notes[i];
    if (g.rest || g.beams === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < notes.length && !notes[j + 1].rest && notes[j + 1].beams > 0 && notes[j + 1].group === g.group) j++;
    const grp = notes.slice(i, j + 1);
    ctx.globalAlpha = grp.every((n) => n.passed) ? 0.55 : 1;
    ctx.fillStyle = C.text;
    if (grp.length === 1) {
      // 単独の8分以下: 旗
      ctx.strokeStyle = C.text;
      ctx.lineWidth = 2.2 * s;
      for (let k = 0; k < g.beams; k++) {
        const y = y1 - k * beamGap;
        ctx.beginPath();
        ctx.moveTo(g.x, y);
        ctx.quadraticCurveTo(g.x + 8 * s, y - 3 * s, g.x + 7 * s, y - 9 * s);
        ctx.stroke();
      }
    } else {
      const maxBeams = Math.max(...grp.map((n) => n.beams));
      for (let level = 1; level <= maxBeams; level++) {
        const y = y1 - (level - 1) * beamGap - beamH;
        let k = 0;
        while (k < grp.length) {
          if (grp[k].beams < level) {
            k++;
            continue;
          }
          let e = k;
          while (e + 1 < grp.length && grp[e + 1].beams >= level) e++;
          if (e > k) ctx.fillRect(grp[k].x, y, grp[e].x - grp[k].x + 1.7 * s, beamH);
          else {
            // 1つだけ細かい音符: 隣の音符側へ短い連桁
            const stub = 7 * s;
            const toLeft = k === grp.length - 1;
            ctx.fillRect(toLeft ? grp[k].x - stub : grp[k].x, y, stub + 1.7 * s, beamH);
          }
          k = e + 1;
        }
      }
    }
    i = j + 1;
  }

  // 連符の数字（区間ごとに連桁の下）
  ctx.font = font(11 * s, 800);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let t = 0;
  while (t < notes.length) {
    const n = notes[t];
    if (!n.tuplet) {
      t++;
      continue;
    }
    let e = t;
    while (e + 1 < notes.length && notes[e + 1].tupletGroup === n.tupletGroup) e++;
    const grp = notes.slice(t, e + 1);
    ctx.globalAlpha = grp.every((x) => x.passed) ? 0.55 : 1;
    ctx.fillStyle = C.text;
    const cx = (notes[t].x + notes[e].x) / 2;
    const ty = y1 + 7 * s;
    // 連桁でつながらない連符（2拍3連など）はかぎ括弧で範囲を示す
    if (grp.length > 1 && grp.some((x) => x.beams === 0 || x.rest)) {
      const xa = notes[t].x - 3 * s;
      const xb = notes[e].x + 3 * s;
      const gap = 7 * s;
      ctx.strokeStyle = C.text;
      ctx.lineWidth = 1.3 * s;
      ctx.beginPath();
      ctx.moveTo(xa, ty - 4 * s);
      ctx.lineTo(xa, ty);
      ctx.lineTo(cx - gap, ty);
      ctx.moveTo(cx + gap, ty);
      ctx.lineTo(xb, ty);
      ctx.lineTo(xb, ty - 4 * s);
      ctx.stroke();
    }
    ctx.fillText(String(n.tuplet), cx, ty);
    t = e + 1;
  }
  ctx.restore();
}

/** 簡易の休符記号 */
function drawRest(ctx: CanvasRenderingContext2D, n: RhythmNote, y0: number, y1: number, s: number) {
  const mid = (y0 + y1) / 2;
  if (n.base >= 2) {
    // 全休符・2分休符: 横長の四角
    ctx.fillRect(n.x - 5 * s, n.base >= 4 ? mid - 4 * s : mid, 10 * s, 4 * s);
    return;
  }
  ctx.lineWidth = 1.8 * s;
  if (n.base === 1) {
    // 4分休符: ジグザグ
    ctx.beginPath();
    ctx.moveTo(n.x - 2 * s, y0 + 2 * s);
    ctx.lineTo(n.x + 3 * s, mid - 4 * s);
    ctx.lineTo(n.x - 3 * s, mid + 2 * s);
    ctx.lineTo(n.x + 3 * s, y1 - 4 * s);
    ctx.quadraticCurveTo(n.x - 5 * s, y1 - 6 * s, n.x - 1 * s, y1);
    ctx.stroke();
    return;
  }
  // 8分以下の休符: 斜線＋旗の数だけ点
  const top = mid - 6 * s;
  ctx.beginPath();
  ctx.moveTo(n.x + 4 * s, top);
  ctx.lineTo(n.x - 1 * s, top + 8 * s + n.beams * 5 * s);
  ctx.stroke();
  for (let k = 0; k < n.beams; k++) {
    ctx.beginPath();
    ctx.arc(n.x - 2 * s, top + 1.5 * s + k * 5 * s, 2 * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

import { produce } from 'immer';
import type { FretValue, Frets, Measure, Note, Nuance, Picking, Segment, Song } from '../types';
import { STRING_NOS, TPQ, VIDEO_HEIGHTS, type VideoHeight } from '../types';
import { emptyFrets } from './chords';
import { conformMeasure, createEmptySong } from './songOps';
import { defaultSegments, parseTimeSignature } from './timing';

const STORAGE_KEY = 'tab-video-maker:song';

const NUANCES: Nuance[] = ['hammer', 'pull', 'choke', 'hc', 'slide', 'mute', 'tie', 'slur'];
const NUANCE_ALIASES: Record<string, Nuance> = {
  h: 'hammer',
  p: 'pull',
  c: 'choke',
  s: 'slide',
  x: 'mute',
  hammering: 'hammer',
  pulling: 'pull',
  pulloff: 'pull',
  bend: 'choke',
  choking: 'choke',
  brushing: 'mute',
};

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function fretValue(v: unknown): FretValue {
  if (v === 'x' || v === 'X') return 'x';
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(24, Math.round(v)));
  if (typeof v === 'string' && /^\d+$/.test(v)) return Math.min(24, parseInt(v, 10));
  return null;
}

function normalizeFrets(v: unknown): Frets {
  const f = emptyFrets();
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const s of STRING_NOS) f[s] = fretValue(o[s]);
  }
  return f;
}

function normalizeNuance(v: unknown): Nuance {
  if (typeof v !== 'string') return null;
  if ((NUANCES as string[]).includes(v)) return v as Nuance;
  return NUANCE_ALIASES[v.toLowerCase()] ?? null;
}

function normalizePicking(v: unknown): Picking {
  return v === 'down' || v === 'up' ? v : null;
}

function normalizeNote(v: unknown, legacyTicksPerSlot: number): Note | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  // 新形式は tick、旧形式（設計書初版）は position × マスの長さ
  let tick: number;
  if (typeof o.tick === 'number') tick = Math.round(num(o.tick, -1, -1, 1e6));
  else {
    const position = num(o.position, -1, -1, 999);
    if (position < 0) return null;
    tick = Math.round(position * legacyTicksPerSlot);
  }
  if (tick < 0) return null;
  return {
    tick,
    picking: normalizePicking(o.picking),
    frets: normalizeFrets(o.frets),
    nuance: normalizeNuance(o.nuance),
    lyric: str(o.lyric),
    chord: str(o.chord),
    rest: o.rest === true,
    strum: o.strum === 'up' || o.strum === 'down' ? o.strum : null,
  };
}

function normalizeMeasure(v: unknown, i: number, ts: string): Measure {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const { den } = parseTimeSignature(ts);
  let segments: Segment[];
  // 旧形式: gridSplit = 4/8/16/12(3連)
  const split = [4, 8, 12, 16].includes(o.gridSplit as number) ? (o.gridSplit as number) : 8;
  const legacyTicksPerSlot = (TPQ * 4) / split;
  if (Array.isArray(o.segments) && o.segments.length) {
    segments = (o.segments as Record<string, unknown>[]).map((s) => ({
      beats: Math.round(num(s?.beats, 1, 1, 16)),
      div: Math.round(num(s?.div, 2, 1, 16)),
    }));
  } else {
    segments = defaultSegments(ts, Math.max(1, Math.round((split * 4) / den / 4)));
  }
  const notes = Array.isArray(o.notes)
    ? o.notes.map((n) => normalizeNote(n, legacyTicksPerSlot)).filter((n): n is Note => n !== null)
    : [];
  const m: Measure = {
    measureIndex: i + 1,
    segments,
    chordName: str(o.chordName),
    notes,
    chordShape: o.chordShape ? normalizeFrets(o.chordShape) : null,
  };
  // 区間を拍子に合わせ、音符をマスに揃える
  return produce(m, (d) => conformMeasure(d, ts));
}

export function normalizeSong(v: unknown): Song {
  const base = createEmptySong();
  if (!v || typeof v !== 'object') return base;
  const o = v as Record<string, unknown>;
  const res = (o.resolution ?? {}) as Record<string, unknown>;
  // 旧形式は resolution: {width, height}
  const height = typeof o.height === 'number' ? o.height : num(res.height, 250, 0, 9999);
  const ts = typeof o.timeSignature === 'string' && /^\d+\/\d+$/.test(o.timeSignature) ? o.timeSignature : '4/4';
  const measures = Array.isArray(o.measures) ? o.measures.map((m, i) => normalizeMeasure(m, i, ts)) : base.measures;
  return {
    title: str(o.title) ?? base.title,
    bpm: Math.round(num(o.bpm, base.bpm, 30, 300)),
    timeSignature: ts,
    height: VIDEO_HEIGHTS.includes(height as VideoHeight) ? (height as VideoHeight) : 250,
    backgroundColor: o.backgroundColor === '#FFFFFF' || o.backgroundColor === '#ffffff' ? '#FFFFFF' : '#000000',
    measuresPerPage: Math.round(num(o.measuresPerPage, base.measuresPerPage, 1, 8)),
    measures: measures.length ? measures : base.measures,
  };
}

export function loadFromStorage(): Song | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeSong(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveToStorage(song: Song) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(song));
  } catch {
    // 容量超過などは無視（JSON書き出しで退避可能）
  }
}

export function safeFileName(title: string): string {
  return (title || 'song').replace(/[\\/:*?"<>|]/g, '_').trim() || 'song';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportSongJson(song: Song) {
  const blob = new Blob([JSON.stringify(song, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${safeFileName(song.title)}.json`);
}

export async function importSongJson(file: File): Promise<Song> {
  const text = await file.text();
  return normalizeSong(JSON.parse(text));
}

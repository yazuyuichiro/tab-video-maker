import { GUITAR_PRESET, type TranscribePreset } from './preset';
import type { RawNote } from './protocol';

/** 感度（1〜10）→ 音の強さのしきい値。感度が高いほど小さい音まで拾う */
export const SENSITIVITY_MIN = 1;
export const SENSITIVITY_MAX = 10;
export function ampThreshold(sensitivity: number): number {
  return Math.round((0.75 - 0.05 * sensitivity) * 100) / 100;
}

/** 倍音の幻音とみなして除いた音 */
export interface HarmonicDrop {
  note: RawNote;
  /** 倍音の元とみなした低い音 */
  base: RawNote;
}

export interface CleanResult {
  notes: RawNote[];
  /** 倍音の幻音とみなして除いた音（要確認一覧に出す） */
  harmonics: HarmonicDrop[];
  /** 同じ音高の再検出として前のノートに統合した数（残ったノートに統合されたものだけ数える） */
  merged: number;
}

/**
 * 検出ノートの後処理（値は preset.ts）。
 * 1. 同じ音高で続けて検出されたノートを統合（間が mergeGapSec 以内で、後のノートの発音らしさが reattackOnset 未満のもの。
 *    発音らしさが高いものは弾き直しとして別の音のまま残す）
 * 2. 感度（音の強さのしきい値）未満を除く
 * 3. 短いノートを除く
 * 4. 倍音の幻音を除く（findHarmonics。preset.harmonicFilter が true の時だけ）
 */
export function cleanNotes(raw: RawNote[], sensitivity: number, preset: TranscribePreset = GUITAR_PRESET): CleanResult {
  const minAmp = ampThreshold(sensitivity);
  const byPitch = new Map<number, RawNote[]>();
  for (const n of raw) {
    const list = byPitch.get(n.pitch) ?? [];
    list.push(n);
    byPitch.set(n.pitch, list);
  }
  const merged: RawNote[] = [];
  /** 統合先のノート → 統合したノートの数 */
  const absorbed = new Map<RawNote, number>();
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start);
    const out: RawNote[] = [];
    for (const n of list) {
      const prev = out[out.length - 1];
      if (prev && n.start - (prev.start + prev.dur) <= preset.mergeGapSec && n.onset < preset.reattackOnset) {
        prev.dur = Math.max(prev.start + prev.dur, n.start + n.dur) - prev.start;
        prev.amp = Math.max(prev.amp, n.amp);
        absorbed.set(prev, (absorbed.get(prev) ?? 0) + 1);
        continue;
      }
      out.push({ ...n });
    }
    merged.push(...out);
  }
  const kept = merged
    .filter((n) => n.amp >= minAmp && n.dur >= preset.minNoteSec)
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const harmonics = preset.harmonicFilter ? findHarmonics(kept, preset) : [];
  const dropped = new Set(harmonics.map((h) => h.note));
  const notes = kept.filter((n) => !dropped.has(n));
  return { notes, harmonics, merged: notes.reduce((sum, n) => sum + (absorbed.get(n) ?? 0), 0) };
}

/**
 * 倍音の幻音を探す。低い音とほぼ同時（preset.harmonicOnsetSec 以内）に鳴り始めた音のうち、
 * 低い音からの音程が preset.harmonicIntervals（オクターブ上・オクターブと5度上）で、
 * 強さが低い音以下（preset.harmonicAmpRatio 倍まで）のもの。
 * 低い音は、除く前のすべての音から探す（倍音の倍音も除かれる）。元の音が複数ある時はいちばん強い音にする。
 * notes は鳴り始めの順に並んでいること。
 */
function findHarmonics(notes: RawNote[], preset: TranscribePreset): HarmonicDrop[] {
  const { harmonicOnsetSec: win, harmonicIntervals: intervals, harmonicAmpRatio: ratio } = preset;
  const out: HarmonicDrop[] = [];
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    let base: RawNote | null = null;
    for (let j = i - 1; j >= 0 && note.start - notes[j].start <= win; j--) {
      const low = notes[j];
      if (intervals.includes(note.pitch - low.pitch) && note.amp <= low.amp * ratio && (!base || low.amp > base.amp)) base = low;
    }
    for (let j = i + 1; j < notes.length && notes[j].start - note.start <= win; j++) {
      const low = notes[j];
      if (intervals.includes(note.pitch - low.pitch) && note.amp <= low.amp * ratio && (!base || low.amp > base.amp)) base = low;
    }
    if (base) out.push({ note, base });
  }
  return out;
}

import type { RawNote } from './protocol';

/** これより短いノートは除く（秒） */
export const MIN_NOTE_SEC = 0.08;
/** 同じ音高のノートの間がこれ以内なら、分断されたノートの候補（秒） */
const MERGE_GAP_SEC = 0.06;
/** 鳴り始めの発音らしさがこれ未満なら、弾き直しではなく直前の音の続きとみなす */
const REATTACK_ONSET = 0.5;

/** 感度（1〜10）→ 音の強さのしきい値。感度が高いほど小さい音まで拾う */
export const SENSITIVITY_MIN = 1;
export const SENSITIVITY_MAX = 10;
export function ampThreshold(sensitivity: number): number {
  return Math.round((0.75 - 0.05 * sensitivity) * 100) / 100;
}

/**
 * 検出ノートの後処理。
 * 1. 同じ音高の分断ノートを結合（弾き直し＝発音らしさが高いものは別の音のまま残す）
 * 2. 感度（音の強さのしきい値）未満を除く
 * 3. 80ms 未満を除く
 */
export function cleanNotes(raw: RawNote[], sensitivity: number): RawNote[] {
  const minAmp = ampThreshold(sensitivity);
  const byPitch = new Map<number, RawNote[]>();
  for (const n of raw) {
    const list = byPitch.get(n.pitch) ?? [];
    list.push(n);
    byPitch.set(n.pitch, list);
  }
  const merged: RawNote[] = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.start - b.start);
    const out: RawNote[] = [];
    for (const n of list) {
      const prev = out[out.length - 1];
      if (prev && n.start - (prev.start + prev.dur) <= MERGE_GAP_SEC && n.onset < REATTACK_ONSET) {
        prev.dur = Math.max(prev.start + prev.dur, n.start + n.dur) - prev.start;
        prev.amp = Math.max(prev.amp, n.amp);
        continue;
      }
      out.push({ ...n });
    }
    merged.push(...out);
  }
  return merged
    .filter((n) => n.amp >= minAmp && n.dur >= MIN_NOTE_SEC)
    .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/**
 * Basic Pitch の出力（フレームごとの「鳴っている」「鳴り始め」の確からしさ）からノートを取り出す（Worker で使う）。
 * tfjs の計算は使わないので、推論の結果を残しておけば、値だけを変えて取り出し直せる
 */
import { noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import type { TranscribePreset } from './preset';
import type { RawNote } from './protocol';

/** Basic Pitch の出力の最低音（ピアノの最低音 A0 = MIDI 21）と、音の数（88鍵） */
const MIDI_OFFSET = 21;
const N_PITCHES = 88;
/** Basic Pitch の出力は 1 秒あたり約 86 フレーム */
const FPS = Math.floor(22050 / 256);
/** ノートの抽出を区切る長さと、前後に付ける余白（フレーム） */
const CHUNK_FRAMES = 10 * FPS;
const PAD_FRAMES = 2 * FPS;

const hzToMidi = (hz: number) => 12 * Math.log2(hz / 440) + 69;

/** 設定の音域（Hz）→ 残す音の範囲（MIDI。両端を含む） */
export function pitchRange(p: TranscribePreset): { lo: number; hi: number } {
  return {
    lo: p.minFreqHz ? Math.round(hzToMidi(p.minFreqHz)) : MIDI_OFFSET,
    hi: p.maxFreqHz ? Math.round(hzToMidi(p.maxFreqHz)) : MIDI_OFFSET + N_PITCHES - 1,
  };
}

/**
 * 音域の外を 0 にした写しを作る。
 * outputToNotesPoly の音域指定（maxFreq / minFreq）は使わない。渡した配列をその場で書き換えるうえ、
 * Hz → 音の番号の端数を切り捨てるため、82Hz・1319Hz では範囲が E2〜E6 から半音ずつ下にずれる（D#2〜D#6）
 */
function limitRange(rows: number[][], lo: number, hi: number): number[][] {
  const from = lo - MIDI_OFFSET;
  const to = hi - MIDI_OFFSET + 1;
  if (from <= 0 && to >= N_PITCHES) return rows;
  return rows.map((r) => r.map((v, i) => (i >= from && i < to ? v : 0)));
}

/**
 * ノートを取り出す。outputToNotesPoly は音源の長さの2乗で遅くなる（melodia trick が毎回全体から最大値を探す）ため、
 * 前後に余白を付けた区間ごとに処理し、鳴り始めが区間の中にあるノートだけを採用する。
 */
export function extractNotes(
  frames: number[][],
  onsets: number[][],
  preset: TranscribePreset,
  onProgress: (ratio: number) => void = () => {},
): RawNote[] {
  const { lo, hi } = pitchRange(preset);
  const f = limitRange(frames, lo, hi);
  const o = limitRange(onsets, lo, hi);
  const n = f.length;
  const events: ReturnType<typeof outputToNotesPoly> = [];
  for (let start = 0; start < n; start += CHUNK_FRAMES) {
    const end = Math.min(n, start + CHUNK_FRAMES);
    const from = Math.max(0, start - PAD_FRAMES);
    const to = Math.min(n, end + PAD_FRAMES);
    const part = outputToNotesPoly(
      f.slice(from, to),
      o.slice(from, to),
      preset.onsetThresh,
      preset.frameThresh,
      preset.minNoteFrames,
      preset.inferOnsets,
      null,
      null,
      preset.melodiaTrick,
    );
    for (const e of part) {
      const s = e.startFrame + from;
      if (s >= start && s < end) events.push({ ...e, startFrame: s });
    }
    onProgress(end / n);
  }
  const timed = noteFramesToTime(events);
  const notes: RawNote[] = events.map((e, i) => {
    // 鳴り始めのフレーム（前後1フレーム）での発音らしさ。分断ノートの結合の判定に使う
    const bin = e.pitchMidi - MIDI_OFFSET;
    let onset = 0;
    for (let k = Math.max(0, e.startFrame - 1); k <= Math.min(onsets.length - 1, e.startFrame + 1); k++) {
      onset = Math.max(onset, onsets[k]?.[bin] ?? 0);
    }
    return {
      start: timed[i].startTimeSeconds,
      dur: timed[i].durationSeconds,
      pitch: e.pitchMidi,
      amp: e.amplitude,
      onset,
    };
  });
  return notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
}

/// <reference lib="webworker" />
/**
 * Basic Pitch（Spotify, Apache License 2.0）で音の高さと長さを推定する Worker。
 * - tfjs は basic-pitch が使うもの（node_modules の 1 系統）をそのまま使う
 * - モデルは自ドメイン（public/models/basic-pitch/）から読み込む
 * - キャンセルは本体側で Worker を終了する（evaluateModel には途中で止める仕組みが無いため）
 */
import * as tf from '@tensorflow/tfjs';
import { BasicPitch, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch';
import type { RawNote, WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const SAMPLE_RATE = 22050;
/** Basic Pitch の出力の最低音（ピアノの最低音 A0 = MIDI 21） */
const MIDI_OFFSET = 21;
/** 後処理で分断ノートを結合してから短いノートを除くため、ここでは短めに残す（約35ms） */
const MIN_NOTE_FRAMES = 3;
/** Basic Pitch の出力は 1 秒あたり約 86 フレーム */
const FPS = Math.floor(SAMPLE_RATE / 256);
/** ノートの抽出を区切る長さと、前後に付ける余白（フレーム） */
const CHUNK_FRAMES = 10 * FPS;
const PAD_FRAMES = 2 * FPS;
/** 進捗のうち推論に割り当てる割合（残りはノートの抽出） */
const INFER_SHARE = 0.9;

// tfjs 3.x の不具合への対処: setTimeoutCustom が `!window` を参照するため、window の無い Worker では
// ReferenceError になり、WebGL の読み出しが終わらなくなる（4.x で修正済み）。普通の setTimeout に置き換える
const platform = tf.env().platform as unknown as { setTimeoutCustom?: (fn: () => void, delay: number) => void } | undefined;
if (platform) platform.setTimeoutCustom = (fn, delay) => void setTimeout(fn, delay);

let basicPitch: BasicPitch | null = null;

const post = (msg: WorkerResponse) => self.postMessage(msg);

// 非同期の処理の中で起きた例外も本体に伝える（伝わらないと本体が待ち続けてしまう）
self.addEventListener('error', (e) => post({ type: 'error', message: e.message || '音の解析中にエラーが起きました' }));
self.addEventListener('unhandledrejection', (e) =>
  post({ type: 'error', message: (e.reason as Error)?.message || String(e.reason) || '音の解析中にエラーが起きました' }),
);

async function load(modelUrl: string) {
  const t0 = performance.now();
  // WebGL（Worker では OffscreenCanvas）が使えなければ tfjs が CPU に切り替える
  await tf.ready();
  const t1 = performance.now();
  basicPitch = new BasicPitch(modelUrl);
  await basicPitch.model;
  const t2 = performance.now();
  // シェーダーのコンパイルを先に済ませる（無音 2 秒を 1 回通す）
  await infer(new Float32Array(SAMPLE_RATE * 2), () => {});
  const t3 = performance.now();
  post({
    type: 'loaded',
    backend: tf.getBackend(),
    ms: t3 - t0,
    detail: `ready ${Math.round(t1 - t0)}ms / model ${Math.round(t2 - t1)}ms / warmup ${Math.round(t3 - t2)}ms`,
  });
}

async function infer(samples: Float32Array, onProgress: (ratio: number) => void) {
  const frames: number[][] = [];
  const onsets: number[][] = [];
  // evaluateModel は途中のテンソルを解放しないので、まとめて解放する
  tf.engine().startScope();
  try {
    await basicPitch!.evaluateModel(
      samples,
      (f, o) => {
        frames.push(...f);
        onsets.push(...o);
      },
      onProgress,
    );
  } finally {
    tf.engine().endScope();
  }
  return { frames, onsets };
}

/**
 * ノートを抽出する。outputToNotesPoly は音源の長さの2乗で遅くなる（melodia trick が毎回全体から最大値を探す）ため、
 * 前後に余白を付けた区間ごとに処理し、鳴り始めが区間の中にあるノートだけを採用する。
 */
function extractNotes(frames: number[][], onsets: number[][], onProgress: (ratio: number) => void) {
  const n = frames.length;
  const events: ReturnType<typeof outputToNotesPoly> = [];
  for (let start = 0; start < n; start += CHUNK_FRAMES) {
    const end = Math.min(n, start + CHUNK_FRAMES);
    const from = Math.max(0, start - PAD_FRAMES);
    const to = Math.min(n, end + PAD_FRAMES);
    const part = outputToNotesPoly(frames.slice(from, to), onsets.slice(from, to), 0.5, 0.3, MIN_NOTE_FRAMES);
    for (const e of part) {
      const s = e.startFrame + from;
      if (s >= start && s < end) events.push({ ...e, startFrame: s });
    }
    onProgress(end / n);
  }
  return events;
}

async function run(samples: Float32Array) {
  const t0 = performance.now();
  const { frames, onsets } = await infer(samples, (ratio) => post({ type: 'progress', ratio: ratio * INFER_SHARE }));
  const tInfer = performance.now();
  const events = extractNotes(frames, onsets, (r) => post({ type: 'progress', ratio: INFER_SHARE + (1 - INFER_SHARE) * r }));
  const tNotes = performance.now();
  const timed = noteFramesToTime(events);
  const notes: RawNote[] = events.map((e, i) => {
    // 鳴り始めのフレーム（前後1フレーム）での発音らしさ。分断ノートの結合の判定に使う
    const bin = e.pitchMidi - MIDI_OFFSET;
    let onset = 0;
    for (let f = Math.max(0, e.startFrame - 1); f <= Math.min(onsets.length - 1, e.startFrame + 1); f++) {
      onset = Math.max(onset, onsets[f]?.[bin] ?? 0);
    }
    return {
      start: timed[i].startTimeSeconds,
      dur: timed[i].durationSeconds,
      pitch: e.pitchMidi,
      amp: e.amplitude,
      onset,
    };
  });
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const detail = `infer ${Math.round(tInfer - t0)}ms / notes ${Math.round(tNotes - tInfer)}ms / tensors ${tf.memory().numTensors}`;
  post({ type: 'done', notes, ms: performance.now() - t0, detail });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    if (e.data.type === 'load') await load(e.data.modelUrl);
    else if (e.data.type === 'run') await run(e.data.samples);
  } catch (err) {
    post({ type: 'error', message: (err as Error)?.message || String(err) });
  }
};

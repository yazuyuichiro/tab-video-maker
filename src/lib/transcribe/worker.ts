/// <reference lib="webworker" />
/**
 * Basic Pitch（Spotify, Apache License 2.0）で音の高さと長さを推定する Worker。
 * - tfjs は basic-pitch が使うもの（node_modules の 1 系統）をそのまま使う
 * - モデルは自ドメイン（public/models/basic-pitch/）から読み込む
 * - キャンセルは本体側で Worker を終了する（evaluateModel には途中で止める仕組みが無いため）
 */
import * as tf from '@tensorflow/tfjs';
import { BasicPitch } from '@spotify/basic-pitch';
import { extractNotes, pitchRange } from './extract';
import { GUITAR_PRESET } from './preset';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const SAMPLE_RATE = 22050;
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

/**
 * 計算方式を試す順番。WebGL（GPU。Worker では OffscreenCanvas）→ WebAssembly（CPU）→ JavaScript（CPU）。
 * 方式の切り替えに成功しても、モデルの読み込みや試運転で失敗したら次の方式を試す
 */
const BACKENDS = ['webgl', 'wasm', 'cpu'] as const;

async function switchBackend(name: (typeof BACKENDS)[number]) {
  try {
    if (name === 'wasm') await import('./wasmBackend');
    return await tf.setBackend(name);
  } catch {
    return false;
  }
}

async function load(modelUrl: string) {
  const t0 = performance.now();
  const skipped: string[] = [];
  let lastError: unknown = null;
  for (const name of BACKENDS) {
    if (!(await switchBackend(name))) {
      skipped.push(name);
      continue;
    }
    const t1 = performance.now();
    const bp = new BasicPitch(modelUrl);
    try {
      await bp.model;
      const t2 = performance.now();
      basicPitch = bp;
      // シェーダーのコンパイルなどを先に済ませる（無音 2 秒を 1 回通す）
      await infer(new Float32Array(SAMPLE_RATE * 2), () => {});
      const t3 = performance.now();
      post({
        type: 'loaded',
        backend: name,
        ms: t3 - t0,
        detail:
          (skipped.length ? `skipped ${skipped.join(',')} / ` : '') +
          `backend ${Math.round(t1 - t0)}ms / model ${Math.round(t2 - t1)}ms / warmup ${Math.round(t3 - t2)}ms`,
      });
      return;
    } catch (err) {
      lastError = err;
      basicPitch = null;
      skipped.push(`${name}(${(err as Error)?.message ?? err})`);
      await bp.model.then((m) => m.dispose()).catch(() => {});
    }
  }
  throw lastError ?? new Error('この環境では音の解析ができません');
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

async function run(samples: Float32Array) {
  const t0 = performance.now();
  const { frames, onsets } = await infer(samples, (ratio) => post({ type: 'progress', ratio: ratio * INFER_SHARE }));
  const tInfer = performance.now();
  const p = GUITAR_PRESET;
  const notes = extractNotes(frames, onsets, p, (r) => post({ type: 'progress', ratio: INFER_SHARE + (1 - INFER_SHARE) * r }));
  const tNotes = performance.now();
  const { lo, hi } = pitchRange(p);
  const detail =
    `infer ${Math.round(tInfer - t0)}ms / notes ${Math.round(tNotes - tInfer)}ms / tensors ${tf.memory().numTensors}` +
    ` / onset ${p.onsetThresh} frame ${p.frameThresh} min ${p.minNoteFrames}f midi ${lo}-${hi}`;
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

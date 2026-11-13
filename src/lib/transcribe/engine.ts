import type { RawNote, WorkerRequest, WorkerResponse } from './protocol';

/** Basic Pitch の入力（モノラル 22,050Hz） */
export const SAMPLE_RATE = 22050;

const MODEL_URL = `${import.meta.env.BASE_URL}models/basic-pitch/model.json`;

export class TranscribeCancelled extends Error {
  constructor() {
    super('キャンセルしました');
  }
}

export interface LoadInfo {
  /** tfjs の計算方式（webgl / wasm / cpu） */
  backend: string;
  ms: number;
  /** 内訳（計測用） */
  detail: string;
}

export interface RunResult {
  notes: RawNote[];
  ms: number;
  /** 内訳（計測用） */
  detail: string;
}

/**
 * 音源ファイルを Basic Pitch の入力（モノラル 22,050Hz）にする。
 * 動画ファイルも decodeAudioData で音声トラックだけを取り出す（ブラウザ内のみで処理）。
 */
export async function decodeToMono(file: File): Promise<{ samples: Float32Array; duration: number }> {
  const data = await file.arrayBuffer();
  // decodeAudioData は、デコードした音を AudioContext のサンプリング周波数に変換して返す
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  let buf: AudioBuffer;
  try {
    buf = await ctx.decodeAudioData(data);
  } catch {
    throw new Error(
      'このファイルの音声を読み込めませんでした。音声が入っていないか、お使いのブラウザが対応していない形式です。mp3 / wav / m4a などの音声ファイルにしてからお試しください。',
    );
  }
  const n = buf.length;
  const ch = buf.numberOfChannels;
  let samples: Float32Array;
  if (ch === 1) samples = buf.getChannelData(0).slice();
  else {
    samples = new Float32Array(n);
    for (let c = 0; c < ch; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) samples[i] += d[i];
    }
    for (let i = 0; i < n; i++) samples[i] /= ch;
  }
  return { samples, duration: buf.duration };
}

/** 推論用 Worker の操作（読み込み・実行・キャンセル） */
export class TranscribeEngine {
  private worker: Worker | null = null;
  private loading: Promise<LoadInfo> | null = null;
  private pending: { reject: (e: Error) => void } | null = null;

  /** モデルを読み込む（生成画面を開いた時に呼ぶ。2回目以降は同じ結果を返す） */
  load(): Promise<LoadInfo> {
    if (!this.loading) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker = w;
      this.loading = this.request<LoadInfo>({ type: 'load', modelUrl: new URL(MODEL_URL, location.href).href }, (msg, resolve) => {
        if (msg.type === 'loaded') resolve({ backend: msg.backend, ms: msg.ms, detail: msg.detail });
      });
      this.loading.catch(() => this.reset());
    }
    return this.loading;
  }

  async run(samples: Float32Array, onProgress: (ratio: number) => void): Promise<RunResult> {
    await this.load();
    return this.request<RunResult>(
      { type: 'run', samples },
      (msg, resolve) => {
        if (msg.type === 'progress') onProgress(msg.ratio);
        else if (msg.type === 'done') resolve({ notes: msg.notes, ms: msg.ms, detail: msg.detail });
      },
      [samples.buffer],
    );
  }

  /** 実行中の処理を止める（Worker を終了し、次の load で作り直す） */
  cancel() {
    this.pending?.reject(new TranscribeCancelled());
    this.reset();
  }

  dispose() {
    this.cancel();
  }

  private reset() {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.pending = null;
  }

  private request<T>(
    req: WorkerRequest,
    onMessage: (msg: WorkerResponse, resolve: (v: T) => void) => void,
    transfer: Transferable[] = [],
  ): Promise<T> {
    const w = this.worker!;
    return new Promise<T>((resolve, reject) => {
      const done = () => {
        w.removeEventListener('message', listener);
        w.removeEventListener('error', onError);
        if (this.pending?.reject === reject) this.pending = null;
      };
      const listener = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === 'error') {
          done();
          reject(new Error(msg.message));
          return;
        }
        onMessage(msg, (v) => {
          done();
          resolve(v);
        });
      };
      const onError = (e: ErrorEvent) => {
        done();
        reject(new Error(e.message || '音の解析を開始できませんでした'));
      };
      w.addEventListener('message', listener);
      w.addEventListener('error', onError);
      this.pending = { reject };
      w.postMessage(req, transfer);
    });
  }
}

/** Basic Pitch が検出したノート（秒単位） */
export interface RawNote {
  /** 鳴り始め（秒、音源の頭から） */
  start: number;
  /** 長さ（秒） */
  dur: number;
  /** 音の高さ（MIDI ノート番号） */
  pitch: number;
  /** 音の強さ（0〜1） */
  amp: number;
  /** 鳴り始めでの発音らしさ（0〜1）。低いものは直前の同じ音の続きとみなせる */
  onset: number;
}

export type WorkerRequest = { type: 'load'; modelUrl: string } | { type: 'run'; samples: Float32Array };

export type WorkerResponse =
  | { type: 'loaded'; backend: string; ms: number; detail: string }
  | { type: 'progress'; ratio: number }
  | { type: 'done'; notes: RawNote[]; ms: number; detail: string }
  | { type: 'error'; message: string };

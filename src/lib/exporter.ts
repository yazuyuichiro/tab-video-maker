import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import type { Song } from '../types';
import { FPS, VIDEO_WIDTH } from '../types';
import { renderFrame } from './renderer';
import { buildTimeline, songDurationSec } from './timing';

export type ExportPhase = 'loading' | 'encoding' | 'muxing' | 'done';

export interface ExportProgress {
  phase: ExportPhase;
  framesDone: number;
  totalFrames: number;
  /** 経過秒 */
  elapsed: number;
}

/**
 * ffmpeg のコア（約32MBの wasm）は CDN から読み込む。
 * Cloudflare Pages の1ファイル25MB制限を避けるため、アプリには同梱しない。
 */
const CORE_VERSION = '0.12.10';
const CORE_CDNS = [
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm`,
];

async function loadCore(ff: FFmpeg) {
  let lastError: unknown = null;
  for (const base of CORE_CDNS) {
    try {
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      ]);
      await ff.load({ coreURL, wasmURL });
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`動画変換エンジンを読み込めませんでした。ネットワーク接続を確認してください。
${String(lastError)}`);
}

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  if (!loading) {
    loading = (async () => {
      const ff = new FFmpeg();
      await loadCore(ff);
      instance = ff;
      return ff;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

function disposeFFmpeg() {
  try {
    instance?.terminate();
  } catch {
    // noop
  }
  instance = null;
}

export class ExportCancelled extends Error {
  constructor() {
    super('キャンセルされました');
  }
}

/** 1回のエンコードに渡す生フレームデータの上限（バイト） */
const SEGMENT_BYTES = 64 * 1024 * 1024;

/** fast: x264 ultrafast（約2倍速・ファイル大） / compact: veryfast（ファイル小） */
export type EncodeQuality = 'fast' | 'compact';

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * RGBA → YUV420p (BT.709 / リミテッドレンジ) 変換。
 * wasm 版 swscale より JS の方が高速なため、変換済みデータを ffmpeg に渡す。
 */
function rgbaToYuv420(rgba: Uint8ClampedArray, W: number, H: number, out: Uint8Array, offset: number) {
  const ySize = W * H;
  const cw = W >> 1;
  const uOff = offset + ySize;
  const vOff = uOff + (ySize >> 2);
  for (let y = 0; y < H; y++) {
    let si = y * W * 4;
    let di = offset + y * W;
    for (let x = 0; x < W; x++, si += 4) {
      out[di++] = (16 + (46.559 * rgba[si] + 156.629 * rgba[si + 1] + 15.812 * rgba[si + 2]) / 255 + 0.5) | 0;
    }
  }
  for (let y = 0; y < H; y += 2) {
    const r0 = y * W * 4;
    const r1 = r0 + W * 4;
    let ci = (y >> 1) * cw;
    for (let x = 0; x < W; x += 2, ci++) {
      const a = r0 + x * 4;
      const b = r1 + x * 4;
      const r = (rgba[a] + rgba[a + 4] + rgba[b] + rgba[b + 4]) * 0.25;
      const g = (rgba[a + 1] + rgba[a + 5] + rgba[b + 1] + rgba[b + 5]) * 0.25;
      const bl = (rgba[a + 2] + rgba[a + 6] + rgba[b + 2] + rgba[b + 6]) * 0.25;
      out[uOff + ci] = (128 + (-25.664 * r - 86.336 * g + 112 * bl) / 255 + 0.5) | 0;
      out[vOff + ci] = (128 + (112 * r - 101.730 * g - 10.270 * bl) / 255 + 0.5) | 0;
    }
  }
}

export async function exportMp4(
  song: Song,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
  quality: EncodeQuality = 'fast',
): Promise<Blob> {
  const x264Preset = quality === 'fast' ? 'ultrafast' : 'veryfast';
  const startedAt = performance.now();
  const elapsed = () => (performance.now() - startedAt) / 1000;
  const fps = FPS;
  const W = VIDEO_WIDTH;
  const H = song.height;
  const duration = songDurationSec(song);
  const totalFrames = Math.ceil(duration * fps);
  const report = (phase: ExportPhase, framesDone: number) =>
    onProgress({ phase, framesDone, totalFrames, elapsed: elapsed() });

  const checkAbort = () => {
    if (signal.aborted) throw new ExportCancelled();
  };
  const onAbort = () => disposeFFmpeg();
  signal.addEventListener('abort', onAbort);

  const logs: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    logs.push(message);
    if (logs.length > 40) logs.shift();
  };

  let ff: FFmpeg | null = null;
  try {
    report('loading', 0);
    await document.fonts.ready;
    ff = await getFFmpeg();
    checkAbort();
    ff.on('log', onLog);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false })!;
    const tl = buildTimeline(song);

    const frameBytes = (W * H * 3) / 2;
    const perSeg = Math.max(1, Math.min(fps * 4, Math.floor(SEGMENT_BYTES / frameBytes)));
    const parts: Uint8Array[] = [];
    let frame = 0;

    while (frame < totalFrames) {
      const count = Math.min(perSeg, totalFrames - frame);
      const buf = new Uint8Array(count * frameBytes);
      for (let k = 0; k < count; k++) {
        renderFrame(ctx, song, tl, (frame + k) / fps);
        rgbaToYuv420(ctx.getImageData(0, 0, W, H).data, W, H, buf, k * frameBytes);
        if (k % 8 === 7) {
          report('encoding', frame + k);
          await nextTick();
          checkAbort();
        }
      }
      await ff.writeFile('in.yuv', buf);
      checkAbort();
      // prettier-ignore
      const ret = await ff.exec([
        '-hide_banner', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-framerate', String(fps),
        '-i', 'in.yuv',
        '-c:v', 'libx264', '-preset', x264Preset, '-tune', 'animation', '-crf', '16',
        '-bf', '0', '-g', String(fps * 2),
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
        '-f', 'h264', '-y', 'seg.h264',
      ]);
      checkAbort();
      if (ret !== 0) throw new Error(`エンコードに失敗しました\n${logs.join('\n')}`);
      const out = await ff.readFile('seg.h264');
      parts.push(out instanceof Uint8Array ? out : new TextEncoder().encode(out));
      await ff.deleteFile('in.yuv');
      await ff.deleteFile('seg.h264');
      frame += count;
      report('encoding', frame);
    }

    // H.264 エレメンタリストリームを連結して MP4 にまとめる
    report('muxing', totalFrames);
    const size = parts.reduce((a, p) => a + p.byteLength, 0);
    const all = new Uint8Array(size);
    let off = 0;
    for (const p of parts) {
      all.set(p, off);
      off += p.byteLength;
    }
    await ff.writeFile('all.h264', all);
    // prettier-ignore
    const ret = await ff.exec([
      '-hide_banner', '-loglevel', 'error',
      '-framerate', String(fps), '-i', 'all.h264',
      '-c', 'copy', '-movflags', '+faststart', '-y', 'out.mp4',
    ]);
    checkAbort();
    if (ret !== 0) throw new Error(`MP4の作成に失敗しました\n${logs.join('\n')}`);
    const mp4 = await ff.readFile('out.mp4');
    await ff.deleteFile('all.h264');
    await ff.deleteFile('out.mp4');
    report('done', totalFrames);
    const bytes = mp4 instanceof Uint8Array ? mp4 : new TextEncoder().encode(mp4);
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' });
  } catch (e) {
    if (signal.aborted) throw new ExportCancelled();
    // 失敗時は FS の状態が不明なのでインスタンスを作り直す
    disposeFFmpeg();
    throw e;
  } finally {
    signal.removeEventListener('abort', onAbort);
    ff?.off('log', onLog);
  }
}

import { useEffect, useRef, useState } from 'react';
import type { Song } from '../types';
import { FPS, VIDEO_WIDTH } from '../types';
import { ExportCancelled, exportMp4, type EncodeQuality, type ExportProgress } from '../lib/exporter';
import { downloadBlob, safeFileName } from '../lib/storage';
import { formatTime, songDurationSec } from '../lib/timing';
import { Btn } from './ui';

type State =
  | { kind: 'idle' }
  | { kind: 'running'; progress: ExportProgress | null }
  | { kind: 'done'; url: string; size: number }
  | { kind: 'error'; message: string };

interface Props {
  song: Song;
  onClose: () => void;
}

const PHASE_LABEL: Record<ExportProgress['phase'], string> = {
  loading: '動画変換エンジンを読み込み中…（初回のみ約30MBのダウンロード）',
  encoding: 'フレームを描画して H.264 にエンコード中…',
  muxing: 'MP4 にまとめています…',
  done: '完了',
};

export function ExportDialog({ song, onClose }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [quality, setQuality] = useState<EncodeQuality>('fast');
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const duration = songDurationSec(song);
  const frames = Math.ceil(duration * FPS);
  const fileName = `${safeFileName(song.title)}_tab_${VIDEO_WIDTH}x${song.height}.mp4`;

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const start = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setState({ kind: 'running', progress: null });
    try {
      const blob = await exportMp4(song, (p) => setState({ kind: 'running', progress: p }), ac.signal, quality);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      downloadBlob(blob, fileName);
      setState({ kind: 'done', url, size: blob.size });
    } catch (e) {
      if (e instanceof ExportCancelled) setState({ kind: 'idle' });
      else setState({ kind: 'error', message: (e as Error).message || String(e) });
    } finally {
      abortRef.current = null;
    }
  };

  const running = state.kind === 'running';
  const p = state.kind === 'running' ? state.progress : null;
  const ratio = p ? (p.phase === 'muxing' || p.phase === 'done' ? 1 : p.framesDone / Math.max(1, p.totalFrames)) : 0;
  const eta =
    p && p.phase === 'encoding' && p.framesDone > 0
      ? (p.elapsed / p.framesDone) * (p.totalFrames - p.framesDone)
      : null;
  const speed = p && p.phase === 'encoding' && p.elapsed > 0 ? p.framesDone / p.elapsed : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center">
          <h2 className="text-lg font-bold">MP4 動画を書き出し</h2>
          {!running && (
            <button type="button" onClick={onClose} className="ml-auto text-xl text-zinc-400 hover:text-white">
              ×
            </button>
          )}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-zinc-950 p-3 text-sm">
          <dt className="text-zinc-400">サイズ</dt>
          <dd>
            {VIDEO_WIDTH} × {song.height}
          </dd>
          <dt className="text-zinc-400">フレームレート</dt>
          <dd>{FPS} fps（{frames.toLocaleString()} フレーム）</dd>
          <dt className="text-zinc-400">長さ</dt>
          <dd>
            {formatTime(duration)}（{song.measures.length}小節 @ BPM {song.bpm}）
          </dd>
          <dt className="text-zinc-400">背景</dt>
          <dd className="flex items-center gap-2">
            <span className="inline-block h-3.5 w-3.5 rounded-sm border border-white/30" style={{ background: song.backgroundColor }} />
            {song.backgroundColor}
          </dd>
          <dt className="text-zinc-400">形式</dt>
          <dd>H.264 / yuv420p / MP4</dd>
        </dl>

        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {(
            [
              ['fast', '高速（推奨）', '書き出し時間が短い。ファイルサイズはやや大きめ'],
              ['compact', '高圧縮', 'ファイルが約1/2〜1/3。書き出し時間は約2倍'],
            ] as const
          ).map(([v, label, desc]) => (
            <label
              key={v}
              className={`flex flex-1 cursor-pointer items-start gap-2 rounded-lg border p-2 ${
                quality === v ? 'border-emerald-500 bg-emerald-500/10' : 'border-zinc-700'
              } ${state.kind === 'running' ? 'pointer-events-none opacity-50' : ''}`}
            >
              <input
                type="radio"
                className="mt-1 accent-emerald-500"
                checked={quality === v}
                onChange={() => setQuality(v)}
              />
              <span>
                <span className="font-bold">{label}</span>
                <span className="block text-[11px] text-zinc-400">{desc}</span>
              </span>
            </label>
          ))}
        </div>

        {state.kind === 'idle' && (
          <>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              すべての処理はブラウザ内（ffmpeg.wasm）で行われ、データはサーバーへ送信されません。曲の長さによっては数分かかります。
              書き出し中はこのタブを前面に表示したままにしてください。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={onClose}>閉じる</Btn>
              <Btn variant="primary" onClick={start}>
                書き出し開始
              </Btn>
            </div>
          </>
        )}

        {running && (
          <div className="mt-4">
            <div className="mb-1 flex text-xs text-zinc-300">
              <span>{p ? PHASE_LABEL[p.phase] : '準備中…'}</span>
              <span className="ml-auto tabular-nums">{Math.floor(ratio * 100)}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${ratio * 100}%` }} />
            </div>
            <div className="mt-1 flex text-[11px] tabular-nums text-zinc-500">
              <span>
                {p ? `${p.framesDone.toLocaleString()} / ${p.totalFrames.toLocaleString()} フレーム` : ''}
                {speed ? `（${speed.toFixed(0)} fps）` : ''}
              </span>
              <span className="ml-auto">{eta !== null ? `残り 約${formatTime(eta)}` : ''}</span>
            </div>
            <div className="mt-4 flex justify-end">
              <Btn variant="danger" onClick={() => abortRef.current?.abort()}>
                キャンセル
              </Btn>
            </div>
          </div>
        )}

        {state.kind === 'done' && (
          <div className="mt-4">
            <p className="text-sm text-emerald-300">
              書き出しが完了しました（{(state.size / 1024 / 1024).toFixed(1)} MB）。ダウンロードが始まらない場合は下のボタンから保存してください。
            </p>
            <video src={state.url} controls className="mt-3 w-full rounded border border-zinc-700" />
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={onClose}>閉じる</Btn>
              <a
                href={state.url}
                download={fileName}
                className="inline-flex items-center rounded-md border border-emerald-500 bg-emerald-600 px-2.5 py-1 text-sm font-medium text-white hover:bg-emerald-500"
              >
                もう一度ダウンロード
              </a>
            </div>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="mt-4">
            <p className="text-sm text-red-300">書き出しに失敗しました。</p>
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-zinc-950 p-2 text-[11px] whitespace-pre-wrap text-red-200">
              {state.message}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={onClose}>閉じる</Btn>
              <Btn variant="primary" onClick={start}>
                再試行
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Song } from '../types';
import { VIDEO_WIDTH } from '../types';
import { renderFrame, type RenderSelection } from '../lib/renderer';
import {
  formatTime,
  pageCount,
  pageRange,
  parseTimeSignature,
  secToQuarter,
  songDurationSec,
  type Timeline,
} from '../lib/timing';
import { Btn } from './ui';

export interface PlayStart {
  /** 再生開始位置（秒） */
  t: number;
  /** 同じ位置からの再スタートも反映させるための通し番号 */
  id: number;
}

interface Props {
  song: Song;
  timeline: Timeline;
  playing: boolean;
  playStart: PlayStart;
  /** 停止中に表示する時刻（編集位置） */
  editTime: number;
  selection: RenderSelection | null;
  onEnded: () => void;
  /** 再生中の時刻（停止時の位置合わせ用） */
  timeRef: React.MutableRefObject<number>;
  onFirst: () => void;
  onPrevPage: () => void;
  onTogglePlay: () => void;
  onNextPage: () => void;
}

export function Preview({
  song,
  timeline,
  playing,
  playStart,
  editTime,
  selection,
  onEnded,
  timeRef,
  onFirst,
  onPrevPage,
  onTogglePlay,
  onNextPage,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [displayTime, setDisplayTime] = useState(editTime);
  const [metronome, setMetronome] = useState(false);
  const duration = songDurationSec(song);

  const latest = useRef({ song, timeline, selection, metronome, onEnded });
  latest.current = { song, timeline, selection, metronome, onEnded };

  // 停止中: 編集位置を描画
  useEffect(() => {
    if (playing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    renderFrame(ctx, song, timeline, editTime, { selection });
    timeRef.current = editTime;
    setDisplayTime(editTime);
  }, [playing, song, timeline, editTime, selection, timeRef]);

  // フォント読み込み完了後に再描画
  useEffect(() => {
    document.fonts.ready.then(() => {
      const ctx = canvasRef.current?.getContext('2d');
      const l = latest.current;
      if (ctx) renderFrame(ctx, l.song, l.timeline, timeRef.current, { selection: l.selection });
    });
  }, [timeRef]);

  // 再生中: rAF ループ
  useEffect(() => {
    if (!playing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    let audio: AudioContext | null = null;
    try {
      audio = new AudioContext();
    } catch {
      audio = null;
    }
    const started = performance.now();
    let raf = 0;
    let lastBeat = Number.NEGATIVE_INFINITY;
    let lastUi = 0;

    const click = (accent: boolean) => {
      if (!audio) return;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = accent ? 1600 : 1000;
      gain.gain.setValueAtTime(0.25, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.05);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.06);
    };

    const loop = (now: number) => {
      const l = latest.current;
      const t = playStart.t + (now - started) / 1000;
      timeRef.current = t;
      renderFrame(ctx, l.song, l.timeline, t);
      if (l.metronome) {
        const { den, num } = parseTimeSignature(l.song.timeSignature);
        const beat = Math.floor(secToQuarter(l.song, t) / (4 / den) + 1e-6);
        if (beat !== lastBeat) {
          if (lastBeat !== Number.NEGATIVE_INFINITY) click(((beat % num) + num) % num === 0);
          lastBeat = beat;
        }
      }
      if (now - lastUi > 100) {
        setDisplayTime(t);
        lastUi = now;
      }
      if (t >= songDurationSec(l.song)) {
        l.onEnded();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      audio?.close();
    };
  }, [playing, playStart, timeRef]);

  const page = pageRange(song, secToQuarter(song, displayTime)).index;

  return (
    <div>
      <div className="overflow-hidden rounded-md border border-zinc-800 bg-black">
        <canvas
          ref={canvasRef}
          width={VIDEO_WIDTH}
          height={song.height}
          className="block h-auto w-full"
          style={{ aspectRatio: `${VIDEO_WIDTH} / ${song.height}` }}
        />
      </div>
      <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs text-zinc-400">
        <span className="tabular-nums">
          {formatTime(displayTime)} / {formatTime(duration)}　ページ {page + 1} / {pageCount(song)}
        </span>
        <div className="flex items-center gap-1.5">
          <Btn onClick={onFirst} title="曲の最初へ">
            ⏮ 最初から
          </Btn>
          <Btn onClick={onPrevPage} title="前のページへ">
            ◀ 前のページ
          </Btn>
          <Btn variant="accent" className="min-w-24" onClick={onTogglePlay} title="再生 / 停止 (Space)">
            {playing ? '■ 停止' : '▶ 再生'}
          </Btn>
          <Btn onClick={onNextPage} title="次のページへ">
            ページ送り ▶
          </Btn>
        </div>
        <label className="flex items-center justify-self-end gap-1">
          <input type="checkbox" className="accent-sky-500" checked={metronome} onChange={(e) => setMetronome(e.target.checked)} />
          クリック音
        </label>
      </div>
    </div>
  );
}

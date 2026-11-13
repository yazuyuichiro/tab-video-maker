import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Song } from '../types';
import { decodeToMono, TranscribeCancelled, TranscribeEngine, type LoadInfo } from '../lib/transcribe/engine';
import type { RawNote } from '../lib/transcribe/protocol';
import { ampThreshold, SENSITIVITY_MAX, SENSITIVITY_MIN } from '../lib/transcribe/cleanup';
import {
  BPM_MAX,
  BPM_MIN,
  buildTab,
  CAPO_MAX,
  FRET_LIMIT_MAX,
  FRET_LIMIT_MIN,
  pitchName,
  REVIEW_REASON_LABEL,
  type Grid,
  type TabSettings,
} from '../lib/transcribe/toTab';
import { Btn, Label, Modal, NumberField } from './ui';

/** 音源の長さがこれを超えたら、処理時間の注意書きを出す（秒） */
const LONG_AUDIO_SEC = 180;
/** これより大きいファイルは、読み込めない場合があることを伝える（バイト） */
const LARGE_FILE_BYTES = 500 * 1024 * 1024;
const LICENSE_URL = `${import.meta.env.BASE_URL}models/basic-pitch/LICENSE.txt`;
const ACCEPT = 'audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.mp4,.m4v,.mov,.webm';

// 画面を閉じても、読み込んだモデルはこのタブの中で使い回す
let sharedEngine: TranscribeEngine | null = null;
const getEngine = () => (sharedEngine ??= new TranscribeEngine());

type EngineState = { kind: 'loading' } | { kind: 'ready'; info: LoadInfo } | { kind: 'error'; message: string };

type Phase =
  | { kind: 'idle' }
  | { kind: 'decoding'; file: File }
  /** 3分を超える音源: 注意書きを見てから始める */
  | { kind: 'confirm-long'; file: File; samples: Float32Array; duration: number }
  | { kind: 'running'; file: File; duration: number; ratio: number; startedAt: number }
  | { kind: 'done'; file: File; duration: number; notes: RawNote[]; ms: number }
  | { kind: 'error'; message: string };

const fmtDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const fmtSize = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${Math.round(bytes / 1024 ** 2)}MB`);

function hasInput(song: Song) {
  return song.measures.some((m) => m.notes.length > 0 || m.chordName);
}

function Section({ step, title, children }: { step: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-zinc-200">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-700 text-[11px]">{step}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

interface Props {
  song: Song;
  onApply: (song: Song) => void;
  onClose: () => void;
}

/** 音源から Tab の下書きを作る（すべてブラウザ内で処理） */
export function TranscribeDialog({ song, onApply, onClose }: Props) {
  const [engine, setEngine] = useState<EngineState>({ kind: 'loading' });
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [settings, setSettings] = useState<TabSettings>({ bpm: song.bpm, grid: 16, sensitivity: 5, capo: 0, maxFret: 24 });
  const [confirming, setConfirming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 実行中の処理の番号（キャンセル後に古い結果が届いても無視する） */
  const runId = useRef(0);
  const running = phase.kind === 'running';
  const busy = phase.kind === 'decoding' || running;
  const busyRef = useRef(false);
  busyRef.current = busy;

  const loadEngine = () => {
    setEngine({ kind: 'loading' });
    getEngine()
      .load()
      .then((info) => {
        if (import.meta.env.DEV) console.info(`[transcribe] load ${info.backend} ${Math.round(info.ms)}ms (${info.detail})`);
        setEngine({ kind: 'ready', info });
      })
      .catch((e: Error) => setEngine({ kind: 'error', message: e.message }));
  };

  // 画面を開いた時にモデルを読み込む（自ドメインから。2回目以降はすぐ終わる）
  useEffect(() => {
    loadEngine();
    return () => {
      // 解析中に閉じた時は止める
      runId.current++;
      if (busyRef.current) getEngine().cancel();
    };
  }, []);

  // 経過時間の表示
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, [running]);

  const analyze = async (file: File, samples: Float32Array, duration: number, id: number) => {
    setPhase({ kind: 'running', file, duration, ratio: 0, startedAt: performance.now() });
    try {
      const res = await getEngine().run(samples, (ratio) => {
        if (runId.current === id) setPhase((p) => (p.kind === 'running' ? { ...p, ratio } : p));
      });
      if (runId.current !== id) return;
      if (import.meta.env.DEV) console.info(`[transcribe] ${duration.toFixed(1)}s audio → ${Math.round(res.ms)}ms (${res.detail})`);
      setPhase({ kind: 'done', file, duration, notes: res.notes, ms: res.ms });
    } catch (e) {
      if (runId.current !== id) return;
      if (e instanceof TranscribeCancelled) setPhase({ kind: 'idle' });
      else setPhase({ kind: 'error', message: (e as Error).message || String(e) });
      // 止めた / 失敗した Worker は作り直す
      loadEngine();
    }
  };

  const pick = async (file: File) => {
    const id = ++runId.current;
    setConfirming(false);
    setPhase({ kind: 'decoding', file });
    try {
      const { samples, duration } = await decodeToMono(file);
      if (runId.current !== id) return;
      if (duration > LONG_AUDIO_SEC) setPhase({ kind: 'confirm-long', file, samples, duration });
      else await analyze(file, samples, duration, id);
    } catch (e) {
      if (runId.current === id) setPhase({ kind: 'error', message: (e as Error).message || String(e) });
    }
  };

  const cancel = () => {
    runId.current++;
    if (running) {
      getEngine().cancel();
      loadEngine();
    }
    setPhase({ kind: 'idle' });
  };

  const result = useMemo(
    () => (phase.kind === 'done' ? buildTab(phase.notes, settings, song) : null),
    [phase, settings, song],
  );

  const apply = () => {
    if (!result) return;
    onApply(result.song);
    onClose();
  };

  // 解析中は背景のクリックや Esc では閉じない（キャンセルで止める）。確認ダイアログが出ている時はそれだけ閉じる
  const requestClose = () => {
    if (confirming) setConfirming(false);
    else if (!busy) onClose();
  };

  const set = <K extends keyof TabSettings>(key: K, value: TabSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const file = phase.kind === 'idle' || phase.kind === 'error' ? null : phase.file;
  const duration = phase.kind === 'confirm-long' || phase.kind === 'running' || phase.kind === 'done' ? phase.duration : null;
  // 計算方式: webgl（GPU）/ wasm（CPU。GPU とほぼ同じ速さ）/ cpu（JavaScript。音源の長さの約3倍かかる）
  const backend = engine.kind === 'ready' ? engine.info.backend : null;
  const slow = backend === 'cpu';
  const lowCount = result?.review.filter((r) => r.reason !== 'no-string').length ?? 0;
  const noStringCount = result?.review.filter((r) => r.reason === 'no-string').length ?? 0;

  return (
    <Modal
      title="音源から Tab の下書きを作る"
      onClose={requestClose}
      width="max-w-3xl"
      footer={
        <>
          <p className="mr-auto self-center text-[11px] text-zinc-500">
            <a href="https://github.com/spotify/basic-pitch" target="_blank" rel="noopener noreferrer" className="underline hover:text-zinc-300">
              Basic Pitch
            </a>
            （© 2022 Spotify AB）を使用しています／
            <a href={LICENSE_URL} target="_blank" rel="noopener" className="underline hover:text-zinc-300">
              Apache License 2.0
            </a>
          </p>
          <Btn onClick={requestClose} disabled={busy}>
            閉じる
          </Btn>
          <Btn
            variant="primary"
            disabled={!result || result.placed === 0}
            onClick={() => (hasInput(song) ? setConfirming(true) : apply())}
          >
            エディタに反映
          </Btn>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-zinc-300">
        <p className="rounded-lg border border-amber-500/60 bg-amber-950/30 px-3 py-2 font-bold text-amber-200">
          自動生成は下書きです。音の取りこぼしや間違いがあるので、公開前に必ず手直ししてください
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-zinc-400">
          <li>音源はお使いのブラウザ内だけで処理され、サーバーに送信されません</li>
          <li>ギター単体の録音が最も精度が出ます</li>
        </ul>

        <Section step={1} title="音源を選ぶ">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f && !busy) void pick(f);
            }}
            className={`flex w-full flex-col items-center rounded-lg border-2 border-dashed px-3 py-4 text-center transition-colors disabled:opacity-50 ${
              dragOver ? 'border-emerald-500 bg-emerald-500/10' : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/50'
            }`}
          >
            <span className="font-bold text-zinc-100">ファイルを選ぶ（ここにドロップもできます）</span>
            <span className="mt-0.5 text-xs text-zinc-400">音声ファイル（mp3 / wav / m4a など）、または動画ファイル（mp4 など。音声だけを使います）</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void pick(f);
            }}
          />

          {file && (
            <p className="mt-2 text-xs text-zinc-400">
              <span className="font-bold text-zinc-200">{file.name}</span>
              {duration !== null && <>（{fmtDuration(duration)}）</>}
            </p>
          )}
          {file && file.size > LARGE_FILE_BYTES && phase.kind === 'decoding' && (
            <p className="mt-1 text-xs text-amber-300">
              大きなファイルです（{fmtSize(file.size)}）。読み込めない場合は、音声だけのファイルにしてからお試しください。
            </p>
          )}

          <p className="mt-2 text-xs">
            <span className="text-zinc-500">解析エンジン: </span>
            {engine.kind === 'loading' && <span className="text-zinc-300">準備中…（初めての時は数十秒かかることがあります）</span>}
            {engine.kind === 'ready' && <span className="text-emerald-300">準備できました{backend === 'webgl' ? '（GPU で計算）' : '（CPU で計算）'}</span>}
            {engine.kind === 'error' && (
              <span className="text-red-300">
                準備できませんでした（{engine.message}）
                <button type="button" className="ml-2 underline" onClick={loadEngine}>
                  もう一度
                </button>
              </span>
            )}
          </p>
          {slow && (
            <p className="mt-1 text-xs text-amber-300">
              この環境では高速な計算方式が使えないため、解析に時間がかかります（目安: 音源の長さの約3倍）。
            </p>
          )}

          {phase.kind === 'decoding' && <p className="mt-3 text-xs text-zinc-300">音声を読み込んでいます…</p>}

          {phase.kind === 'confirm-long' && (
            <div className="mt-3 rounded-lg border border-amber-500/60 bg-amber-950/30 p-3 text-xs">
              <p className="text-amber-200">
                3分を超える音源です（{fmtDuration(phase.duration)}）。解析に時間がかかります
                {slow ? `（この環境では 約${Math.ceil((phase.duration * 3) / 60)}分以上）` : '（数十秒〜数分）'}
                。途中でキャンセルできます。
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Btn onClick={cancel}>やめる</Btn>
                <Btn variant="primary" onClick={() => void analyze(phase.file, phase.samples, phase.duration, runId.current)}>
                  解析を始める
                </Btn>
              </div>
            </div>
          )}

          {running && (
            <div className="mt-3">
              <div className="mb-1 flex text-xs text-zinc-300">
                <span>{engine.kind === 'loading' ? '解析エンジンの準備を待っています…' : '音を解析しています…'}</span>
                <span className="ml-auto tabular-nums">
                  {Math.floor(phase.ratio * 100)}%（経過 {fmtDuration((performance.now() - phase.startedAt) / 1000)}）
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
                <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${phase.ratio * 100}%` }} />
              </div>
              <div className="mt-2 flex justify-end">
                <Btn variant="danger" onClick={cancel}>
                  キャンセル
                </Btn>
              </div>
            </div>
          )}

          {phase.kind === 'error' && (
            <p className="mt-3 rounded bg-zinc-950 p-2 text-xs whitespace-pre-wrap text-red-300">{phase.message}</p>
          )}
        </Section>

        <Section step={2} title="設定">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-1.5">
              <Label>BPM</Label>
              <NumberField value={settings.bpm} min={BPM_MIN} max={BPM_MAX} className="w-16" onChange={(v) => set('bpm', Math.round(v))} />
            </label>
            <div className="flex items-center gap-1.5">
              <Label>グリッド</Label>
              {([8, 16] as Grid[]).map((g) => (
                <Btn key={g} active={settings.grid === g} onClick={() => set('grid', g)} className="h-7 px-2 text-xs">
                  {g}分
                </Btn>
              ))}
            </div>
            <label className="flex items-center gap-1.5" title="小さい音まで拾うほど、倍音などの余計な音も増えます">
              <Label>感度</Label>
              <input
                type="range"
                min={SENSITIVITY_MIN}
                max={SENSITIVITY_MAX}
                step={1}
                value={settings.sensitivity}
                onChange={(e) => set('sensitivity', Number(e.target.value))}
                className="w-28 accent-emerald-500"
              />
              <span className="w-5 text-right font-mono text-xs tabular-nums text-zinc-200">{settings.sensitivity}</span>
            </label>
            <label className="flex items-center gap-1.5">
              <Label>カポ</Label>
              <NumberField value={settings.capo} min={0} max={CAPO_MAX} className="w-12" onChange={(v) => set('capo', Math.round(v))} />
            </label>
            <label className="flex items-center gap-1.5" title="Tab に書く数字（カポからの数え方）の上限">
              <Label>フレット上限</Label>
              <NumberField
                value={settings.maxFret}
                min={FRET_LIMIT_MIN}
                max={FRET_LIMIT_MAX}
                className="w-12"
                onChange={(v) => set('maxFret', Math.round(v))}
              />
            </label>
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-zinc-500">
            <li>BPM は元の曲のテンポに合わせてください。最初に検出した音を 1 小節目の 1 拍目にします（拍子は今の曲の {song.timeSignature}）</li>
            <li>1 オクターブ上などの余計な音が多い時は感度を下げ、コードの音が抜ける時は上げてください</li>
            <li>標準チューニング（6弦から E A D G B E）で弦とフレットを決めます。設定は解析後に変えても、すぐ結果に反映されます</li>
          </ul>
        </Section>

        <Section step={3} title="結果を確かめる">
          {!result && <p className="text-xs text-zinc-500">音源を解析すると、ここに結果が出ます。</p>}
          {result && phase.kind === 'done' && (
            <>
              {result.detected === 0 ? (
                <p className="text-xs text-amber-300">音が検出されませんでした。感度を上げるか、別の音源をお試しください。</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-zinc-950 p-3 text-xs">
                  <dt className="text-zinc-400">検出ノート数</dt>
                  <dd className="tabular-nums">
                    {result.detected}（Tab に置いた音 {result.placed}。同じマスに入った同じ音は1つにまとめています）
                  </dd>
                  <dt className="text-zinc-400">要確認ノート数</dt>
                  <dd className={`tabular-nums ${result.review.length ? 'font-bold text-amber-300' : ''}`}>
                    {result.review.length}
                    {result.review.length > 0 && `（オクターブを移して配置 ${lowCount}・弦が足りず未配置 ${noStringCount}）`}
                  </dd>
                  <dt className="text-zinc-400">小節数</dt>
                  <dd className="tabular-nums">
                    {result.song.measures.length} 小節（音源の {result.offsetSec.toFixed(2)} 秒目を 1 小節目の頭にしました）
                  </dd>
                  <dt className="text-zinc-400">使用した設定</dt>
                  <dd>
                    BPM {result.song.bpm} / {settings.grid}分 / 感度 {settings.sensitivity}（強さ {ampThreshold(settings.sensitivity).toFixed(2)} 未満を除く）/ カポ{' '}
                    {settings.capo} / フレット上限 {settings.maxFret}
                  </dd>
                  <dt className="text-zinc-400">解析時間</dt>
                  <dd className="tabular-nums">{(phase.ms / 1000).toFixed(1)} 秒</dd>
                </dl>
              )}
              {result.review.length > 0 && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-zinc-900 text-zinc-400">
                      <tr>
                        <th className="px-2 py-1 font-normal">小節</th>
                        <th className="px-2 py-1 font-normal">拍</th>
                        <th className="px-2 py-1 font-normal">音名</th>
                        <th className="px-2 py-1 font-normal">理由</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {result.review.map((r, i) => (
                        <tr key={i} className="border-t border-zinc-800">
                          <td className="px-2 py-1">{r.measure}</td>
                          <td className="px-2 py-1">{r.beat}</td>
                          <td className="px-2 py-1 font-mono">
                            {pitchName(r.pitch)}
                            {r.placed !== null && <span className="text-zinc-500"> → {pitchName(r.placed)}</span>}
                          </td>
                          <td className="px-2 py-1">{REVIEW_REASON_LABEL[r.reason]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Section>
      </div>

      {confirming && result && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setConfirming(false)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="transcribe-overwrite-title"
            className="w-full max-w-md rounded-xl border border-zinc-700 border-t-4 border-t-amber-500 bg-zinc-900 p-4 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 id="transcribe-overwrite-title" className="font-display text-base">
              今の Tab を上書きしますか？
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-300">
              エディタに入力済みの内容（{song.measures.length} 小節）を、生成した下書き（{result.song.measures.length} 小節）で置き換えます。
              今の内容と合わせる（マージする）ことはしません。BPM は {result.song.bpm} になります。
            </p>
            <p className="mt-1 text-xs text-zinc-500">上書きする前の内容は「元に戻す」（Ctrl+Z）で戻せます。</p>
            <div className="mt-4 flex justify-end gap-2">
              <Btn autoFocus onClick={() => setConfirming(false)}>
                やめる
              </Btn>
              <Btn variant="primary" onClick={apply}>
                上書きして反映
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

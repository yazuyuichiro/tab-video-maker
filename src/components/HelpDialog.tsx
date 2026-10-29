import type { ReactNode } from 'react';
import { Btn, Modal } from './ui';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-sm font-bold text-zinc-200">{title}</h3>
      {children}
    </section>
  );
}

const KEYS: [string, string][] = [
  ['Space', '再生 / 停止'],
  ['数字キー', 'フレットを入力（2桁は続けて入力）'],
  ['矢印キー / Enter', 'マスを移動'],
  ['N / V / R', 'ピッキング ⊓ / V / 休符'],
  ['Ctrl + C / X / V', 'コピー / 切り取り / 貼り付け'],
  ['Ctrl + D', '右隣に複製'],
  ['Delete', '消去'],
  ['Ctrl + Z / Ctrl + Y', '元に戻す / やり直し'],
];

/** 使い方（保存のしくみ・基本の流れ・キー操作） */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="使い方"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <Btn variant="primary" onClick={onClose}>
          閉じる
        </Btn>
      }
    >
      <div className="text-sm leading-relaxed text-zinc-300">
        <section className="rounded-lg border border-amber-500/60 bg-amber-950/30 p-4">
          <h3 className="text-base font-bold text-amber-200">保存について</h3>
          <p className="mt-1">
            <strong className="text-zinc-50">残しておきたいものは、ファイルとしてパソコンにダウンロードして保存します。</strong>
            サーバーやクラウドには保存されません。
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="font-bold text-zinc-100">曲データを保存</dt>
            <dd>
              「保存」を押すと、曲データのファイル（<code className="text-amber-200">曲名.json</code>）がダウンロードされます
            </dd>
            <dt className="font-bold text-zinc-100">続きから作業する</dt>
            <dd>「読込」を押して、ダウンロードしたファイルを選びます</dd>
            <dt className="font-bold text-zinc-100">完成した動画</dt>
            <dd>「MP4出力」で、動画ファイル（MP4）がダウンロードされます</dd>
          </dl>
          <p className="mt-3 text-xs text-zinc-400">
            ダウンロードしたファイルは、ブラウザで設定している保存先（ふつうは「ダウンロード」フォルダ）に入ります。
          </p>
          <p className="mt-2 text-xs text-zinc-400">
            作業中の内容は、このパソコンのこのブラウザの中にも自動で一時保存されるので、同じブラウザで開き直せば続きから使えます。
            ただし、ブラウザの履歴やサイトのデータを消すと消えてしまい、別のパソコンや別のブラウザからは開けません。
            また、一度に一曲分しか残りません。大事な曲は「保存」でダウンロードしておいてください。
          </p>
        </section>

        <Section title="基本の流れ">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>曲名・BPM・拍子と、動画のサイズ・背景（白 / 黒）を決めます</li>
            <li>
              下のエディタで、1小節ずつ TAB 譜・コード・ピッキング・歌詞を入力します。「コードから作成」「リズムの自動作成」を使うと、まとめて入力できます
            </li>
            <li>上のプレビューで再生して確かめます</li>
            <li>「保存」で曲データをダウンロードし、「MP4出力」で動画を書き出します</li>
            <li>
              動画編集ソフトで、演奏の動画の下に重ねます。白背景は「乗算」、黒背景は「スクリーン」で重ねると背景が消えます。動画は 0 秒目から 1 小節目が始まるので、演奏の始まりに合わせて置いてください
            </li>
          </ol>
        </Section>

        <Section title="主なキー操作（エディタ）">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {KEYS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-100">{k}</kbd>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-zinc-500">エディタのボタンにマウスを乗せると、ほかのショートカットも確認できます。</p>
        </Section>
      </div>
    </Modal>
  );
}

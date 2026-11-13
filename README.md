# たぶめいかぁ

演奏動画の下部に重ねる「Tab譜＋歌詞＋コード名＋演奏ニュアンス」の横長動画（MP4 / H.264 / 60fps）を、ブラウザだけで作成するWebアプリです。
動画処理はすべてブラウザ内（ffmpeg.wasm）で行われ、サーバーは不要です。

## セットアップ

```bash
npm install
npm run dev       # 開発サーバー http://localhost:5173
npm run build     # 本番ビルド（dist/ を静的ホスティングに配置するだけで動作）
```

> `dist/` には ffmpeg のコア（約32MB の wasm）が含まれます。MP4出力時にのみ読み込まれます。

## 公開設定（環境変数）

運営者名・連絡先・広告IDは環境変数で設定します。`.env` は GitHub に公開されないので、値はそこに書いてください。

| 変数 | 内容 |
| --- | --- |
| `VITE_OPERATOR_NAME` | 運営者名（プライバシーポリシーに表示。既定: yason） |
| `VITE_CONTACT` | お問い合わせ先（同上。既定: https://yason-eng.com/contact ） |
| `VITE_ADSENSE_CLIENT` | AdSense のサイト運営者ID（`ca-pub-…`）。設定すると審査用タグと `ads.txt` を出力 |
| `VITE_ADSENSE_SLOT` | エディタ下バナーの広告ユニットID |

- ローカル: `.env.example` を `.env` にコピーして記入
- Cloudflare: 「Workers & Pages → tab-video-maker → 設定 → ビルド → 変数とシークレット」に同じ名前で登録（ビルド時に埋め込まれます。登録後に再デプロイが必要）

## 画面

- **ヘッダー**: 曲名・BPM・拍子・サイズ（1920×250 / 200 / 300）・背景（白/黒、初期値は白）・1ページの小節数、保存/読込、MP4出力
- **ホーム**: ヘッダー左上の ⌂ で入口ページ（yason-eng.com）を新しいタブで開く（ふりぃだうと同じ）
  - 動画は0秒目から1小節目が始まります（元動画の演奏開始位置に合わせて貼り付けてください）
  - 黒背景は動画編集ソフトの合成モード「スクリーン」、白背景は「乗算」で重ねると背景が消えます
- **プレビュー**: 各ページの左端に拍子記号（3/4・4/4 など）。TAB譜の下に音の長さを表すリズム表記（符尾・連桁・付点・連符の数字・休符）を自動で表示。楽譜は止まったまま赤線が左→右へ進み、右端に着くと次のページに切り替わります。音の長さは弦上の帯で表示
- **再生ボタン**: 最初から / 前のページ / 再生・停止（Space） / ページ送り
- **エディタ**: 1小節ずつ編集。フレットはキーボードで直接入力、コード・ピック・奏法はクリックで開く候補からも選択可
  - 分割は拍ごとに選択（4分 / 8分 / 3連 / 16分 / 5連 / 6連 / 32分 / 2拍3連）。左端の「一括」で全拍を変更。小節の幅は分割によらず一定
  - フレット `0〜24` `x`、ピック `D`(⊓) `U`(V) `R`(休符＝ここで音を止める)、奏法 `h` `p` `s` `c` `hc` `x`
  - 矢印キー・Enterでマス移動（小節の端では前後の小節へ）
  - **選択**: 拍番号（1-1 など）のクリック・ドラッグで範囲選択（Shift+クリックで延長、別の小節へも可）、「拍」で小節全体。弦のマスをドラッグすると時間×弦の範囲を選択。マスのダブルクリックで全弦、トリプルクリックで小節
  - **一括入力**: 範囲を選んで数字キー（2桁は続けて）／`X` でデッドノート
  - **弦単位のコピー**: 弦を選んでコピーするとその弦のフレットだけをコピー。貼り付け先で選んだ一番上の弦に、コピー元の一番上の弦を合わせて貼り付け（例: 6〜4弦 → 5〜3弦。1〜6弦からはみ出す場合は収まる位置へ）。全弦選択のコピーはピッキング・歌詞なども含めて音符ごと
  - **操作パレット**（ボタンにカーソルを当てるとショートカットを表示）
    | 操作 | キー |
    | --- | --- |
    | コピー / 切り取り / 貼り付け | Ctrl+C / Ctrl+X / Ctrl+V |
    | 弦の範囲を広げる / 狭める | Shift+↑ / Shift+↓ |
    | リズムだけ貼り付け（フレットは貼り付け先のコードから） | Ctrl+Shift+V |
    | 右隣に複製 | Ctrl+D |
    | 消去（弦を選んでいる時はその弦のフレットだけ） | Delete |
    | 分割 / フレットを複製しながら分割 / 統合 | E・+ / Shift+E / Q・− |
    | ピック ⊓ / V / 休符 | N / V / R |
    | 奏法 h p s c hc x | H P S C B M |
    | タイ / スラー | T / L |
    | じゃらーんの矢印 ↑（低音弦→高音弦）/ ↓（高音弦→低音弦） | J / K |
    | フレット −1 / ＋1 | A / D |
    | 同じ音のまま隣の弦へ | Alt+↑ / Alt+↓ |
    | 元に戻す / やり直し | Ctrl+Z / Ctrl+Y |
  - **コード展開**: 置いた音（一番低い音）をルートに、パワーコード・オクターブ・メジャー・マイナー・セブンス等へ展開
  - 複数マスの選択範囲は拍番号をつかんでドラッグで移動
- **補助機能（モーダル）**
  - **コードから作成**: コード名（`Am7` `FM7` `Dadd9` `C/G` など）から押さえ方の候補を出し、エディタの選択範囲に入力
  - **リズムの自動作成**: 8ビート / 16ビートカッティング / アルペジオ等のパターンで、選択範囲を含む小節に音符とピッキングを入力（小節のコードの押さえ方を使用）
- **音源から下書き**（ヘッダーのボタン）: 音声ファイル（mp3 / wav / m4a 等）または動画ファイル（mp4 等。音声トラックだけ使用）から Tab の下書きを作る。処理はすべてブラウザ内で、音源はサーバーに送らない
  - 音の検出は [Basic Pitch](https://github.com/spotify/basic-pitch)（© 2022 Spotify AB, Apache License 2.0）。入力はモノラル 22,050Hz に変換して Worker で推論。計算は GPU（WebGL）→ WebAssembly → JavaScript の順に、使える方式で行う
  - ノート化はギター用の設定（音域 E2〜E6 など。値は `src/lib/transcribe/preset.ts` にまとめている）
  - 後処理: 同じ音高の分断ノートの結合 → 感度（音の強さのしきい値）→ 80ms 未満の除去 → 倍音の幻音の除去（低い音とほぼ同時に鳴り始めた、オクターブ上・オクターブと5度上の弱い音。除いた音は「要確認」として一覧に出す。コードの本物のオクターブ重ねも除いてしまうため、既定では使わない。preset.ts の `harmonicFilter` で切り替える）
  - 設定: BPM / グリッド（8分・16分）/ 感度 / カポ / フレット上限。最初に検出した音を 1 小節目の 1 拍目にし、拍子は今の曲のものを使う
  - 弦・フレットは標準チューニングで、同時音は別の弦に置き、フレーズ全体の移動量が最小になるよう動的計画法で選ぶ。音域外の音はオクターブを移して配置、弦が足りない音は配置せず、どちらも「要確認」として一覧に出す
  - 反映すると曲の小節と BPM を置き換える（既存の入力がある時は確認あり。「元に戻す」で戻せる）

保存は「保存」で曲データ（JSON）をパソコンにダウンロードし、続きは「読込」でそのファイルを開きます。作業中の内容はブラウザ内（localStorage）にも一時保存されるので、同じブラウザで開き直せば続きから使えます。ヘッダーの「使い方」に、保存のしかた・基本の流れ・キー操作をまとめています。

## データ形式（JSON）

```json
{
  "title": "Sample Song",
  "bpm": 120,
  "timeSignature": "4/4",
  "height": 250,
  "backgroundColor": "#000000",
  "measuresPerPage": 2,
  "measures": [
    {
      "measureIndex": 1,
      "segments": [{ "beats": 1, "div": 2 }, { "beats": 1, "div": 3 }, { "beats": 2, "div": 3 }],
      "chordName": "Am",
      "notes": [
        { "tick": 0, "picking": "down", "frets": { "1": 0, "2": 1, "3": 2, "4": 2, "5": 0, "6": null }, "nuance": null, "lyric": "か" }
      ]
    }
  ]
}
```

- `tick`: 小節頭からの位置（4分音符 = 480）
- `segments`: 拍ごとの分割（`beats` 拍を `div` 等分）
- `notes[].nuance`: `hammer` `pull` `slide` `choke` `hc` `mute` `tie` `slur`、`notes[].strum`: `"up"` / `"down"`（じゃらーんの矢印）
- `notes[].rest`: 休符、`notes[].chord`: 小節途中のコードチェンジ、`frets` の値 `"x"`: ミュート
- 設計書初版の形式（`gridSplit` + `position`、`resolution`）のファイルも読み込み時に自動変換されます

## デザイン

3つのサイト（入口ページ・たぶめいかぁ・ふりぃだう）共通のデザイン「ペダルボード」で作っています。色と文字のルールは、入口ページのリポジトリ（yason-eng-home）の README にまとめています。

- 色とフォントは [src/index.css](src/index.css)。Tailwind の zinc・emerald・amber を共通の色に置き換えています
- 画面上部の帯（`.faceplate`）がこのアプリの塗装色（緑）です。帯の中のボタンや入力欄は、CSS 変数で塗装面用の色に切り替わります
- フォントは @fontsource から同梱し、画面を出したあとに読み込みます（[src/fonts.ts](src/fonts.ts)）。vite.config.ts の webFonts で woff2 だけを配信し、Windows に入っている BIZ UD ゴシックを優先します

## 構成

```
src/
  lib/
    timing.ts     拍・小節・ページ・時間の変換、タイムライン構築
    renderer.ts   Canvas 描画（プレビューと動画書き出しで共通）
    exporter.ts   ffmpeg.wasm による MP4 書き出し
    chords.ts     コード名解析・押さえ方の自動生成
    presets.ts    リズムパターン
    songOps.ts    曲データの編集操作
    lyrics.ts     歌詞の分割
    storage.ts    自動保存・JSON 入出力・旧形式の変換
    transcribe/   音源から下書き
      engine.ts   音声のデコード（モノラル 22,050Hz）と推論 Worker の操作
      worker.ts   Basic Pitch の推論（Worker）
      extract.ts  推論結果からのノート抽出（outputToNotesPoly を区間ごとに。音域の制限）
      preset.ts   ギター用の設定（ノート化と後処理の値。調整はここだけ）
      wasmBackend.ts  GPU が使えない時の計算方式（WebAssembly。その時だけ読み込む）
      cleanup.ts  後処理（分断ノートの結合・感度・短いノート・倍音の幻音の除去）
      toTab.ts    クオンタイズ・弦とフレットの割り当て → 曲データ
  state/useSongStore.ts   曲データ + 元に戻す/やり直し
  components/
    Header / Preview / Editor / TabGrid / ComboCell
    ChordModal / RhythmModal / ChordDiagram / ExportDialog / ui
    TranscribeDialog   音源から下書き（開いた時に読み込む）
public/models/basic-pitch/   Basic Pitch のモデルと LICENSE（自ドメインから配信）
```

### 音源から下書き（保守メモ）

- モデル（`model.json` と `group1-shard1of1.bin`、約0.9MB）と `LICENSE.txt` は、`node_modules/@spotify/basic-pitch/model/` と同パッケージの `LICENSE` をコピーしたもの。`@spotify/basic-pitch` を更新したらコピーし直す
- tfjs は `@spotify/basic-pitch` が使う 3.x だけを使う（二重に入れない）。`@tensorflow/tfjs` を package.json に足さない
- WebAssembly 版（`@tensorflow/tfjs-backend-wasm`）は tfjs-core と同じ版（3.21.0）に固定している。版がずれると動かないので、basic-pitch の更新で tfjs が変わったら合わせる
- 計算方式は worker.ts で WebGL → WebAssembly → JavaScript の順に試し、モデルの読み込みか試運転で失敗したら次の方式に移る。WebAssembly 版は WebGL が使えない時だけ読み込む
- wasm ファイル（3種、各 300KB 前後）は wasmBackend.ts の `?url` でビルドに含め、自ドメインの `/assets/` から配信する（CDN は使わない）。ページがクロスオリジン分離（COOP/COEP）されていないので、スレッド版は使われず SIMD 版になる
- tfjs 3.x は Worker の中で `window` を参照して止まる不具合があるため、worker.ts で `setTimeoutCustom` を普通の `setTimeout` に置き換えている
- tfjs 3.21 の WebAssembly 版は、型を省略した `Fill`（Basic Pitch の `tf.signal.frame` が末尾のゼロ埋めで使う）で止まる不具合があるため、wasmBackend.ts で値から型を補うよう包み直している
- Basic Pitch の `outputToNotesPoly` は音源の長さの2乗で遅くなるため、extract.ts で 10 秒ずつ（前後 2 秒の余白付き）に分けて処理している
- 音域の制限は `outputToNotesPoly` の `minFreq` / `maxFreq` を使わず、extract.ts で範囲外を 0 にした写しを渡している。ライブラリ側は渡した配列を書き換えるうえ、Hz → 音の番号の端数を切り捨てるため、82Hz・1319Hz では範囲が半音下にずれる（D#2〜D#6）。preset.ts の Hz はいちばん近い音に丸め、両端を含む（82Hz・1319Hz → E2〜E6）
- `minNoteFrames` は Basic Pitch の minNoteLen で、「この値以下」の長さを捨てる（9 なら約116ms 以上だけ残る）。速い16分音符（BPM 120 で 125ms）より長くすると、単音フレーズの音が抜ける（10 で1音、11 で2音抜けた）
- 計測の目安（AMD Radeon 内蔵 GPU / Chrome）: GPU は初回の準備（シェーダーのコンパイル）約13秒・2回目以降約1秒、推論は音源の長さの約0.1〜0.17倍。GPU が使えない環境は、WebAssembly で準備約0.7秒・音源の長さの約0.17倍、JavaScript だけだと約2.6倍。3つの方式の検出結果は同じ

MP4 書き出しは、フレームを Canvas に描画 → JS で YUV420 に変換 → 約64MBごとに libx264 でエンコード → 連結して MP4 化、の流れで、長い曲でもメモリ使用量が一定です。

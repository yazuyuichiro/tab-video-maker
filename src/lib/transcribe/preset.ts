/**
 * 音源から下書き: ギター用の設定（ノート化と後処理の値）。値を調整する時はこのファイルだけを変える。
 * - ノート化の値（Worker で使う）は、音源を解析し直すと反映される
 * - 後処理の値は、解析後に画面の設定（感度など）を変えた時にも使われる
 */
export interface TranscribePreset {
  // ---- ノート化（Basic Pitch の outputToNotesPoly に渡す値。extract.ts）
  /** 鳴り始めとみなす確からしさのしきい値（onsetThresh。0〜1、高いほど鳴り始めとみなしにくい） */
  onsetThresh: number;
  /** 鳴っているとみなす確からしさのしきい値（frameThresh。0〜1、高いほど音が早く切れる） */
  frameThresh: number;
  /**
   * ノートの最小の長さ（minNoteLen。1フレーム ≈ 11.6ms）。
   * Basic Pitch は「この値以下」の長さを捨てるので、9 なら 10 フレーム（約116ms）以上が残る。
   * 速い16分音符より長くすると、単音フレーズの音が抜ける（テスト音源の BPM 120 の16分＝125ms は、10 で1音・11 で2音抜けた）
   */
  minNoteFrames: number;
  /** 鳴り始めを、鳴っている確からしさの増え方からも推定する（inferOnsets） */
  inferOnsets: boolean;
  /** 鳴り始めが見つからない音も、残った反応から拾う（melodiaTrick） */
  melodiaTrick: boolean;
  /** 音域（Hz）。いちばん近い音（MIDI）に丸め、その範囲（両端を含む）の外は検出しない。null は制限なし */
  minFreqHz: number | null;
  maxFreqHz: number | null;

  // ---- 後処理（cleanup.ts）
  /**
   * 同じ音高のノートの間がこれ以内なら、鳴り続けている音の再検出（コードの鳴り続けによる再トリガーや分断）の候補（秒）。
   * 重なっている時も含む
   */
  mergeGapSec: number;
  /**
   * 候補のうち、後のノートの鳴り始めの発音らしさ（Basic Pitch の onset 出力。鳴り始めの前後1フレームの最大）が
   * これ未満なら前のノートに統合し、これ以上なら弾き直しとして別の音のまま残す。
   * ノートの強さ（amp）は弾き直しでも上がらない（テスト音源の E4 の連打で 0.83 → 0.83 / 0.79）ため、判定に使わない
   */
  reattackOnset: number;
  /** これより短いノートは除く（秒） */
  minNoteSec: number;
  /**
   * 倍音の幻音を除くか。既定は使わない: コードの本物のオクターブ重ね（例: C コードの C3 と C4）も、
   * 強さ・鳴り始めの時刻・発音らしさでは幻音と区別できず、除いてしまうため。実際の録音で除かれる数と一覧を見てから決める
   */
  harmonicFilter: boolean;
  /** 倍音の幻音: 低い音との鳴り始めの差がこれ以内の音を調べる（秒） */
  harmonicOnsetSec: number;
  /** 倍音の幻音: 低い音からの音程（半音）。12 = オクターブ上、19 = オクターブと5度上 */
  harmonicIntervals: readonly number[];
  /** 倍音の幻音: 強さが低い音の強さのこの倍以下なら除く（1 = 同じ強さまで） */
  harmonicAmpRatio: number;
}

export const GUITAR_PRESET: TranscribePreset = {
  onsetThresh: 0.7,
  // 注意: 画面の「感度」は後処理の強さのしきい値（cleanup.ts の ampThreshold = 0.75 - 0.05 × 感度）。
  // ノートの強さはここで鳴っているとみなした部分の平均なので、ほぼ frameThresh 以上になる。
  // frameThresh 0.4 では、しきい値が 0.40 以下になる感度 7〜10 はどれも同じ結果になる（テスト音源で確認）
  frameThresh: 0.4,
  minNoteFrames: 9,
  inferOnsets: true,
  melodiaTrick: true,
  // ギターの再現範囲: E2（6弦開放, 82.4Hz）〜 E6（1弦24フレット, 1318.5Hz）
  minFreqHz: 82,
  maxFreqHz: 1319,

  // 同じ音高の再検出の統合は「安全網」として残す（0.7 で確定。2026-11-14、実録のギター音源 4分42秒で判断）。
  // - onsetThresh 0.7 で抽出しているため、発音らしさ 0.7 未満の続きの音はほとんど作られず、実録では統合 0 件だった
  // - 候補（同じ音高・100ms 以内）506 組の後の音は、発音らしさ 0.7〜0.8 が 295 組・0.8 以上が 211 組。
  //   どちらも鳴り始めの間隔が 0.15〜0.2秒・0.3〜0.4秒（16分・8分相当）に集まり、本物の弾き直しに見える。
  //   しきい値を上げる（0.8 で 295 組を統合）と、本物の弾き直しまで1つにまとめてしまうので上げない
  // - テスト音源の弾き直し（E4 の連打など）は、間隔 0ms・発音らしさ 0.88〜0.98
  mergeGapSec: 0.1,
  reattackOnset: 0.7,
  minNoteSec: 0.08,
  harmonicFilter: false,
  harmonicOnsetSec: 0.03,
  harmonicIntervals: [12, 19],
  harmonicAmpRatio: 1,
};

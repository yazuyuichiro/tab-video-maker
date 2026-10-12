/**
 * パターン文字:
 *  D = ダウンストローク, U = アップストローク
 *  d = ダウン(ブラッシング/ミュート), u = アップ(ブラッシング/ミュート)
 *  A = アルペジオ(ダウン), a = アルペジオ(アップ)
 *  . = 鳴らさない（直前の音を伸ばす）
 * アルペジオは arpOrder の弦順（0=ベース, 1..=ベースより上の弦を低い順）で1音ずつ鳴らす。
 */
export interface RhythmPreset {
  id: string;
  name: string;
  /** 1拍あたりの分割数 */
  div: number;
  pattern: string;
  arpOrder?: number[];
}

export const RHYTHM_PRESETS: RhythmPreset[] = [
  { id: 'q-down', name: '4分ダウン', div: 1, pattern: 'DDDD' },
  { id: '8-down', name: '8ビート（オールダウン）', div: 2, pattern: 'DDDDDDDD' },
  { id: '8-alt', name: '8ビート標準（ダウン/アップ）', div: 2, pattern: 'DUDUDUDU' },
  { id: '8-pop', name: '8ビート定番ストローク', div: 2, pattern: 'D.DU.UDU' },
  { id: '16-alt', name: '16ビート（オルタネイト）', div: 4, pattern: 'DUDUDUDUDUDUDUDU' },
  { id: '16-pop', name: '16ビート定番ストローク', div: 4, pattern: 'D..UD.DU.UDUD.DU' },
  { id: '16-cut', name: '16ビートカッティング', div: 4, pattern: 'DudUdUDudUdUDudU' },
  { id: 'shuffle', name: '3連シャッフル', div: 3, pattern: 'D.UD.UD.UD.U' },
  { id: 'arp-8', name: 'アルペジオ基本（8分）', div: 2, pattern: 'AAAAAAAA', arpOrder: [0, 1, 2, 3, 4, 3, 2, 1] },
  {
    id: 'arp-16',
    name: 'アルペジオ（16分）',
    div: 4,
    pattern: 'AaAaAaAaAaAaAaAa',
    arpOrder: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1],
  },
  {
    id: 'arp-3',
    name: 'アルペジオ（3連バラード）',
    div: 3,
    pattern: 'AAAAAAAAAAAA',
    arpOrder: [0, 2, 3, 4, 3, 2, 0, 2, 3, 4, 3, 2],
  },
];

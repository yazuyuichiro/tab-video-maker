export type StringNo = '1' | '2' | '3' | '4' | '5' | '6';
export const STRING_NOS: StringNo[] = ['1', '2', '3', '4', '5', '6'];

/** フレット値: 0〜24 / 'x'(ミュート) / null(なし) */
export type FretValue = number | 'x' | null;
export type Frets = Record<StringNo, FretValue>;

export type Picking = 'down' | 'up' | null;

export type Nuance = 'hammer' | 'pull' | 'choke' | 'hc' | 'slide' | 'mute' | 'tie' | 'slur' | null;

/** じゃらーんと弾く矢印: up = 低音弦→高音弦（矢印は1弦側）/ down = 高音弦→低音弦 */
export type Strum = 'up' | 'down' | null;

/** 4分音符あたりの tick 数（MIDI と同じ 480） */
export const TPQ = 480;

/**
 * 小節内の区間。beats 拍ぶんの長さを div 等分する。
 * 例: {beats:1, div:4} = 16分 / {beats:1, div:3} = 3連 / {beats:2, div:3} = 2拍3連（4分3連）
 */
export interface Segment {
  beats: number;
  div: number;
}

export interface Note {
  /** 小節頭からの位置（tick, 4分音符 = 480） */
  tick: number;
  picking: Picking;
  frets: Frets;
  nuance: Nuance;
  lyric: string | null;
  /** 小節途中でコードが変わる場合のコード名 */
  chord?: string | null;
  /** 休符（直前の音をここで止める） */
  rest?: boolean;
  /** じゃらーんと弾く矢印 */
  strum?: Strum;
}

export interface Measure {
  measureIndex: number;
  /** 拍ごとの分割（合計 beats = 拍子の分子） */
  segments: Segment[];
  chordName: string | null;
  notes: Note[];
  /** 最後に適用したコードフォーム（リズムプリセット適用時に使用） */
  chordShape?: Frets | null;
}

export type BackgroundColor = '#000000' | '#FFFFFF';

/** 動画サイズ（幅は1920固定） */
export type VideoHeight = 200 | 250 | 300;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHTS: VideoHeight[] = [250, 200, 300];
export const FPS = 60;

export interface Song {
  title: string;
  bpm: number;
  timeSignature: string;
  height: VideoHeight;
  backgroundColor: BackgroundColor;
  /** 1ページあたりの小節数 */
  measuresPerPage: number;
  measures: Measure[];
}

export const NUANCE_LABEL: Record<Exclude<Nuance, null>, string> = {
  hammer: 'h',
  pull: 'p',
  choke: 'c',
  hc: 'hc',
  slide: 's',
  mute: 'x',
  tie: 't',
  slur: 'sl',
};

export const NUANCE_NAME: Record<Exclude<Nuance, null>, string> = {
  hammer: 'ハンマリング',
  pull: 'プリング',
  choke: 'チョーキング',
  hc: 'ハンマリング+チョーキング',
  slide: 'スライド',
  mute: 'ミュート/ブラッシング',
  tie: 'タイ（前の音をつなげて弾き直さない）',
  slur: 'スラー',
};

/** 拍ごとの分割の選択肢 */
export const SEGMENT_OPTIONS: Segment[] = [
  { beats: 1, div: 1 },
  { beats: 1, div: 2 },
  { beats: 1, div: 3 },
  { beats: 1, div: 4 },
  { beats: 1, div: 5 },
  { beats: 1, div: 6 },
  { beats: 1, div: 8 },
  { beats: 2, div: 3 },
];

export const BACKGROUNDS: { value: BackgroundColor; label: string }[] = [
  { value: '#000000', label: '黒' },
  { value: '#FFFFFF', label: '白' },
];

/** 標準チューニングの開放弦の音高（MIDIノート番号） */
export const OPEN_PITCH: Record<StringNo, number> = { '1': 64, '2': 59, '3': 55, '4': 50, '5': 45, '6': 40 };

/** 選択中の弦（null = 全ての弦） */
export type StringSel = StringNo[] | null;

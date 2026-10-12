const SMALL_KANA = new Set('ぁぃぅぇぉゃゅょゎァィゥェォャュョヮヵヶ');

/** 歌詞スキップ用の記号（その音符には歌詞を付けない） */
export const SKIP_TOKEN = '_';

/**
 * 歌詞テキストを音符に割り当てる単位へ分割する。
 * 1文字ずつ（拗音「きゃ」などは1つにまとめ、英単語は1語）。空白は無視し、"_" は「この音符は飛ばす」。
 */
export function tokenizeLyrics(text: string): string[] {
  const chars = Array.from(text);
  const tokens: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (/[\s　]/.test(c)) {
      i++;
      continue;
    }
    if (/[A-Za-z0-9']/.test(c)) {
      let w = c;
      while (i + 1 < chars.length && /[A-Za-z0-9'’]/.test(chars[i + 1])) w += chars[++i];
      tokens.push(w);
      i++;
      continue;
    }
    if (SMALL_KANA.has(c) && tokens.length > 0 && tokens[tokens.length - 1] !== SKIP_TOKEN) {
      tokens[tokens.length - 1] += c;
      i++;
      continue;
    }
    tokens.push(c);
    i++;
  }
  return tokens;
}

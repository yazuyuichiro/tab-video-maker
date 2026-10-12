import { produce } from 'immer';
import type { Song } from '../types';
import { generateVoicings } from './chords';
import { tokenizeLyrics } from './lyrics';
import { RHYTHM_PRESETS } from './presets';
import {
  applyChordToMeasure,
  applyRhythmPreset,
  assignLyrics,
  createEmptySong,
} from './songOps';

/** 初回起動時に表示するサンプル曲 */
export function createDemoSong(): Song {
  const base = createEmptySong(8);
  return produce(base, (song) => {
    song.title = 'サンプル曲';
    song.bpm = 96;
    const chords = ['Am', 'G', 'F', 'E', 'Am', 'G', 'F', 'E7'];
    const presets = ['8-pop', '8-pop', '8-pop', '8-pop', 'arp-8', 'arp-8', '16-cut', 'q-down'];
    song.measures.forEach((m, i) => {
      const shape = generateVoicings(chords[i])[0]?.frets;
      if (!shape) return;
      applyChordToMeasure(m, shape, chords[i], song.timeSignature);
      const preset = RHYTHM_PRESETS.find((p) => p.id === presets[i])!;
      applyRhythmPreset(m, preset, song.timeSignature);
    });
    assignLyrics(
      song,
      0,
      0,
      tokenizeLyrics('かなしみのよる_ほしをみあげて__きみのなをよんだ'),
    );
  });
}

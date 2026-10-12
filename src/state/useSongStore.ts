import { produce } from 'immer';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Song } from '../types';
import { createEmptySong } from '../lib/songOps';
import { loadFromStorage, saveToStorage } from '../lib/storage';

const HISTORY_LIMIT = 200;

interface History {
  past: Song[];
  present: Song;
  future: Song[];
  /** 直前の更新キー（同じキーの連続更新は1つの履歴にまとめる） */
  lastKey: string | null;
}

export type SongRecipe = (draft: Song) => void;

export interface SongStore {
  song: Song;
  update: (recipe: SongRecipe, mergeKey?: string) => void;
  replace: (song: Song) => void;
  newSong: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useSongStore(): SongStore {
  const [h, setH] = useState<History>(() => ({
    past: [],
    present: loadFromStorage() ?? createEmptySong(),
    future: [],
    lastKey: null,
  }));

  const update = useCallback((recipe: SongRecipe, mergeKey?: string) => {
    setH((s) => {
      const next = produce(s.present, recipe);
      if (next === s.present) return s;
      const merge = mergeKey !== undefined && s.lastKey === mergeKey;
      return {
        past: merge ? s.past : [...s.past, s.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
        lastKey: mergeKey ?? null,
      };
    });
  }, []);

  const replace = useCallback((song: Song) => {
    setH((s) => ({
      past: [...s.past, s.present].slice(-HISTORY_LIMIT),
      present: song,
      future: [],
      lastKey: null,
    }));
  }, []);

  const newSong = useCallback(() => replace(createEmptySong()), [replace]);

  const undo = useCallback(() => {
    setH((s) => {
      if (!s.past.length) return s;
      return {
        past: s.past.slice(0, -1),
        present: s.past[s.past.length - 1],
        future: [s.present, ...s.future],
        lastKey: null,
      };
    });
  }, []);

  const redo = useCallback(() => {
    setH((s) => {
      if (!s.future.length) return s;
      return {
        past: [...s.past, s.present],
        present: s.future[0],
        future: s.future.slice(1),
        lastKey: null,
      };
    });
  }, []);

  // 自動保存（デバウンス）
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => saveToStorage(h.present), 400);
    return () => window.clearTimeout(timer.current);
  }, [h.present]);

  return {
    song: h.present,
    update,
    replace,
    newSong,
    undo,
    redo,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}

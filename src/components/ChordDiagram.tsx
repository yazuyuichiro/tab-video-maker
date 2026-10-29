import type { Frets, StringNo } from '../types';

const ORDER: StringNo[] = ['6', '5', '4', '3', '2', '1'];

/** 縦型コードダイアグラム（左が6弦） */
export function ChordDiagram({ frets, baseFret, size = 1 }: { frets: Frets; baseFret: number; size?: number }) {
  const w = 72 * size;
  const h = 88 * size;
  const left = 14 * size;
  const top = 18 * size;
  const gx = 10 * size;
  const gy = 13 * size;
  const rows = 5;
  const values = ORDER.map((s) => frets[s]);
  const fretted = values.filter((v): v is number => typeof v === 'number' && v > 0);
  // 押さえる位置が多いフレットがセーハ
  const minF = fretted.length ? Math.min(...fretted) : 0;
  const barreIdx = values
    .map((v, i) => (v === minF && minF > 0 ? i : -1))
    .filter((i) => i >= 0);
  const barre =
    barreIdx.length > 1 &&
    values.slice(barreIdx[0], barreIdx[barreIdx.length - 1] + 1).every((v) => typeof v === 'number' && v >= minF);

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      {baseFret === 1 ? (
        <rect x={left} y={top - 2 * size} width={gx * 5} height={3 * size} fill="currentColor" />
      ) : (
        <text x={left - 3 * size} y={top + gy / 2 + 3 * size} fontSize={9 * size} textAnchor="end" fill="currentColor">
          {baseFret}
        </text>
      )}
      {Array.from({ length: rows + 1 }, (_, r) => (
        <line
          key={`f${r}`}
          x1={left}
          x2={left + gx * 5}
          y1={top + r * gy}
          y2={top + r * gy}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={1}
        />
      ))}
      {ORDER.map((_, i) => (
        <line
          key={`s${i}`}
          x1={left + i * gx}
          x2={left + i * gx}
          y1={top}
          y2={top + rows * gy}
          stroke="currentColor"
          strokeOpacity={0.7}
          strokeWidth={1}
        />
      ))}
      {barre && (
        <rect
          x={left + barreIdx[0] * gx - 4 * size}
          y={top + (minF - baseFret) * gy + gy / 2 - 4 * size}
          width={(barreIdx[barreIdx.length - 1] - barreIdx[0]) * gx + 8 * size}
          height={8 * size}
          rx={4 * size}
          fill="#f2c230"
        />
      )}
      {values.map((v, i) => {
        const x = left + i * gx;
        if (v === null || v === 'x')
          return (
            <text key={i} x={x} y={top - 6 * size} fontSize={9 * size} textAnchor="middle" fill="#f87171">
              ×
            </text>
          );
        if (v === 0)
          return (
            <circle key={i} cx={x} cy={top - 8 * size} r={3 * size} fill="none" stroke="currentColor" strokeWidth={1.2} />
          );
        const row = v - baseFret;
        if (row < 0 || row >= rows) return null;
        if (barre && v === minF) return null;
        return <circle key={i} cx={x} cy={top + row * gy + gy / 2} r={4 * size} fill="#f2c230" />;
      })}
    </svg>
  );
}

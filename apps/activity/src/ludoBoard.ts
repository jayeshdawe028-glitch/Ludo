export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

export const START: Record<PlayerColor, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
export const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
export const FINISH = 56;

// 14x14 perimeter gives exactly 52 public track cells.
export const TRACK: Array<[number, number]> = [
  ...Array.from({ length: 14 }, (_, x) => [x, 0] as [number, number]),
  ...Array.from({ length: 13 }, (_, i) => [13, i + 1] as [number, number]),
  ...Array.from({ length: 13 }, (_, i) => [12 - i, 13] as [number, number]),
  ...Array.from({ length: 12 }, (_, i) => [0, 12 - i] as [number, number]),
];

export function canMove(position: number, roll: number): boolean {
  if (roll < 1 || roll > 6 || position === FINISH) return false;
  if (position === -1) return roll === 6;
  return position + roll <= FINISH;
}

export function advance(position: number, roll: number): number {
  if (!canMove(position, roll)) throw new Error('Illegal move');
  return position === -1 ? 0 : position + roll;
}

export function absoluteTrack(color: PlayerColor, position: number): number | null {
  if (position < 0 || position >= 52) return null;
  return (START[color] + position) % 52;
}

export function isSafeSquare(color: PlayerColor, position: number): boolean {
  const absolute = absoluteTrack(color, position);
  return absolute !== null && SAFE_SQUARES.has(absolute);
}

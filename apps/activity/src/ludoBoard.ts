export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';

// Compact classic-Ludo track model. Home is -1, track is 0..51,
// final lane is 52..56 and 57 means finished.
export const START: Record<PlayerColor, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
export const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export function canMove(position: number, roll: number): boolean {
  if (roll < 1 || roll > 6) return false;
  if (position === 57) return false;
  if (position === -1) return roll === 6;
  return position + roll <= 57;
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
  return absolute !== null && SAFE.has(absolute);
}

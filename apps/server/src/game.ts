export type Color = 'red' | 'blue' | 'green' | 'yellow';

export interface PlayerState {
  id: string;
  username: string;
  color: Color;
  connected: boolean;
  isSpectator: boolean;
  pieces: number[];
  finished: number;
}

export interface RoomState {
  roomId: string;
  mode: 'channel' | 'world';
  players: PlayerState[];
  currentTurn: string | null;
  status: 'waiting' | 'playing' | 'finished';
  winnerId: string | null;
  dice: number | null;
}

export const COLORS: Color[] = ['red', 'green', 'yellow', 'blue'];

export function createRoom(roomId: string, mode: RoomState['mode']): RoomState {
  return { roomId, mode, players: [], currentTurn: null, status: 'waiting', winnerId: null, dice: null };
}

export function addPlayer(room: RoomState, id: string, username: string, spectator = false): PlayerState {
  const player: PlayerState = {
    id, username,
    color: COLORS[Math.min(room.players.length, COLORS.length - 1)],
    connected: true,
    isSpectator: spectator,
    pieces: [-1, -1, -1, -1],
    finished: 0
  };
  room.players.push(player);
  if (!spectator && !room.currentTurn) room.currentTurn = id;
  if (room.players.filter(p => !p.isSpectator).length >= 2) room.status = 'playing';
  return player;
}

export function rollDice(room: RoomState, playerId: string): number {
  if (room.status !== 'playing' || room.currentTurn !== playerId) throw new Error('Not your turn');
  const value = 1 + Math.floor(Math.random() * 6);
  room.dice = value;
  return value;
}

export function movePiece(room: RoomState, playerId: string, pieceIndex: number): void {
  if (room.status !== 'playing' || room.currentTurn !== playerId) throw new Error('Not your turn');
  if (pieceIndex < 0 || pieceIndex > 3) throw new Error('Invalid piece');
  const player = room.players.find(p => p.id === playerId);
  if (!player) throw new Error('Player not found');
  const roll = room.dice;
  if (!roll) throw new Error('Roll first');
  const current = player.pieces[pieceIndex];
  if (current === -1 && roll !== 6) throw new Error('Need a six to leave home');
  player.pieces[pieceIndex] = current === -1 ? 0 : current + roll;
  if (player.pieces[pieceIndex] >= 57) {
    player.pieces[pieceIndex] = 57;
    player.finished = player.pieces.filter(p => p === 57).length;
  }
  const activePlayers = room.players.filter(p => !p.isSpectator);
  const nextIndex = Math.max(0, activePlayers.findIndex(p => p.id === playerId));
  const nextPlayer = activePlayers[(nextIndex + 1) % activePlayers.length];
  room.currentTurn = nextPlayer?.id ?? null;
  room.dice = null;
}

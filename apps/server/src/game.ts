export type Color = 'red' | 'green' | 'yellow' | 'blue';

export interface PlayerState {
  id: string;
  username: string;
  color: Color;
  connected: boolean;
  isSpectator: boolean;
  pieces: number[]; // -1 home, 0..55 track progress, 56 finished
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
  validMoves: number[];
  lastRollBy: string | null;
  lastMove: { playerId: string; pieceIndex: number; captured: boolean } | null;
}

export const COLORS: Color[] = ['red', 'green', 'yellow', 'blue'];
export const MAX_PLAYERS = 4;
export const PIECES_PER_PLAYER = 4;
export const FINISH = 56;

// Each player's first track square. The public board track is 52 squares.
export const START: Record<Color, number> = { red: 0, green: 13, yellow: 26, blue: 39 };
export const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export function createRoom(roomId: string, mode: RoomState['mode']): RoomState {
  return {
    roomId, mode, players: [], currentTurn: null, status: 'waiting', winnerId: null,
    dice: null, validMoves: [], lastRollBy: null, lastMove: null
  };
}

export function addPlayer(room: RoomState, id: string, username: string, spectator = false): PlayerState {
  const existing = room.players.find(p => p.id === id);
  if (existing) { existing.connected = true; existing.username = username; return existing; }
  const activeCount = room.players.filter(p => !p.isSpectator).length;
  const isSpectator = spectator || activeCount >= MAX_PLAYERS;
  const player: PlayerState = {
    id, username, color: COLORS[Math.min(activeCount, COLORS.length - 1)], connected: true,
    isSpectator, pieces: Array(PIECES_PER_PLAYER).fill(-1), finished: 0
  };
  room.players.push(player);
  if (!isSpectator && !room.currentTurn) room.currentTurn = id;
  if (room.players.filter(p => !p.isSpectator).length >= 2) room.status = 'playing';
  return player;
}

export function activePlayers(room: RoomState) { return room.players.filter(p => !p.isSpectator); }

function player(room: RoomState, id: string) {
  const p = room.players.find(x => x.id === id);
  if (!p) throw new Error('Player not found');
  if (p.isSpectator) throw new Error('Spectators cannot play');
  return p;
}

export function canMovePiece(position: number, roll: number) {
  if (roll < 1 || roll > 6 || position === FINISH) return false;
  if (position === -1) return roll === 6;
  return position + roll <= FINISH;
}

export function legalMoves(room: RoomState, playerId: string): number[] {
  const p = player(room, playerId);
  if (room.dice === null || room.currentTurn !== playerId) return [];
  return p.pieces.map((pos, i) => canMovePiece(pos, room.dice!) ? i : -1).filter(i => i >= 0);
}

export function rollDice(room: RoomState, playerId: string): number {
  player(room, playerId);
  if (room.status !== 'playing' || room.currentTurn !== playerId) throw new Error('Not your turn');
  if (room.dice !== null) throw new Error('Move the rolled piece first');
  const value = 1 + Math.floor(Math.random() * 6);
  room.dice = value;
  room.lastRollBy = playerId;
  room.validMoves = legalMoves(room, playerId);
  // No legal move: automatically pass, except a six is still an extra-roll opportunity.
  if (room.validMoves.length === 0) {
    room.dice = null;
    room.validMoves = [];
    if (value !== 6) nextTurn(room, playerId);
  }
  return value;
}

function absoluteSquare(color: Color, progress: number) {
  return (START[color] + progress) % 52;
}

function nextTurn(room: RoomState, playerId: string) {
  const players = activePlayers(room);
  if (!players.length) { room.currentTurn = null; return; }
  const index = Math.max(0, players.findIndex(p => p.id === playerId));
  room.currentTurn = players[(index + 1) % players.length].id;
}

export function movePiece(room: RoomState, playerId: string, pieceIndex: number): { captured: boolean } {
  const p = player(room, playerId);
  if (room.status !== 'playing' || room.currentTurn !== playerId) throw new Error('Not your turn');
  if (pieceIndex < 0 || pieceIndex >= PIECES_PER_PLAYER) throw new Error('Invalid piece');
  if (room.dice === null) throw new Error('Roll first');
  if (!room.validMoves.includes(pieceIndex)) throw new Error('That piece cannot move');

  const roll = room.dice;
  const old = p.pieces[pieceIndex];
  const next = old === -1 ? 0 : old + roll;
  p.pieces[pieceIndex] = next;
  p.finished = p.pieces.filter(x => x === FINISH).length;

  let captured = false;
  if (next < FINISH) {
    const landing = absoluteSquare(p.color, next);
    if (!SAFE_SQUARES.has(landing)) {
      for (const opponent of activePlayers(room)) {
        if (opponent.id === p.id) continue;
        for (let i = 0; i < opponent.pieces.length; i++) {
          const op = opponent.pieces[i];
          if (op >= 0 && op < FINISH && absoluteSquare(opponent.color, op) === landing) {
            opponent.pieces[i] = -1;
            opponent.finished = opponent.pieces.filter(x => x === FINISH).length;
            captured = true;
          }
        }
      }
    }
  }

  room.dice = null;
  room.validMoves = [];
  room.lastMove = { playerId, pieceIndex, captured };

  if (p.finished === PIECES_PER_PLAYER) {
    room.status = 'finished';
    room.winnerId = playerId;
    room.currentTurn = null;
    return { captured };
  }

  // Standard Ludo: six, or a capture, grants another turn.
  if (roll === 6 || captured) room.currentTurn = playerId;
  else nextTurn(room, playerId);
  return { captured };
}

export function disconnectPlayer(room: RoomState, id: string) {
  const p = room.players.find(x => x.id === id);
  if (p) p.connected = false;
}

import { describe, expect, it } from 'vitest';
import { addPlayer, canMovePiece, createRoom, legalMoves, movePiece, rollDice, FINISH } from './game.js';

describe('LudoCord game engine', () => {
  it('starts waiting and becomes playable at two players', () => {
    const room = createRoom('x', 'world');
    addPlayer(room, 'a', 'A');
    expect(room.status).toBe('waiting');
    addPlayer(room, 'b', 'B');
    expect(room.status).toBe('playing');
    expect(room.currentTurn).toBe('a');
  });

  it('puts the fifth player into spectator mode', () => {
    const room = createRoom('x', 'channel');
    for (let i = 1; i <= 4; i++) addPlayer(room, String(i), `P${i}`);
    const fifth = addPlayer(room, '5', 'P5');
    expect(fifth.isSpectator).toBe(true);
    expect(room.players.filter(p => !p.isSpectator)).toHaveLength(4);
  });

  it('only the current player can roll and a roll exposes legal pieces', () => {
    const room = createRoom('x', 'world');
    addPlayer(room, 'a', 'A'); addPlayer(room, 'b', 'B');
    expect(() => rollDice(room, 'b')).toThrow('Not your turn');
    const value = rollDice(room, 'a');
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(6);
    if (value === 6) expect(legalMoves(room, 'a')).toEqual([0, 1, 2, 3]);
    else expect(legalMoves(room, 'a')).toEqual([]);
  });

  it('requires six to leave home', () => {
    expect(canMovePiece(-1, 5)).toBe(false);
    expect(canMovePiece(-1, 6)).toBe(true);
  });

  it('allows an exact finish but never overshoots', () => {
    expect(canMovePiece(55, 1)).toBe(true);
    expect(canMovePiece(55, 2)).toBe(false);
    expect(canMovePiece(FINISH, 1)).toBe(false);
  });

  it('keeps the rolled state authoritative until a move is made', () => {
    const room = createRoom('x', 'world');
    addPlayer(room, 'a', 'A'); addPlayer(room, 'b', 'B');
    // Mock Math.random so the first roll is six.
    const oldRandom = Math.random;
    Math.random = () => 0.999999;
    try {
      expect(rollDice(room, 'a')).toBe(6);
      expect(room.dice).toBe(6);
      expect(room.validMoves).toEqual([0, 1, 2, 3]);
      movePiece(room, 'a', 0);
      expect(room.players[0].pieces[0]).toBe(0);
      expect(room.currentTurn).toBe('a');
      expect(room.dice).toBeNull();
    } finally { Math.random = oldRandom; }
  });
});

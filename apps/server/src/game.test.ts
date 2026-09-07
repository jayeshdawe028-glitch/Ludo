import { describe, expect, it } from 'vitest';
import { addPlayer, createRoom, rollDice, movePiece } from './game.js';

describe('LudoCord game state', () => {
  it('starts in waiting state and becomes playable at two players', () => {
    const room = createRoom('x', 'world');
    addPlayer(room, 'a', 'A');
    expect(room.status).toBe('waiting');
    addPlayer(room, 'b', 'B');
    expect(room.status).toBe('playing');
    expect(room.currentTurn).toBe('a');
  });

  it('puts player five into spectator mode', () => {
    const room = createRoom('x', 'channel');
    for (let i = 1; i <= 4; i++) addPlayer(room, String(i), `P${i}`);
    const fifth = addPlayer(room, '5', 'P5');
    expect(fifth.isSpectator).toBe(true);
    expect(room.players.filter(p => !p.isSpectator)).toHaveLength(4);
  });

  it('only current player can roll', () => {
    const room = createRoom('x', 'world');
    addPlayer(room, 'a', 'A'); addPlayer(room, 'b', 'B');
    expect(() => rollDice(room, 'b')).toThrow('Not your turn');
    expect(rollDice(room, 'a')).toBeGreaterThanOrEqual(1);
  });

  it('requires six to leave home', () => {
    const room = createRoom('x', 'world');
    addPlayer(room, 'a', 'A'); addPlayer(room, 'b', 'B');
    let value = rollDice(room, 'a');
    if (value !== 6) expect(() => movePiece(room, 'a', 0)).toThrow('Need a six');
  });
});

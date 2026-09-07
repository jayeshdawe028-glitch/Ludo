import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { Server } from 'socket.io';
import {
  addPlayer, createRoom, disconnectPlayer, movePiece, rollDice,
  activePlayers, MAX_PLAYERS, type RoomState
} from './game.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ['GET', 'POST'] } });

const db = new Database(process.env.DB_PATH ?? './ludocord.db');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS players (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);

const rooms = new Map<string, RoomState>();
const worldRooms = new Set<string>();
const socketRooms = new Map<string, string>();
const roomFinishRecorded = new Set<string>();

function upsertPlayer(discordId: string, username: string) {
  db.prepare(`INSERT INTO players (discord_id, username) VALUES (?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET username=excluded.username, updated_at=CURRENT_TIMESTAMP`).run(discordId, username);
}

function stats(discordId: string) {
  return db.prepare(`SELECT discord_id as discordId, username,
    games_played as gamesPlayed, wins, losses FROM players WHERE discord_id=?`).get(discordId)
    ?? { discordId, username: 'Unknown', gamesPlayed: 0, wins: 0, losses: 0 };
}

function finishRoom(room: RoomState, winnerId: string) {
  if (roomFinishRecorded.has(room.roomId)) return;
  roomFinishRecorded.add(room.roomId);
  room.status = 'finished';
  room.winnerId = winnerId;
  const update = db.prepare(`UPDATE players SET games_played=games_played+1,
    wins=wins+?, losses=losses+?, updated_at=CURRENT_TIMESTAMP WHERE discord_id=?`);
  const transaction = db.transaction(() => {
    for (const p of activePlayers(room)) update.run(p.id === winnerId ? 1 : 0, p.id === winnerId ? 0 : 1, p.id);
  });
  transaction();
}

function emitRoom(room: RoomState) { io.to(room.roomId).emit('room_state', room); }

function findWorldRoom() {
  for (const roomId of worldRooms) {
    const room = rooms.get(roomId);
    if (room && room.status !== 'finished' && activePlayers(room).length < MAX_PLAYERS) return room;
    worldRooms.delete(roomId);
  }
  return undefined;
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'ludocord-server', rooms: rooms.size }));
app.get('/api/stats/:discordId', (req, res) => res.json(stats(req.params.discordId)));

// Discord Embedded App SDK authorize() returns a short-lived authorization code.
// Exchange it server-side so the Discord client secret never reaches the Activity.
app.post('/api/token', async (req, res) => {
  const { code } = req.body as { code?: string };
  const clientId = process.env.DISCORD_CLIENT_ID ?? process.env.DISCORD_APPLICATION_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!code || !clientId || !clientSecret) return res.status(400).json({ error: 'Discord OAuth is not configured' });
  try {
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code });
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body
    });
    const data = await response.json() as { access_token?: string; token_type?: string; expires_in?: number; error?: string };
    if (!response.ok || !data.access_token) return res.status(401).json({ error: data.error ?? 'Discord token exchange failed' });
    res.json(data);
  } catch { res.status(502).json({ error: 'Discord token service unavailable' }); }
});

io.on('connection', socket => {
  socket.on('join_world', ({ discordId, username }: { discordId: string; username: string }) => {
    if (!discordId || !username) return socket.emit('game_error', { message: 'Discord identity is required' });
    upsertPlayer(discordId, username);
    let room = findWorldRoom();
    if (!room) {
      const roomId = `world-${crypto.randomUUID()}`;
      room = createRoom(roomId, 'world');
      rooms.set(roomId, room);
      worldRooms.add(roomId);
    }
    const player = addPlayer(room, discordId, username, activePlayers(room).length >= MAX_PLAYERS);
    socket.join(room.roomId);
    socketRooms.set(socket.id, room.roomId);
    socket.emit('room_joined', { room, playerId: player.id });
    emitRoom(room);
    socket.emit('matchmaking', { waiting: room.status === 'waiting' });
  });

  socket.on('join_channel', ({ roomId, discordId, username }: { roomId: string; discordId: string; username: string }) => {
    if (!roomId || !discordId || !username) return socket.emit('game_error', { message: 'Channel and Discord identity are required' });
    upsertPlayer(discordId, username);
    let room = rooms.get(roomId);
    if (!room) { room = createRoom(roomId, 'channel'); rooms.set(roomId, room); }
    const spectator = activePlayers(room).length >= MAX_PLAYERS;
    const player = addPlayer(room, discordId, username, spectator);
    socket.join(roomId);
    socketRooms.set(socket.id, roomId);
    socket.emit('room_joined', { room, playerId: player.id });
    emitRoom(room);
  });

  socket.on('roll', ({ roomId, discordId }: { roomId: string; discordId: string }) => {
    try {
      const room = rooms.get(roomId); if (!room) throw new Error('Room not found');
      const value = rollDice(room, discordId);
      io.to(roomId).emit('dice_rolled', { by: discordId, value, validMoves: room.validMoves });
      emitRoom(room);
    } catch (e) { socket.emit('game_error', { message: e instanceof Error ? e.message : 'Unable to roll' }); }
  });

  socket.on('move', ({ roomId, discordId, pieceIndex }: { roomId: string; discordId: string; pieceIndex: number }) => {
    try {
      const room = rooms.get(roomId); if (!room) throw new Error('Room not found');
      const result = movePiece(room, discordId, pieceIndex);
      if (room.status === 'finished' && room.winnerId) finishRoom(room, room.winnerId);
      io.to(roomId).emit('piece_moved', { by: discordId, pieceIndex, captured: result.captured });
      emitRoom(room);
    } catch (e) { socket.emit('game_error', { message: e instanceof Error ? e.message : 'Unable to move' }); }
  });

  socket.on('leave_room', () => {
    const roomId = socketRooms.get(socket.id);
    if (!roomId) return;
    socket.leave(roomId); socketRooms.delete(socket.id);
    const room = rooms.get(roomId); if (!room) return;
    // Keep player state for reconnects; mark disconnected rather than deleting stats/game state.
    const joined = room.players.find(p => p.id === socket.data.discordId);
    if (joined) joined.connected = false;
    emitRoom(room);
  });

  socket.on('identify', ({ discordId }: { discordId: string }) => { socket.data.discordId = discordId; });

  socket.on('disconnect', () => {
    const roomId = socketRooms.get(socket.id);
    if (!roomId) return;
    socketRooms.delete(socket.id);
    const room = rooms.get(roomId);
    if (room) {
      const id = socket.data.discordId;
      if (id) disconnectPlayer(room, id);
      emitRoom(room);
    }
  });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`LudoCord server listening on ${port}`));

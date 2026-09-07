import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { Server } from 'socket.io';
import Database from 'better-sqlite3';
import { addPlayer, createRoom, movePiece, rollDice, type RoomState } from './game.js';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ['GET', 'POST'] } });

const db = new Database(process.env.DB_PATH ?? './ludocord.db');
db.exec(`CREATE TABLE IF NOT EXISTS players (discord_id TEXT PRIMARY KEY, username TEXT NOT NULL, games_played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0)`);

const rooms = new Map<string, RoomState>();
const waitingWorld = new Set<string>();

function upsertPlayer(discordId: string, username: string) {
  db.prepare(`INSERT INTO players (discord_id, username) VALUES (?, ?) ON CONFLICT(discord_id) DO UPDATE SET username=excluded.username`).run(discordId, username);
}
function stats(discordId: string) {
  return db.prepare('SELECT discord_id as discordId, username, games_played as gamesPlayed, wins, losses FROM players WHERE discord_id=?').get(discordId) ?? { discordId, username: 'Unknown', gamesPlayed: 0, wins: 0, losses: 0 };
}
function finishRoom(room: RoomState, winnerId: string) {
  room.status = 'finished'; room.winnerId = winnerId;
  for (const p of room.players.filter(p => !p.isSpectator)) {
    db.prepare('UPDATE players SET games_played=games_played+1, wins=wins+? , losses=losses+? WHERE discord_id=?').run(p.id === winnerId ? 1 : 0, p.id === winnerId ? 0 : 1, p.id);
  }
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'ludocord-server' }));
app.get('/api/stats/:discordId', (req, res) => res.json(stats(req.params.discordId)));

io.on('connection', socket => {
  socket.on('join_world', ({ discordId, username }: { discordId: string; username: string }) => {
    upsertPlayer(discordId, username);
    let roomId = [...waitingWorld][0];
    if (!roomId) {
      roomId = `world-${crypto.randomUUID()}`;
      rooms.set(roomId, createRoom(roomId, 'world'));
      waitingWorld.add(roomId);
    }
    const room = rooms.get(roomId)!;
    const player = addPlayer(room, discordId, username, room.players.filter(p => !p.isSpectator).length >= 4);
    socket.join(roomId);
    if (room.players.filter(p => !p.isSpectator).length >= 2) waitingWorld.delete(roomId);
    socket.emit('room_joined', { room, playerId: player.id });
    io.to(roomId).emit('room_state', room);
    socket.emit('matchmaking', { waiting: room.players.filter(p => !p.isSpectator).length < 2 });
  });

  socket.on('join_channel', ({ roomId, discordId, username }: { roomId: string; discordId: string; username: string }) => {
    upsertPlayer(discordId, username);
    let room = rooms.get(roomId);
    if (!room) { room = createRoom(roomId, 'channel'); rooms.set(roomId, room); }
    const spectator = room.players.filter(p => !p.isSpectator).length >= 4;
    const player = addPlayer(room, discordId, username, spectator);
    socket.join(roomId); socket.emit('room_joined', { room, playerId: player.id }); io.to(roomId).emit('room_state', room);
  });

  socket.on('roll', ({ roomId, discordId }) => {
    try { const room = rooms.get(roomId); if (!room) throw new Error('Room not found'); const value = rollDice(room, discordId); io.to(roomId).emit('dice_rolled', { by: discordId, value }); io.to(roomId).emit('room_state', room); }
    catch (e) { socket.emit('game_error', { message: e instanceof Error ? e.message : 'Unable to roll' }); }
  });

  socket.on('move', ({ roomId, discordId, pieceIndex }) => {
    try { const room = rooms.get(roomId); if (!room) throw new Error('Room not found'); movePiece(room, discordId, pieceIndex); const p = room.players.find(x => x.id === discordId); if (p?.finished === 4) finishRoom(room, discordId); io.to(roomId).emit('room_state', room); }
    catch (e) { socket.emit('game_error', { message: e instanceof Error ? e.message : 'Unable to move' }); }
  });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`LudoCord server listening on ${port}`));

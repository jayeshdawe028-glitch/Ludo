import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Server } from 'socket.io';
import { addPlayer, createRoom, disconnectPlayer, movePiece, rollDice, activePlayers, MAX_PLAYERS, type RoomState } from './game.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ['GET', 'POST'] } });

const db = new Database(process.env.DB_PATH ?? './ludocord.db');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.exec(`CREATE TABLE IF NOT EXISTS players (discord_id TEXT PRIMARY KEY, username TEXT NOT NULL, games_played INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

const rooms = new Map<string, RoomState>();
const worldRooms = new Set<string>();
const socketRooms = new Map<string, string>();
const roomFinishRecorded = new Set<string>();
const ROOM_IDLE_MS = 30 * 60 * 1000;
const FINISHED_ROOM_TTL_MS = 5 * 60 * 1000;
const roomLastActivity = new Map<string, number>();

function touchRoom(room: RoomState) { roomLastActivity.set(room.roomId, Date.now()); }
function upsertPlayer(discordId: string, username: string) { db.prepare(`INSERT INTO players (discord_id, username) VALUES (?, ?) ON CONFLICT(discord_id) DO UPDATE SET username=excluded.username, updated_at=CURRENT_TIMESTAMP`).run(discordId, username); }
function stats(discordId: string) { return db.prepare(`SELECT discord_id as discordId, username, games_played as gamesPlayed, wins, losses FROM players WHERE discord_id=?`).get(discordId) ?? { discordId, username: 'Unknown', gamesPlayed: 0, wins: 0, losses: 0 }; }
function finishRoom(room: RoomState, winnerId: string) {
  if(roomFinishRecorded.has(room.roomId))return;
  roomFinishRecorded.add(room.roomId);room.status='finished';room.winnerId=winnerId;
  const update=db.prepare(`UPDATE players SET games_played=games_played+1,wins=wins+?,losses=losses+?,updated_at=CURRENT_TIMESTAMP WHERE discord_id=?`);
  db.transaction(()=>{for(const p of activePlayers(room))update.run(p.id===winnerId?1:0,p.id===winnerId?0:1,p.id)})();
  touchRoom(room);
}
function emitRoom(room:RoomState){touchRoom(room);io.to(room.roomId).emit('room_state',room)}
function findWorldRoom(){for(const roomId of worldRooms){const room=rooms.get(roomId);if(room&&room.status!=='finished'&&activePlayers(room).length<MAX_PLAYERS)return room;worldRooms.delete(roomId)}return undefined}
function cleanupRooms() {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    const lastActivity = roomLastActivity.get(roomId) ?? now;
    const connected = room.players.filter(p => p.connected).length;
    const expired = room.status === 'finished' ? now - lastActivity > FINISHED_ROOM_TTL_MS : connected === 0 && now - lastActivity > ROOM_IDLE_MS;
    if (!expired) continue;
    rooms.delete(roomId);
    worldRooms.delete(roomId);
    roomLastActivity.delete(roomId);
    roomFinishRecorded.delete(roomId);
  }
}
const cleanupTimer = setInterval(cleanupRooms, 60_000);
cleanupTimer.unref();

app.get('/health',(_req,res)=>res.json({ok:true,service:'ludocord-server',rooms:rooms.size}));
app.get('/api/stats/:discordId',(req,res)=>res.json(stats(req.params.discordId)));

// Serve the Activity build from the same tiny Oracle process in production.
const activityDist=path.resolve(process.cwd(),'apps/activity/dist');
app.use(express.static(activityDist));
app.get('/',(_req,res)=>res.sendFile(path.join(activityDist,'index.html')));

app.post('/api/token',async(req,res)=>{
  const {code}=req.body as {code?:string};
  const clientId=process.env.DISCORD_CLIENT_ID??process.env.DISCORD_APPLICATION_ID;
  const clientSecret=process.env.DISCORD_CLIENT_SECRET;
  if(!code||!clientId||!clientSecret)return res.status(400).json({error:'Discord OAuth is not configured'});
  try{
    const body=new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'authorization_code',code});
    const response=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    const data=await response.json() as {access_token?:string;token_type?:string;expires_in?:number;error?:string};
    if(!response.ok||!data.access_token)return res.status(401).json({error:data.error??'Discord token exchange failed'});
    res.json(data);
  }catch{res.status(502).json({error:'Discord token service unavailable'})}
});

io.on('connection',socket=>{
  socket.on('identify',({discordId}:{discordId:string})=>{socket.data.discordId=discordId});
  socket.on('join_world',({discordId,username}:{discordId:string;username:string})=>{
    if(!discordId||!username)return socket.emit('game_error',{message:'Discord identity is required'});
    upsertPlayer(discordId,username);let room=findWorldRoom();
    if(!room){const roomId=`world-${crypto.randomUUID()}`;room=createRoom(roomId,'world');rooms.set(roomId,room);worldRooms.add(roomId);touchRoom(room)}
    const player=addPlayer(room,discordId,username,activePlayers(room).length>=MAX_PLAYERS);socket.join(room.roomId);socketRooms.set(socket.id,room.roomId);
    socket.emit('room_joined',{room,playerId:player.id});emitRoom(room);socket.emit('matchmaking',{waiting:room.status==='waiting'});
  });
  socket.on('join_channel',({roomId,discordId,username}:{roomId:string;discordId:string;username:string})=>{
    if(!roomId||!discordId||!username)return socket.emit('game_error',{message:'Channel and Discord identity are required'});
    upsertPlayer(discordId,username);let room=rooms.get(roomId);if(!room){room=createRoom(roomId,'channel');rooms.set(roomId,room);touchRoom(room)}
    if(room.status==='finished')return socket.emit('game_error',{message:'This game has ended. Start a new Activity to play again.'});
    const player=addPlayer(room,discordId,username,activePlayers(room).length>=MAX_PLAYERS);socket.join(roomId);socketRooms.set(socket.id,roomId);
    socket.emit('room_joined',{room,playerId:player.id});emitRoom(room);
  });
  socket.on('roll',({roomId,discordId}:{roomId:string;discordId:string})=>{try{const room=rooms.get(roomId);if(!room)throw new Error('Room not found');const value=rollDice(room,discordId);io.to(roomId).emit('dice_rolled',{by:discordId,value,validMoves:room.validMoves});emitRoom(room)}catch(e){socket.emit('game_error',{message:e instanceof Error?e.message:'Unable to roll'})}});
  socket.on('move',({roomId,discordId,pieceIndex}:{roomId:string;discordId:string;pieceIndex:number})=>{try{const room=rooms.get(roomId);if(!room)throw new Error('Room not found');const result=movePiece(room,discordId,pieceIndex);if(room.status==='finished'&&room.winnerId)finishRoom(room,room.winnerId);io.to(roomId).emit('piece_moved',{by:discordId,pieceIndex,captured:result.captured});emitRoom(room)}catch(e){socket.emit('game_error',{message:e instanceof Error?e.message:'Unable to move'})}});
  socket.on('leave_room',()=>{const roomId=socketRooms.get(socket.id);if(!roomId)return;socket.leave(roomId);socketRooms.delete(socket.id);const room=rooms.get(roomId);if(!room)return;const joined=room.players.find(p=>p.id===socket.data.discordId);if(joined)joined.connected=false;emitRoom(room)});
  socket.on('disconnect',()=>{const roomId=socketRooms.get(socket.id);if(!roomId)return;socketRooms.delete(socket.id);const room=rooms.get(roomId);if(room&&socket.data.discordId){disconnectPlayer(room,socket.data.discordId);emitRoom(room)}});
});

const port=Number(process.env.PORT??3000);server.listen(port,()=>console.log(`LudoCord server listening on ${port}`));

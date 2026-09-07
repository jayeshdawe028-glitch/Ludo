import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { io, Socket } from 'socket.io-client';
import './styles.css';

const sdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID ?? 'YOUR_APPLICATION_ID');
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const COLORS = ['red','green','yellow','blue'];

type Player = { id:string; username:string; color:string; isSpectator:boolean; pieces:number[]; finished:number };
type Room = { roomId:string; mode:'channel'|'world'; players:Player[]; currentTurn:string|null; status:'waiting'|'playing'|'finished'; winnerId:string|null; dice:number|null };

function App(){
 const [ready,setReady]=useState(false); const [menu,setMenu]=useState(false); const [music,setMusic]=useState(true); const [sound,setSound]=useState(true);
 const [discord,setDiscord]=useState<{id:string;username:string}>({id:'demo-user',username:'Discord Player'}); const [stats,setStats]=useState({gamesPlayed:0,wins:0,losses:0});
 const [room,setRoom]=useState<Room|null>(null); const [socket,setSocket]=useState<Socket|null>(null); const [error,setError]=useState(''); const [mode,setMode]=useState<'home'|'matchmaking'|'game'>('home');
 useEffect(()=>{ (async()=>{ try { await sdk.ready(); const a:any=await sdk.commands.authorize({client_id:import.meta.env.VITE_DISCORD_CLIENT_ID ?? 'YOUR_APPLICATION_ID',response_type:'code',scope:['identify'],prompt:'none',}); setDiscord({id:a?.user?.id??'demo-user',username:a?.user?.global_name??a?.user?.username??'Discord Player'}); setReady(true); } catch { setReady(true); } })(); },[]);
 useEffect(()=>{ fetch(`${SERVER}/api/stats/${discord.id}`).then(r=>r.json()).then(setStats).catch(()=>{}); },[discord.id]);
 const connect=()=>{ const s=io(SERVER); s.on('room_joined',({room:r}:any)=>{setRoom(r);setMode('game')}); s.on('room_state',(r:Room)=>setRoom(r)); s.on('game_error',(e:any)=>setError(e.message)); setSocket(s); return s; };
 const playWorld=()=>{setError(''); setMode('matchmaking'); const s=connect(); s.emit('join_world',{discordId:discord.id,username:discord.username});};
 const playChannel=()=>{setError(''); const roomId = (window as any).__DISCORD_VOICE_CHANNEL_ID ?? `channel-${discord.id}`; setMode('game'); const s=connect(); s.emit('join_channel',{roomId,discordId:discord.id,username:discord.username});};
 const leave=()=>{socket?.disconnect();setSocket(null);setRoom(null);setMode('home');};
 return <div className="app"><div className="loading-overlay">{!ready?'LudoCord':''}</div><header><div className="brand">LudoCord</div><div className="header-stats"><span>🎮 {stats.gamesPlayed}</span><span>🏆 {stats.wins}</span><span>💔 {stats.losses}</span><strong>{discord.username}</strong></div><button className="hamburger" onClick={()=>setMenu(v=>!v)}>☰</button></header>
 {menu&&<div className="menu"><label>Music <input type="checkbox" checked={music} onChange={e=>setMusic(e.target.checked)}/></label><label>Sound Effects <input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/></label><button onClick={()=>window.open('https://ko-fi.com/alwaysjake28','_blank')}>☕ Donate</button></div>}
 {mode==='home'&&<main className="home"><div className="logo-mark">🎲<span>LudoCord</span></div><p>Play Ludo with the people around you — or meet players from anywhere.</p><div className="actions"><button onClick={playChannel}>Play with Channel Friends</button><button onClick={playWorld}>Play with Random World</button></div></main>}
 {mode==='matchmaking'&&<main className="center"><div className="spinner"/><h2>Matchmaking</h2><p>Waiting for players...</p></main>}
 {mode==='game'&&room&&<Game room={room} playerId={discord.id} socket={socket} sound={sound} onLeave={leave}/>} {error&&<div className="toast">{error}</div>}
 </div>
}

function Game({room,playerId,socket,sound,onLeave}:{room:Room;playerId:string;socket:Socket|null;sound:boolean;onLeave:()=>void}){ const me=room.players.find(p=>p.id===playerId); const active=room.players.filter(p=>!p.isSpectator); return <main className="game"><div className="player-strip">{active.map(p=><div key={p.id} className={`player ${p.color} ${p.id===room.currentTurn?'turn':''}`}>{p.username}<small>{p.finished}/4</small></div>)}</div><div className="board"><div className="quadrant red"><TokenGrid player={me} pieceIndices={[0,1,2,3]}/></div><div className="quadrant green"/><div className="quadrant yellow"/><div className="quadrant blue"/><div className="center-home">{room.dice??'🎲'}</div></div><div className="controls"><button disabled={room.currentTurn!==playerId||room.status!=='playing'} onClick={()=>socket?.emit('roll',{roomId:room.roomId,discordId:playerId})}>ROLL DICE</button><div className="pieces">{me?.pieces.map((pos,i)=><button key={i} disabled={room.currentTurn!==playerId||room.dice===null||me.isSpectator} onClick={()=>socket?.emit('move',{roomId:room.roomId,discordId:playerId,pieceIndex:i})}>● {pos===-1?'HOME':pos}</button>)}</div><button onClick={onLeave}>Leave</button></div>{room.players.some(p=>p.isSpectator&&p.id===playerId)&&<div className="spectator">👀 Spectator mode — game is full</div>}</main> }
function TokenGrid({player,pieceIndices}:{player?:Player;pieceIndices:number[]}){return <div className="token-grid">{pieceIndices.map(i=><div key={i} className="token">{player?.pieces[i]===-1?'●':player?.pieces[i]}</div>)}</div>}
createRoot(document.getElementById('root')!).render(<App/>);

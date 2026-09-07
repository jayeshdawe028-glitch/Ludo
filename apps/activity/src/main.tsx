import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { io, Socket } from 'socket.io-client';
import { TRACK, SAFE_SQUARES, absoluteTrack, type PlayerColor } from './ludoBoard';
import './styles.css';

const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID ?? '';
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const sdk = new DiscordSDK(clientId || 'YOUR_APPLICATION_ID');

type Player = { id:string; username:string; color:PlayerColor; connected:boolean; isSpectator:boolean; pieces:number[]; finished:number };
type Room = { roomId:string; mode:'channel'|'world'; players:Player[]; currentTurn:string|null; status:'waiting'|'playing'|'finished'; winnerId:string|null; dice:number|null; validMoves:number[]; lastRollBy:string|null; lastMove:{playerId:string;pieceIndex:number;captured:boolean}|null };
type User = { id:string; username:string; global_name?:string|null };

function App(){
  const [ready,setReady]=useState(false);
  const [authError,setAuthError]=useState('');
  const [menu,setMenu]=useState(false);
  const [music,setMusic]=useState(true);
  const [sound,setSound]=useState(true);
  const [discord,setDiscord]=useState<User>({id:'',username:'Discord Player'});
  const [stats,setStats]=useState({gamesPlayed:0,wins:0,losses:0});
  const [room,setRoom]=useState<Room|null>(null);
  const [socket,setSocket]=useState<Socket|null>(null);
  const [error,setError]=useState('');
  const [mode,setMode]=useState<'home'|'matchmaking'|'game'>('home');
  const audio=useRef<AudioEngine|null>(null);

  useEffect(()=>{
    audio.current=new AudioEngine();
    (async()=>{
      try {
        await sdk.ready();
        if (!clientId) throw new Error('VITE_DISCORD_CLIENT_ID is missing');
        const auth:any=await sdk.commands.authorize({client_id:clientId,response_type:'code',scope:['identify'],prompt:'none'});
        if (!auth?.code) throw new Error('Discord authorization code was not returned');
        const tokenResponse=await fetch(`${SERVER}/api/token`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:auth.code})});
        if (!tokenResponse.ok) throw new Error('Discord sign-in failed on the game server');
        const token=await tokenResponse.json();
        const result:any=await sdk.commands.authenticate({access_token:token.access_token});
        const user:User=result?.user;
        if (!user?.id) throw new Error('Discord user identity was not returned');
        setDiscord(user);
        setReady(true);
      } catch(e) {
        setAuthError(e instanceof Error?e.message:'Unable to connect to Discord');
        setReady(true);
      }
    })();
    return ()=>audio.current?.destroy();
  },[]);

  useEffect(()=>{
    if(!discord.id) return;
    fetch(`${SERVER}/api/stats/${encodeURIComponent(discord.id)}`).then(r=>r.ok?r.json():null).then(s=>s&&setStats(s)).catch(()=>{});
  },[discord.id]);

  const playSound=(type:'click'|'dice'|'move'|'win')=>{ if(sound) audio.current?.effect(type); };
  const beginAudio=()=>{ audio.current?.setMusic(music); audio.current?.resume(); };

  const connect=(onConnected?:()=>void)=>{
    if(!discord.id) return null;
    const s=io(SERVER,{transports:['websocket','polling'],reconnection:true});
    s.on('connect',()=>{s.emit('identify',{discordId:discord.id});onConnected?.();});
    s.on('room_joined',({room:r}:any)=>{setRoom(r);setMode('game');});
    s.on('room_state',(r:Room)=>setRoom({...r,players:[...r.players]}));
    s.on('dice_rolled',()=>playSound('dice'));
    s.on('piece_moved',(e:any)=>{playSound('move');if(e?.captured)playSound('click');});
    s.on('game_error',(e:any)=>{setError(e?.message??'Something went wrong');setTimeout(()=>setError(''),3200);});
    s.on('connect_error',()=>setError('Game server connection failed. Please try again.'));
    setSocket(s); return s;
  };

  const playWorld=()=>{
    beginAudio();playSound('click');setError('');setMode('matchmaking');
    const s=connect(()=>s?.emit('join_world',{discordId:discord.id,username:displayName(discord)}));
    if(!s)setMode('home');
  };
  const playChannel=()=>{
    beginAudio();playSound('click');setError('');
    const roomId=(sdk as any).instanceId??`channel-${discord.id}`;
    const s=connect(()=>s?.emit('join_channel',{roomId,discordId:discord.id,username:displayName(discord)}));
    if(!s)setMode('home');
  };
  const leave=()=>{socket?.emit('leave_room');socket?.disconnect();setSocket(null);setRoom(null);setMode('home');};

  return <div className="app">
    <div className={`loading-overlay ${ready?'done':''}`}><div className="splash-die">🎲</div><div>LudoCord</div></div>
    <header>
      <div className="brand"><span className="brand-dot"/>LudoCord</div>
      <div className="header-stats">
        <span title="Games played">🎮 {stats.gamesPlayed}</span><span title="Wins">🏆 {stats.wins}</span><span title="Losses">💔 {stats.losses}</span><strong>{displayName(discord)}</strong>
      </div>
      <button className="hamburger" aria-label="Open menu" onClick={()=>setMenu(v=>!v)}>☰</button>
    </header>
    {menu&&<div className="menu" onMouseLeave={()=>setMenu(false)}>
      <div className="menu-title">Settings</div>
      <label>Music <input type="checkbox" checked={music} onChange={e=>{setMusic(e.target.checked);audio.current?.setMusic(e.target.checked)}}/></label>
      <label>Sound Effects <input type="checkbox" checked={sound} onChange={e=>setSound(e.target.checked)}/></label>
      <button onClick={()=>window.open('https://ko-fi.com/alwaysjake28','_blank','noopener,noreferrer')}>☕ Donate</button>
    </div>}

    {mode==='home'&&<main className="home">
      <div className="hero-logo"><div className="logo-die">🎲</div><div><span>Ludo</span><b>Cord</b></div></div>
      <p>Classic Ludo, right inside your Discord call.</p>
      {authError?<div className="auth-card"><b>Discord connection needed</b><span>{authError}</span><small>Configure the Activity Client ID and server OAuth settings, then reload.</small></div>:<div className="actions">
        <button className="primary" onClick={playChannel}><span>👥</span><div><b>Play with Channel Friends</b><small>Join people in this Activity</small></div></button>
        <button onClick={playWorld}><span>🌎</span><div><b>Play with Random World</b><small>Find players anywhere</small></div></button>
      </div>}
      <div className="home-note">2–4 players · spectators welcome · lightweight multiplayer</div>
    </main>}

    {mode==='matchmaking'&&<main className="center"><div className="match-orbit"><div>🎲</div></div><h2>Finding players</h2><p>Waiting for another LudoCord player...</p><button className="ghost" onClick={leave}>Cancel</button></main>}
    {mode==='game'&&room&&<Game room={room} playerId={discord.id} socket={socket} sound={sound} onLeave={leave} onWin={()=>{playSound('win');fetch(`${SERVER}/api/stats/${encodeURIComponent(discord.id)}`).then(r=>r.json()).then(setStats).catch(()=>{})}}/>}
    {error&&<div className="toast">{error}</div>}
  </div>;
}

function displayName(u:User){return u.global_name||u.username||'Discord Player';}

function Game({room,playerId,socket,sound,onLeave,onWin}:{room:Room;playerId:string;socket:Socket|null;sound:boolean;onLeave:()=>void;onWin:()=>void}){
  const me=room.players.find(p=>p.id===playerId);
  const active=room.players.filter(p=>!p.isSpectator);
  const spectators=room.players.filter(p=>p.isSpectator);
  const winner=room.winnerId?room.players.find(p=>p.id===room.winnerId):null;
  useEffect(()=>{if(room.status==='finished'&&room.winnerId===playerId)onWin()},[room.status,room.winnerId,playerId,onWin]);
  const pathTokens=useMemo(()=>{
    const out:Array<{p:Player;piece:number;key:string}>=[];
    for(const p of active) p.pieces.forEach((pos,i)=>{if(pos>=0&&pos<56)out.push({p,piece:i,key:`${p.id}-${i}`})});
    return out;
  },[active]);
  const roll=()=>socket?.emit('roll',{roomId:room.roomId,discordId:playerId});
  const move=(i:number)=>socket?.emit('move',{roomId:room.roomId,discordId:playerId,pieceIndex:i});
  const myTurn=room.currentTurn===playerId&&room.status==='playing';

  return <main className="game">
    <div className="gamebar"><div><span className="eyebrow">{room.mode==='world'?'RANDOM WORLD':'CHANNEL GAME'}</span><h1>{room.status==='finished'?'Game over':room.status==='waiting'?'Waiting for players':'Ludo board'}</h1></div><div className="gamebar-right"><span className="players-count">{active.length}/4 players</span><button className="ghost" onClick={onLeave}>Leave</button></div></div>
    <div className="players-row">{active.map(p=><div key={p.id} className={`player-chip ${p.color} ${p.id===room.currentTurn?'turn':''}`}><i/>{p.username}{p.id===playerId?' (You)':''}<em>{p.finished}/4</em></div>)}</div>
    <div className="board-wrap">
      <div className="board">
        <div className="home-zone red-zone"><HomeZone color="red" player={active.find(p=>p.color==='red')} positions={active.find(p=>p.color==='red')?.pieces??[]} valid={myTurn&&room.dice!==null}/></div>
        <div className="home-zone green-zone"><HomeZone color="green" player={active.find(p=>p.color==='green')} positions={active.find(p=>p.color==='green')?.pieces??[]} valid={myTurn&&room.dice!==null}/></div>
        <div className="home-zone yellow-zone"><HomeZone color="yellow" player={active.find(p=>p.color==='yellow')} positions={active.find(p=>p.color==='yellow')?.pieces??[]} valid={myTurn&&room.dice!==null}/></div>
        <div className="home-zone blue-zone"><HomeZone color="blue" player={active.find(p=>p.color==='blue')} positions={active.find(p=>p.color==='blue')?.pieces??[]} valid={myTurn&&room.dice!==null}/></div>
        <div className="track">{TRACK.map(([x,y],i)=><div key={i} className={`track-cell ${SAFE_SQUARES.has(i)?'safe':''} ${Object.values(active).some(p=>absoluteTrack(p.color,p.pieces.find(pos=>pos>=0&&pos<56)??-1)===i)?'occupied':''}`} style={{gridColumn:x+1,gridRow:y+1}}><span>{SAFE_SQUARES.has(i)?'★':''}</span></div>)}
          {pathTokens.map(t=>{const pos=absoluteTrack(t.p.color,t.p.pieces[t.piece]);if(pos===null)return null;const [x,y]=TRACK[pos];return <button key={t.key} aria-label={`${t.p.username} token ${t.piece+1}`} className={`board-token ${t.p.color}`} style={{left:`calc(${(x+.5)/14*100}% - 16px)`,top:`calc(${(y+.5)/14*100}% - 16px)`}} onClick={()=>t.p.id===playerId&&room.validMoves.includes(t.piece)&&move(t.piece)}>{t.piece+1}</button>})}
        </div>
        <div className="center-diamond"><span>🎲</span><b>{room.dice??'LUDO'}</b></div>
      </div>
    </div>
    <div className="turn-panel">
      {winner?<><div className="winner">🏆 {winner.username} wins!</div><button onClick={onLeave}>Back to lobby</button></>:room.status==='waiting'?<div className="waiting-inline"><span className="mini-spinner"/>Waiting for one more player…</div>:me?.isSpectator?<div className="spectator">👀 Spectator mode · The room is full</div>:<>
        <div className="turn-message">{myTurn?<><b>Your turn</b>{room.dice===null?' · Roll the dice':' · Choose a highlighted token'}</>:<><b>{active.find(p=>p.id===room.currentTurn)?.username??'Player'}'s turn</b> · Watch the board</>}</div>
        <div className="dice-controls"><button className={`dice-button ${myTurn&&room.dice===null?'ready':''}`} disabled={!myTurn||room.dice!==null} onClick={roll}><span>🎲</span>{room.dice??'ROLL'}</button><div className="token-buttons">{me?.pieces.map((pos,i)=><button key={i} disabled={!myTurn||room.dice===null||!room.validMoves.includes(i)} className={room.validMoves.includes(i)?'can-move':''} onClick={()=>move(i)}>{pos===-1?'HOME':pos===56?'✓':pos}</button>)}</div></div>
      </>}
    </div>
    {spectators.length>0&&<div className="spectator-list">👁 {spectators.length} spectator{spectators.length>1?'s':''}</div>}
  </main>;
}

function HomeZone({color,player,positions,valid}:{color:PlayerColor;player?:Player;positions:number[];valid:boolean}){return <div className="zone-inner"><div className="zone-label">{player?.username??color}</div><div className="home-tokens">{[0,1,2,3].map(i=><div key={i} className={`home-token ${color} ${valid&&positions[i]===-1?'selectable':''}`}>{positions[i]===-1?'':positions[i]===56?'✓':positions[i]}</div>)}</div></div>}

class AudioEngine{
  ctx:AudioContext|null=null; timer:number|undefined; musicOn=false;
  resume(){this.ctx??=new AudioContext();if(this.ctx.state==='suspended')this.ctx.resume();}
  setMusic(on:boolean){this.musicOn=on;if(on)this.startMusic();else this.stopMusic();}
  startMusic(){if(this.timer||!this.musicOn)return;this.resume();const notes=[196,247,294,247];let n=0;const tick=()=>{if(!this.musicOn)return;const c=this.ctx!;const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=notes[n++%notes.length];g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(.018,c.currentTime+.05);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.55);o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+.6);this.timer=window.setTimeout(tick,620)};tick()}
  stopMusic(){if(this.timer){clearTimeout(this.timer);this.timer=undefined}}
  effect(type:'click'|'dice'|'move'|'win'){this.resume();const c=this.ctx!;const o=c.createOscillator(),g=c.createGain();const f=type==='dice'?520:type==='win'?880:type==='move'?420:260;o.frequency.value=f;o.type=type==='win'?'triangle':'sine';g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(.05,c.currentTime+.01);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+(type==='win'?.35:.09));o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+.4)}
  destroy(){this.stopMusic();this.ctx?.close()}
}

createRoot(document.getElementById('root')!).render(<App/>);

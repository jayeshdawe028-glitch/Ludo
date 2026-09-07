import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { io, Socket } from 'socket.io-client';
import './styles.css';

const sdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID ?? 'YOUR_APPLICATION_ID');
const SERVER = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';
type Player = { id: string; username: string; color: PlayerColor; isSpectator: boolean; pieces: number[]; finished: number };
type Room = { roomId: string; mode: 'channel' | 'world'; players: Player[]; currentTurn: string | null; status: 'waiting' | 'playing' | 'finished'; winnerId: string | null; dice: number | null };

type Stats = { gamesPlayed: number; wins: number; losses: number };

function App() {
  const [ready, setReady] = useState(false);
  const [menu, setMenu] = useState(false);
  const [music, setMusic] = useState(true);
  const [sound, setSound] = useState(true);
  const [discord, setDiscord] = useState({ id: 'demo-user', username: 'Discord Player' });
  const [stats, setStats] = useState<Stats>({ gamesPlayed: 0, wins: 0, losses: 0 });
  const [room, setRoom] = useState<Room | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'home' | 'matchmaking' | 'game'>('home');

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await sdk.ready();
        const auth: any = await sdk.commands.authorize({
          client_id: import.meta.env.VITE_DISCORD_CLIENT_ID ?? 'YOUR_APPLICATION_ID',
          response_type: 'code',
          scope: ['identify'],
          prompt: 'none',
        });
        if (mounted) {
          setDiscord({ id: auth?.user?.id ?? 'demo-user', username: auth?.user?.global_name ?? auth?.user?.username ?? 'Discord Player' });
          setReady(true);
        }
      } catch {
        if (mounted) setReady(true);
      }
    })();
    return () => { mounted = false; socketRef.current?.disconnect(); };
  }, []);

  useEffect(() => {
    fetch(`${SERVER}/api/stats/${discord.id}`).then(r => r.ok ? r.json() : null).then(data => data && setStats(data)).catch(() => {});
  }, [discord.id]);

  const connect = () => {
    socketRef.current?.disconnect();
    const s = io(SERVER, { transports: ['websocket', 'polling'] });
    s.on('room_joined', ({ room: nextRoom }: { room: Room }) => { setRoom(nextRoom); setView(nextRoom.status === 'playing' ? 'game' : 'game'); });
    s.on('room_state', (nextRoom: Room) => setRoom(nextRoom));
    s.on('game_error', (e: { message?: string }) => setError(e.message ?? 'Something went wrong'));
    s.on('matchmaking', () => setView('matchmaking'));
    s.on('game_finished', () => fetch(`${SERVER}/api/stats/${discord.id}`).then(r => r.json()).then(setStats).catch(() => {}));
    socketRef.current = s;
    return s;
  };

  const playWorld = () => {
    setError('');
    setView('matchmaking');
    const s = connect();
    s.emit('join_world', { discordId: discord.id, username: discord.username });
  };

  const playChannel = () => {
    setError('');
    const roomId = (window as any).__DISCORD_VOICE_CHANNEL_ID ?? `channel-${discord.id}`;
    const s = connect();
    s.emit('join_channel', { roomId, discordId: discord.id, username: discord.username });
  };

  const leave = () => {
    socketRef.current?.emit('leave_room');
    socketRef.current?.disconnect();
    socketRef.current = null;
    setRoom(null);
    setView('home');
  };

  return (
    <div className="app">
      {!ready && <div className="loading-overlay"><div className="loading-logo"><div className="loading-dice">🎲</div><div>LudoCord</div></div></div>}
      <header>
        <div className="brand"><span className="brand-dot" />LudoCord</div>
        <div className="header-stats">
          <span title="Games played">🎮 {stats.gamesPlayed}</span>
          <span title="Wins">🏆 {stats.wins}</span>
          <span title="Losses">💔 {stats.losses}</span>
          <strong>{discord.username}</strong>
        </div>
        <button className="hamburger" aria-label="Open menu" onClick={() => setMenu(v => !v)}>☰</button>
      </header>
      {menu && <div className="menu">
        <div className="menu-title">Settings</div>
        <label>Music <input type="checkbox" checked={music} onChange={e => setMusic(e.target.checked)} /></label>
        <label>Sound Effects <input type="checkbox" checked={sound} onChange={e => setSound(e.target.checked)} /></label>
        <button className="donate" onClick={() => window.open('https://ko-fi.com/alwaysjake28', '_blank', 'noopener,noreferrer')}>☕ Donate</button>
      </div>}
      {view === 'home' && <Home onChannel={playChannel} onWorld={playWorld} />}
      {view === 'matchmaking' && <main className="center"><div className="spinner" /><h2>Matchmaking</h2><p>Waiting for players...</p><small>You can stay here while another player joins from anywhere.</small></main>}
      {view === 'game' && room && <Game room={room} playerId={discord.id} socket={socketRef.current} onLeave={leave} sound={sound} />}
      {error && <div className="toast" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
    </div>
  );
}

function Home({ onChannel, onWorld }: { onChannel: () => void; onWorld: () => void }) {
  return <main className="home">
    <div className="hero-badge">DISCORD ACTIVITY</div>
    <div className="logo-mark"><div className="logo-dice">🎲</div><span>LudoCord</span></div>
    <p>Roll. Move. Capture. Win.</p>
    <div className="actions">
      <button className="primary" onClick={onChannel}><span>👥</span><div><b>Play with Channel Friends</b><small>Play with people in this VC</small></div></button>
      <button className="secondary" onClick={onWorld}><span>🌎</span><div><b>Play with Random World</b><small>Find a player anywhere</small></div></button>
    </div>
  </main>;
}

function Game({ room, playerId, socket, onLeave }: { room: Room; playerId: string; socket: Socket | null; sound: boolean; onLeave: () => void }) {
  const active = room.players.filter(p => !p.isSpectator);
  const spectators = room.players.filter(p => p.isSpectator);
  const me = room.players.find(p => p.id === playerId);
  const canRoll = room.currentTurn === playerId && room.status === 'playing';
  const canMove = canRoll && room.dice !== null && !me?.isSpectator;

  return <main className="game">
    <div className="game-topline"><span>{room.status === 'playing' ? 'YOUR MATCH' : 'WAITING FOR PLAYERS'}</span><span>{active.length}/4 players {spectators.length ? `· ${spectators.length} watching` : ''}</span></div>
    <div className="player-strip">{room.players.map(p => <div key={p.id} className={`player-card ${p.color} ${p.id === room.currentTurn ? 'turn' : ''} ${p.isSpectator ? 'spectator-card' : ''}`}><span className="avatar">{p.username.slice(0, 1).toUpperCase()}</span><div><b>{p.username}</b><small>{p.isSpectator ? 'Spectator' : `${p.finished}/4 home`}</small></div></div>)}</div>
    <LudoBoard players={room.players} />
    <div className="game-controls">
      <button className="roll" disabled={!canRoll} onClick={() => socket?.emit('roll', { roomId: room.roomId, discordId: playerId })}>🎲 ROLL {room.dice ? `· ${room.dice}` : ''}</button>
      <div className="pieces">{me?.pieces.map((pos, i) => <button key={i} disabled={!canMove} onClick={() => socket?.emit('move', { roomId: room.roomId, discordId: playerId, pieceIndex: i })}><span className="mini-token">●</span>{pos < 0 ? 'HOME' : pos === 57 ? 'DONE' : pos}</button>)}</div>
      <button className="leave" onClick={onLeave}>Leave</button>
    </div>
    {room.status === 'playing' && room.currentTurn === playerId && <div className="turn-hint">Your turn — roll the dice.</div>}
    {me?.isSpectator && <div className="spectator-banner">👀 Game is full. You are watching this match.</div>}
  </main>;
}

function LudoBoard({ players }: { players: Player[] }) {
  const byColor = useMemo(() => Object.fromEntries(players.map(p => [p.color, p])) as Partial<Record<PlayerColor, Player>>, [players]);
  const quadrants: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];
  return <div className="board-shell"><div className="board">
    {quadrants.map(color => <div key={color} className={`quadrant ${color}`}><div className="base-title">{byColor[color]?.username ?? color.toUpperCase()}</div><div className="home-tokens">{[0,1,2,3].map(i => <div key={i} className="home-token">{byColor[color]?.pieces[i] === -1 ? '●' : byColor[color]?.pieces[i] === 57 ? '✓' : '●'}</div>)}</div></div>)}
    <div className="track-center"><div className="track-grid">{Array.from({length: 25}, (_, i) => <div key={i} className={`track-cell ${i % 6 === 0 ? 'safe' : ''}`}>{i % 5 === 0 ? '•' : ''}</div>)}</div><div className="win-mark">★</div></div>
  </div></div>;
}

createRoot(document.getElementById('root')!).render(<App />);

# LudoCord

A lightweight 2–4 player Ludo Discord Activity with global matchmaking, spectators, lifetime stats and slash commands. The Activity uses Discord's Embedded App SDK; the server owns the authoritative game state so clients cannot decide illegal moves.

## What is implemented

- Discord OAuth authorize → server token exchange → SDK authenticate
- Discord display name in the UI; no separate username account system
- Classic Ludo core: 4 tokens, six-to-leave-home, exact finish, captures, safe squares, extra turn on six/capture and win detection
- Server-authoritative dice and move validation
- Socket.IO live synchronization
- Channel game rooms scoped to the Discord Activity instance
- Global Random World matchmaking, 2–4 active players
- Players beyond four become spectators
- Disconnect state is retained for reconnects
- SQLite lifetime stats: games played, wins and losses
- `/flex`, `/help`, `/check @user`, `/invite`, `/community`
- Loading splash, responsive board, turn UI, token selection, music toggle, SFX toggle and Ko-fi donate link
- Lightweight procedural audio: no music/VFX asset downloads are required
- Production Docker + Caddy HTTPS setup for a small Oracle VM
- GitHub Actions CI for server tests and Activity/server builds

## Commands

- `/flex` — your lifetime stats
- `/help` — all LudoCord commands
- `/check @user` — another player's lifetime stats
- `/invite` — bot invite URL
- `/community` — community URL

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

For the Activity, create `apps/activity/.env` from `apps/activity/.env.example` and set the Discord application ID plus the local server URL. The server needs `DISCORD_CLIENT_SECRET` for the OAuth code exchange.

## Production on Oracle

The repository includes `Dockerfile`, `docker-compose.yml` and `deploy/Caddyfile`.

1. Create an Oracle VM and point a domain/subdomain at its public IP.
2. Open TCP `80` and `443` in the Oracle Cloud security list/NSG and the VM firewall.
3. Copy `.env.example` to `.env` on the VM.
4. Set `PUBLIC_DOMAIN`, `PUBLIC_URL`, `DISCORD_APPLICATION_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `BOT_INVITE_URL` and `COMMUNITY_URL`.
5. Run `docker compose up -d --build`.
6. Caddy obtains the HTTPS certificate automatically.
7. In Discord Developer Portal, configure the Activity's URL to `PUBLIC_URL`, configure OAuth scopes/redirects as required by the Embedded App SDK, and enable the Activity for development/testing.

The same Node container serves the built Activity and Socket.IO/API server. A separate lightweight container runs the slash-command bot. SQLite is stored in a persistent Docker volume.

## Manual items still required before a real Discord launch

- Discord Application ID and Client Secret in the server environment
- Discord Bot Token in the bot environment
- Final public domain/HTTPS URL
- Bot invite URL and community invite URL
- Discord Developer Portal Activity configuration and development-team access
- Oracle VM creation, DNS and ports 80/443
- One real Discord test with two accounts, then four accounts, then a fifth spectator

## Known game-rule scope

The core board/rules are implemented server-side, but this is intentionally a lightweight Ludo implementation rather than a clone of every regional Ludo ruleset. Block/stack-specific variants and cosmetic animations can be added later without changing the networking architecture.

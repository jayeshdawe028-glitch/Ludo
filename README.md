# Aarohi — Discord AI Companion

Aarohi is a lightweight, text-only Discord AI companion. The character specification stays inside this repository, while the AI provider is configurable through environment variables.

## Behavior

Default trigger: Aarohi replies when a user mentions her or replies to one of her messages.

`/primarychat #channel` makes that channel a free-chat channel where ordinary messages trigger Aarohi. Other channels keep the default mention/reply behavior.

`/setonechatchannel #channel` enables single-channel mode. Only that channel triggers Aarohi, without mentions.

`/ignorechat #channel` completely silences Aarohi in that channel. Ignore rules have priority over every other channel mode.

Aarohi does not have normal Discord DM conversations and redirects users to a server channel.

## Commands

Public:
- `/invite` — Aarohi invite link
- `/donate` — donation page
- `/help` — community server link
- `/vote` — Top.gg voting link when configured
- `/reset` — delete your temporary conversation memory

Admin/owner/developer:
- `/primarychat #channel`
- `/ignorechat #channel`
- `/setonechatchannel #channel`

## Temporary memory

Conversation context is isolated per Discord user and automatically expires after about 4 hours of inactivity. Only the most recent context window is kept. `/reset` deletes the user's current session immediately.

The SQLite database stores only short-lived session context, guild channel settings, and rate-limit state. It is mounted at `/data/aarohi.sqlite3` in production.

## AI provider

The provider is selected without changing Aarohi's character code:

```env
AI_PROVIDER=groq
AI_API_KEY=your_key
AI_MODEL=your_model
```

Supported providers in the current adapter:
- `groq`
- `gemini`

Switching provider only requires changing the environment values. Do not put API keys in GitHub.

## Required environment

Copy `.env.example` to `.env` on the server and fill:

```env
DISCORD_APPLICATION_ID=
DISCORD_BOT_TOKEN=
AI_PROVIDER=groq
AI_API_KEY=
AI_MODEL=openai/gpt-oss-20b
PORT=3000
```

The included defaults also contain the community, donation, developer ID, memory, and rate-limit settings.

## Discord setup

Enable the **Message Content Intent** for Aarohi in the Discord Developer Portal. The bot also needs permission to view channels, read message history, and send messages where it should chat.

## Oracle deployment

The project is designed for the existing lightweight Oracle VM + host Caddy setup. Docker Compose exposes Aarohi only on `127.0.0.1:3000`, so the host Caddy service can continue to terminate HTTPS and proxy the public domain to port 3000.

From the repository directory on Oracle:

```bash
cp .env.example .env
# edit .env once with your real credentials
./deploy/oracle-deploy.sh
```

For later updates:

```bash
./deploy/oracle-deploy.sh
```

The container has a healthcheck at `/health` and automatically restarts unless manually stopped.

## Development

```bash
npm --prefix apps/bot install
npm --prefix apps/bot run dev
```

Build:

```bash
npm --prefix apps/bot run build
```

Run:

```bash
npm --prefix apps/bot start
```

## Links

Community: https://discord.gg/syCAe6zxhW
Donation: https://ko-fi.com/alwaysjake28
Instagram: https://www.instagram.com/im_aarohi_ai

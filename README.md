# Aarohi — Discord AI Character

Aarohi is a casual Hindi/Hinglish Discord AI companion built around a fictional character profile, short-lived conversation memory, configurable channel controls, and provider-agnostic AI APIs.

> **Current project:** Discord bot first. The old Ludo Activity code has been removed from the active project.

## Character
Aarohi is a fictional 22-year-old Indian girl from Udaipur, Rajasthan. The complete character bible lives in `apps/bot/src/ai/prompts/character.md` so the personality does not depend on the AI provider.

The uploaded character specification is preserved in the codebase, including language style, family lore, food/music preferences, DM policy, Instagram, developer recognition, and the four-hour temporary memory rule.

## Memory
Conversation context is temporary and user-isolated. The default maximum context lifetime is **4 hours**. Old conversation context is not used after expiry and is cleaned up automatically. The bot does not maintain a permanent per-user message archive for personalization.

## Channel controls
Admin/owner-only configuration commands:

- `/Primarychat #channel` — restrict Aarohi's automatic conversational replies to the selected channel.
- `/Ignorechat #channel` — completely ignore the selected channel, including mentions.
- `/setonechatchannel #channel` — server-wide restriction: Aarohi only responds in this one channel and ignores tags elsewhere.

`/Primarychat` and `/setonechatchannel` are server-scoped settings. `/Ignorechat` stores an ignore list so multiple channels can be muted if needed.

Aarohi can otherwise read/respond to normal server messages where Discord permissions and the configured chat policy allow it. To receive ordinary messages, enable Discord's **Message Content Intent** in the Developer Portal.

## Public commands

- `/invite` — bot invite link
- `/donate` — Ko-fi donation link
- `/help` — community server link
- `/vote` — reserved for a future Top.gg voting link

## Links

Community server: https://discord.gg/syCAe6zxhW

Donation: https://ko-fi.com/alwaysjake28

Aarohi Instagram: https://www.instagram.com/im_aarohi_ai

Developer (Jake): Discord user ID `993147236668149801`

## AI provider architecture
The AI provider is replaceable without moving character rules into the provider itself:

```env
AI_PROVIDER=groq
AI_API_KEY=your_key
AI_MODEL=your_model
```

Provider adapters live under `apps/bot/src/ai/providers/`. The character prompt, channel policy, memory handling, and Discord behavior remain in our codebase.

## Environment
Copy `.env.example` to `.env` on the Oracle VM and fill in the real values. Secrets are intentionally excluded from Git.

## Local development

```bash
npm install
npm run build
npm start
```

## Docker / Oracle

```bash
docker compose up -d --build
```

The existing Oracle/Caddy setup can continue to proxy the app's health endpoint through port 3000. The bot itself only needs outbound access to Discord and the configured AI provider.

## Character source
The full source-of-truth character specification is maintained at:

`apps/bot/src/ai/prompts/character.md`

It is based on the provided `Aarohi_README-1.md` specification, including the four-hour memory requirement.

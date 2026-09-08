import "dotenv/config";
import express from "express";
import Database from "better-sqlite3";
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type TextBasedChannel,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID ?? "";
const AI_PROVIDER = (process.env.AI_PROVIDER ?? "groq").toLowerCase();
const AI_API_KEY = process.env.AI_API_KEY ?? "";
const AI_MODEL = process.env.AI_MODEL ?? "openai/gpt-oss-20b";
const COMMUNITY_URL = process.env.COMMUNITY_URL ?? "";
const DONATION_URL = process.env.DONATION_URL ?? "";
const VOTE_URL = process.env.VOTE_URL ?? "";
const INVITE_URL = process.env.INVITE_URL ?? "";
const DEV_USER_ID = process.env.DEV_USER_ID ?? "993147236668149801";
const MEMORY_TTL_HOURS = Number(process.env.MEMORY_TTL_HOURS ?? 4);
const MAX_CONTEXT_MESSAGES = Number(process.env.MAX_CONTEXT_MESSAGES ?? 30);
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 10);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 45000);

if (!DISCORD_BOT_TOKEN || !DISCORD_APPLICATION_ID) {
  throw new Error("DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID are required.");
}
if (!AI_API_KEY) {
  throw new Error("AI_API_KEY is required.");
}

const app = express();
app.get("/health", (_req, res) => res.json({ ok: true, provider: AI_PROVIDER, model: AI_MODEL }));
app.get("/", (_req, res) => res.type("text/plain").send("Aarohi is online."));
app.listen(PORT, "0.0.0.0", () => console.log(`HTTP server listening on :${PORT}`));

fs.mkdirSync("/data", { recursive: true });
const db = new Database("/data/aarohi.sqlite3");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    user_id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    primary_channel_id TEXT,
    one_chat_channel_id TEXT,
    ignored_channel_ids TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS rate_limits (
    user_id TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL
  );
`);

const promptPath = path.resolve(process.cwd(), "apps/bot/src/ai/prompts/character.md");
const distPromptPath = path.resolve(process.cwd(), "apps/bot/dist/ai/prompts/character.md");
const characterPrompt = fs.readFileSync(fs.existsSync(promptPath) ? promptPath : distPromptPath, "utf8");

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type SessionData = { messages: ChatMessage[] };

function nowMs() {
  return Date.now();
}

function getSession(userId: string): SessionData {
  const row = db.prepare("SELECT data, expires_at FROM sessions WHERE user_id = ?").get(userId) as
    | { data: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at <= nowMs()) {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    return { messages: [] };
  }
  try {
    return JSON.parse(row.data) as SessionData;
  } catch {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    return { messages: [] };
  }
}

function saveSession(userId: string, session: SessionData) {
  const messages = session.messages.slice(-MAX_CONTEXT_MESSAGES);
  const updatedAt = nowMs();
  const expiresAt = updatedAt + MEMORY_TTL_HOURS * 60 * 60 * 1000;
  db.prepare(`
    INSERT INTO sessions (user_id, data, updated_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at, expires_at=excluded.expires_at
  `).run(userId, JSON.stringify({ messages }), updatedAt, expiresAt);
}

function resetSession(userId: string) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

function cleanupExpired() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(nowMs());
  db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(nowMs() - 60_000);
}
setInterval(cleanupExpired, 15 * 60 * 1000).unref();

function getSettings(guildId: string) {
  const row = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId) as
    | { guild_id: string; primary_channel_id: string | null; one_chat_channel_id: string | null; ignored_channel_ids: string }
    | undefined;
  return {
    primaryChannelId: row?.primary_channel_id ?? null,
    oneChatChannelId: row?.one_chat_channel_id ?? null,
    ignoredChannelIds: row ? (JSON.parse(row.ignored_channel_ids) as string[]) : [],
  };
}

function saveSettings(guildId: string, settings: ReturnType<typeof getSettings>) {
  db.prepare(`
    INSERT INTO guild_settings (guild_id, primary_channel_id, one_chat_channel_id, ignored_channel_ids)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      primary_channel_id=excluded.primary_channel_id,
      one_chat_channel_id=excluded.one_chat_channel_id,
      ignored_channel_ids=excluded.ignored_channel_ids
  `).run(guildId, settings.primaryChannelId, settings.oneChatChannelId, JSON.stringify(settings.ignoredChannelIds));
}

function isAdmin(userId: string, permissions: bigint | null | undefined) {
  return userId === DEV_USER_ID || Boolean(permissions && (permissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator);
}

function allowedByRateLimit(userId: string) {
  const now = nowMs();
  const row = db.prepare("SELECT window_start, count FROM rate_limits WHERE user_id = ?").get(userId) as
    | { window_start: number; count: number }
    | undefined;
  if (!row || now - row.window_start >= 60_000) {
    db.prepare(`INSERT INTO rate_limits (user_id, window_start, count) VALUES (?, ?, 1)
      ON CONFLICT(user_id) DO UPDATE SET window_start=excluded.window_start, count=1`).run(userId, now);
    return true;
  }
  if (row.count >= RATE_LIMIT_PER_MINUTE) return false;
  db.prepare("UPDATE rate_limits SET count = count + 1 WHERE user_id = ?").run(userId);
  return true;
}

function normalizeText(text: string) {
  return text.replace(/<@!?\d+>/g, "").replace(/\s+/g, " ").trim();
}

function shouldTrigger(settings: ReturnType<typeof getSettings>, channelId: string, mentioned: boolean, repliedToAarohi: boolean) {
  if (settings.ignoredChannelIds.includes(channelId)) return false;
  if (settings.oneChatChannelId) return channelId === settings.oneChatChannelId;
  if (settings.primaryChannelId === channelId) return true;
  return mentioned || repliedToAarohi;
}

function splitDiscordMessage(text: string) {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 2000) {
    let cut = remaining.lastIndexOf("\n", 2000);
    if (cut < 500) cut = remaining.lastIndexOf(" ", 2000);
    if (cut < 1) cut = 2000;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.length ? chunks : ["..."];
}

async function fetchWithTimeout(url: string, options: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function generateReply(userId: string, text: string) {
  const session = getSession(userId);
  const messages = session.messages.slice(-MAX_CONTEXT_MESSAGES);
  messages.push({ role: "user", content: text });

  let reply: string;
  if (AI_PROVIDER === "gemini") {
    const contents = messages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(AI_MODEL)}:generateContent?key=${encodeURIComponent(AI_API_KEY)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ system_instruction: { parts: [{ text: characterPrompt }] }, contents }),
      },
    );
    if (!response.ok) throw new Error(`Gemini API ${response.status}: ${await response.text()}`);
    const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    reply = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim() ?? "";
  } else {
    const response = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0.8,
        messages: [{ role: "system", content: characterPrompt }, ...messages],
      }),
    });
    if (!response.ok) throw new Error(`Groq API ${response.status}: ${await response.text()}`);
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    reply = json.choices?.[0]?.message?.content?.trim() ?? "";
  }

  if (!reply) throw new Error("AI returned an empty response.");
  session.messages.push({ role: "user", content: text }, { role: "assistant", content: reply });
  saveSession(userId, session);
  return reply;
}

const commands = [
  new SlashCommandBuilder().setName("invite").setDescription("Get Aarohi's invite link"),
  new SlashCommandBuilder().setName("donate").setDescription("Support Aarohi"),
  new SlashCommandBuilder().setName("help").setDescription("Get Aarohi help and community link"),
  new SlashCommandBuilder().setName("vote").setDescription("Vote for Aarohi"),
  new SlashCommandBuilder().setName("reset").setDescription("Clear your temporary Aarohi memory"),
  new SlashCommandBuilder().setName("primarychat").setDescription("Set a free-chat channel")
    .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("ignorechat").setDescription("Ignore a channel")
    .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true)),
  new SlashCommandBuilder().setName("setonechatchannel").setDescription("Restrict Aarohi to one free-chat channel")
    .addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true)),
].map((c) => c.setDMPermission(false).toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationCommands(DISCORD_APPLICATION_ID), { body: commands });
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag}`);
  await registerCommands();
  console.log("Slash commands registered.");
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "invite") return interaction.reply({ content: INVITE_URL || "Invite link is not configured.", ephemeral: true });
  if (interaction.commandName === "donate") return interaction.reply({ content: DONATION_URL || "Donation link is not configured.", ephemeral: true });
  if (interaction.commandName === "help") return interaction.reply({ content: COMMUNITY_URL || "Community link is not configured.", ephemeral: true });
  if (interaction.commandName === "vote") return interaction.reply({ content: VOTE_URL || "Voting link coming soon.", ephemeral: true });
  if (interaction.commandName === "reset") {
    resetSession(interaction.user.id);
    return interaction.reply({ content: "Tumhari temporary memory clear kar di 😭", ephemeral: true });
  }
  if (!interaction.guildId) return;
  if (!isAdmin(interaction.user.id, interaction.memberPermissions?.bitfield)) {
    return interaction.reply({ content: "Ye command sirf server admins ke liye hai.", ephemeral: true });
  }
  const channel = interaction.options.getChannel("channel", true);
  const settings = getSettings(interaction.guildId);
  if (interaction.commandName === "primarychat") {
    settings.primaryChannelId = channel.id;
    saveSettings(interaction.guildId, settings);
    return interaction.reply(`Primary chat set hai: <#${channel.id}>. Baaki channels mein mention/reply se Aarohi normal respond karegi.`);
  }
  if (interaction.commandName === "ignorechat") {
    if (!settings.ignoredChannelIds.includes(channel.id)) settings.ignoredChannelIds.push(channel.id);
    saveSettings(interaction.guildId, settings);
    return interaction.reply(`Aarohi ab <#${channel.id}> ko ignore karegi.`);
  }
  if (interaction.commandName === "setonechatchannel") {
    settings.oneChatChannelId = channel.id;
    saveSettings(interaction.guildId, settings);
    return interaction.reply(`Single-channel mode set hai: <#${channel.id}>.`);
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guildId) {
    await message.reply("Main DM mein baat nahi karti. Server mein milo na 🥹").catch(() => undefined);
    return;
  }
  const settings = getSettings(message.guildId);
  const mentioned = message.mentions.has(client.user?.id ?? "");
  const repliedToAarohi = message.reference?.messageId
    ? await message.channel.messages.fetch(message.reference.messageId)
        .then((repliedMessage) => repliedMessage.author.id === client.user?.id)
        .catch(() => false)
    : false;
  if (!shouldTrigger(settings, message.channelId, mentioned, repliedToAarohi)) return;
  if (!allowedByRateLimit(message.author.id)) return;
  const text = normalizeText(message.content) || "Hii Aarohi 😭";
  const channel = message.channel as TextBasedChannel;
  if ("sendTyping" in channel && typeof channel.sendTyping === "function") {
    await channel.sendTyping().catch(() => undefined);
  }
  await new Promise((resolve) => setTimeout(resolve, 700 + Math.random() * 1300));
  try {
    const reply = await generateReply(message.author.id, text);
    for (const chunk of splitDiscordMessage(reply)) {
      await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
    }
  } catch (error) {
    console.error("Message generation failed:", error);
    await message.reply({ content: "Aaj mera dimaag thoda hang ho raha hai 😭 thodi der baad try karo.", allowedMentions: { repliedUser: false } }).catch(() => undefined);
  }
});

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);
  try { await client.destroy(); } catch (error) { console.error("Discord shutdown failed:", error); }
  try { db.close(); } catch (error) { console.error("Database shutdown failed:", error); }
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void client.login(DISCORD_BOT_TOKEN);

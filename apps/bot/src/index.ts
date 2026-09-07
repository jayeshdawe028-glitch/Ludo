import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

const token = process.env.DISCORD_BOT_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID;
if (!token || !applicationId) throw new Error('Set DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID');

const commands = [
  new SlashCommandBuilder().setName('flex').setDescription('Show your LudoCord lifetime stats'),
  new SlashCommandBuilder().setName('help').setDescription('Show all LudoCord commands'),
  new SlashCommandBuilder().setName('check').setDescription('Check another player\'s LudoCord stats').addUserOption(o => o.setName('user').setDescription('Player').setRequired(true)),
  new SlashCommandBuilder().setName('invite').setDescription('Get the LudoCord bot invite link'),
  new SlashCommandBuilder().setName('community').setDescription('Get the LudoCord community link')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(token);
await rest.put(Routes.applicationCommands(applicationId), { body: commands });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const server = process.env.SERVER_URL ?? 'http://localhost:3000';
const inviteUrl = process.env.BOT_INVITE_URL ?? 'https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot%20applications.commands&permissions=0';
const communityUrl = process.env.COMMUNITY_URL ?? 'https://discord.com/invite/REPLACE_ME';

async function fetchStats(id: string) {
  try {
    const r = await fetch(`${server}/api/stats/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`stats ${r.status}`);
    return await r.json() as { gamesPlayed:number; wins:number; losses:number };
  } catch {
    return { gamesPlayed: 0, wins: 0, losses: 0 };
  }
}

function statsEmbed(name: string, s: {gamesPlayed:number; wins:number; losses:number}) {
  return new EmbedBuilder().setTitle('🎲 LudoCord Stats').setDescription(`**${name}**`).addFields(
    { name: 'Games Played', value: String(s.gamesPlayed), inline: true },
    { name: 'Wins', value: String(s.wins), inline: true },
    { name: 'Losses', value: String(s.losses), inline: true },
  );
}

client.on('interactionCreate', async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'help') {
    await interaction.reply({ content: '**LudoCord commands**\n`/flex` — your stats\n`/check @user` — another player\'s stats\n`/invite` — bot invite\n`/community` — community server\n\nLaunch the LudoCord Activity from Discord to play.' });
    return;
  }
  if (interaction.commandName === 'invite') { await interaction.reply({ content: inviteUrl }); return; }
  if (interaction.commandName === 'community') { await interaction.reply({ content: communityUrl }); return; }
  if (interaction.commandName === 'flex') {
    const s = await fetchStats(interaction.user.id);
    await interaction.reply({ embeds: [statsEmbed(interaction.user.globalName ?? interaction.user.username, s)] }); return;
  }
  if (interaction.commandName === 'check') {
    const user = interaction.options.getUser('user', true);
    const s = await fetchStats(user.id);
    await interaction.reply({ embeds: [statsEmbed(user.globalName ?? user.username, s)] }); return;
  }
});

client.once('ready', () => console.log(`LudoCord bot ready as ${client.user?.tag}`));
await client.login(token);

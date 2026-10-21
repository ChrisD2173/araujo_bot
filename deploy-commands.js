require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Reproduce una canción o la añade a la cola')
        .addStringOption((option) => option
            .setName('cancion')
            .setDescription('Nombre o URL de la canción')
            .setRequired(true)),
    new SlashCommandBuilder().setName('pause').setDescription('Pausa la reproducción'),
    new SlashCommandBuilder().setName('resume').setDescription('Reanuda la reproducción'),
    new SlashCommandBuilder().setName('skip').setDescription('Salta a la siguiente canción'),
    new SlashCommandBuilder().setName('stop').setDescription('Detiene la música y limpia la cola'),
    new SlashCommandBuilder().setName('restart').setDescription('Reinicia la canción actual desde el principio'),
    new SlashCommandBuilder().setName('queue').setDescription('Muestra la cola de reproducción'),
    new SlashCommandBuilder().setName('nowplaying').setDescription('Muestra la canción actual'),
].map((command) => command.toJSON());

const { DISCORD_TOKEN, APPLICATION_ID, GUILD_ID } = process.env;

(async () => {
    if (!DISCORD_TOKEN || !APPLICATION_ID || !GUILD_ID) {
        throw new Error('Configura DISCORD_TOKEN, APPLICATION_ID y GUILD_ID en el archivo .env.');
    }

    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

    try {
        console.log('🔄 Registrando comandos...');
        await rest.put(
            Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID),
            { body: commands },
        );
        console.log('✅ Comandos registrados en el servidor.');
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
})();
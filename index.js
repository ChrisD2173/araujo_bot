require('dotenv').config();
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const { YoutubeExtractor } = require('discord-player-youtubei');

// 1. Crear el cliente de Discord con los intents necesarios
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// 2. Inicializar el reproductor de música (Discord Player)
const player = new Player(client, {
    ffmpegPath: require('ffmpeg-static'),
    probeTimeout: 15_000,
});

player.on('debug', (message) => {
    console.log(`[Player] ${message}`);
});

player.events.on('debug', (queue, message) => {
    console.log(`[Queue ${queue.guild.id}] ${message}`);
});

// 3. Cargar los extractores antes de aceptar comandos.
async function startBot() {
    if (!process.env.DISCORD_TOKEN) {
        throw new Error('Configura DISCORD_TOKEN en el archivo .env.');
    }

    await player.extractors.loadMulti(DefaultExtractors);
    await player.extractors.register(YoutubeExtractor, {});
    await client.login(process.env.DISCORD_TOKEN);
}

// 4. Evento cuando el bot se conecta
client.once(Events.ClientReady, (c) => {
    console.log(`✅ Bot listo como ${c.user.tag}`);
});

// 5. Evento para notificar cuando empieza una canción
player.events.on('playerStart', (queue, track) => {
    queue.metadata.channel.send(`🎶 Reproduciendo: **${track.title}**`);
});

player.events.on('playerError', (queue, error, track) => {
    console.error(`Error reproduciendo "${track.title}":`, error);
    queue.metadata?.channel?.send(`❌ Falló el audio de **${track.title}**: ${error.message}`)
        .catch((sendError) => console.error('No se pudo notificar el error de audio:', sendError));
});

player.events.on('error', (queue, error) => {
    console.error(`Error en la cola del servidor ${queue.guild.id}:`, error);
    queue.metadata?.channel?.send(`❌ Error en la cola de música: ${error.message}`)
        .catch((sendError) => console.error('No se pudo notificar el error de la cola:', sendError));
});

const queueFor = (guildId) => player.nodes.get(guildId);

function withTimeout(promise, timeoutMs, action) {
    let timeout;
    const timeoutPromise = new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timeout al ${action} después de ${timeoutMs / 1000} segundos.`)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

// 6. Comandos de música
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (!interaction.guild) {
        return interaction.reply({ content: 'Este comando solo funciona dentro de un servidor.', ephemeral: true });
    }

    const queue = queueFor(interaction.guildId);

    if (interaction.commandName === 'play') {
        const query = interaction.options.getString('cancion', true).trim();
        const channel = interaction.member.voice.channel;

        if (!channel) {
            return interaction.reply({ content: 'Únete a un canal de voz primero.', ephemeral: true });
        }
        await interaction.deferReply();

        try {
            await interaction.editReply(`🔎 Buscando **${query}**...`);
            const searchResult = await withTimeout(player.search(query), 30_000, 'buscar la canción');
            if (searchResult.isEmpty()) {
                return interaction.editReply('❌ No encontré resultados para esa canción. Prueba con otro título o un enlace directo.');
            }

            await interaction.editReply(`🔗 Encontré **${searchResult.tracks[0].title}**. Conectando al canal de voz...`);
            const { track } = await withTimeout(player.play(channel, searchResult, {
                nodeOptions: {
                    metadata: { channel: interaction.channel },
                    leaveOnEmpty: true,
                    leaveOnEmptyCooldown: 300_000,
                    leaveOnEnd: true,
                    leaveOnEndCooldown: 15_000,
                    leaveOnStop: true,
                },
            }), 30_000, 'conectarse al canal de voz');
            return interaction.editReply(`✅ Añadido a la cola: **${track.title}**`);
        } catch (e) {
            console.error(e);
            const message = e.message.startsWith('Timeout')
                ? `❌ ${e.message} Revisa la conexión del bot y que tenga permiso para conectarse y hablar.`
                : '❌ No pude reproducir esa canción. Prueba con otro título o un enlace directo.';
            return interaction.editReply(message);
        }
    }

    if (!queue) {
        return interaction.reply({ content: 'No hay música reproduciéndose en este servidor.', ephemeral: true });
    }

    switch (interaction.commandName) {
        case 'pause':
            if (!queue.node.pause()) {
                return interaction.reply({ content: 'La reproducción ya está pausada.', ephemeral: true });
            }
            return interaction.reply('⏸️ Reproducción pausada.');
        case 'resume':
            if (!queue.node.resume()) {
                return interaction.reply({ content: 'La reproducción ya está activa.', ephemeral: true });
            }
            return interaction.reply('▶️ Reproducción reanudada.');
        case 'skip':
            if (!queue.currentTrack) {
                return interaction.reply({ content: 'No hay una canción actual para saltar.', ephemeral: true });
            }
            queue.node.skip();
            return interaction.reply('⏭️ Canción saltada.');
        case 'stop':
            queue.delete();
            return interaction.reply('⏹️ Música detenida y cola limpiada.');
        case 'restart': {
            if (!queue.currentTrack) {
                return interaction.reply({ content: 'No hay una canción reproduciéndose para reiniciar.', ephemeral: true });
            }
            const restarted = await queue.node.seek(0);
            if (!restarted) {
                return interaction.reply({ content: 'No pude reiniciar la canción actual.', ephemeral: true });
            }
            return interaction.reply(`🔁 Canción reiniciada: **${queue.currentTrack.title}**`);
        }
        case 'nowplaying':
            if (!queue.currentTrack) {
                return interaction.reply({ content: 'No hay una canción reproduciéndose.', ephemeral: true });
            }
            return interaction.reply(`🎶 Ahora suena: **${queue.currentTrack.title}**`);
        case 'queue': {
            const upcoming = queue.tracks.toArray().slice(0, 10);
            const listing = upcoming.length
                ? upcoming.map((track, index) => `${index + 1}. **${track.title}**`).join('\n')
                : 'No hay más canciones en la cola.';
            const current = queue.currentTrack ? `🎶 **${queue.currentTrack.title}**\n` : '';
            return interaction.reply(`${current}${listing}`);
        }
        default:
            return;
    }
});

// 7. Iniciar sesión con el token del archivo .env
startBot().catch((error) => {
    console.error('❌ No se pudo iniciar el bot:', error);
    process.exitCode = 1;
});
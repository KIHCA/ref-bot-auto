const { Client, GatewayIntentBits } = require('discord.js');
const Bancho = require('bancho.js');
const fs = require('fs');
const { google } = require('googleapis');

// Configuration
const DISCORD_TOKEN = 'ptdr';
const OSU_USERNAME = 'KIHCA';
const OSU_PASSWORD = 'ptdr';
const OSU_API_KEY = 'ptdr';
const DISCORD_CHANNEL_ID = 'ptdr';
const ADMIN_ID = 'ptdr';

// Authentification Google Sheets
const credentials = JSON.parse(fs.readFileSync('credentials.json'));
const { client_id, client_secret, redirect_uris } = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
oAuth2Client.setCredentials(JSON.parse(fs.readFileSync('token.json')));

// Fonctions utilitaires
function saveData(filename, data) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

function loadData(filename, defaultValue) {
    if (fs.existsSync(filename)) {
        return JSON.parse(fs.readFileSync(filename, 'utf8'));
    }
    return defaultValue;
}

// Fonction pour ajouter un lien à Google Sheets
async function addLinkToSheet(lobbyLink) {
    const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });
    const spreadsheetId = '1wucDIhWx38HBKD-wYVdBzCMEPEIAPQDvuNQZbdInVPs';
    const range = 'Match Links/IDs!A2:A';

    const request = {
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
            values: [[lobbyLink]],
        },
    };

    try {
        const response = await sheets.spreadsheets.values.append(request);
        console.log(`Lien ajouté à la Google Sheet: ${lobbyLink}`);
    } catch (error) {
        console.error('Erreur lors de l\'ajout du lien à la Google Sheet:', error);
    }
}

// Fonction pour générer un mot de passe aléatoire
function generateRandomPassword(length = 10) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * charset.length);
        password += charset[randomIndex];
    }
    return password;
}

// Initialisation des clients Discord et Bancho
const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});
const banchoClient = new Bancho.BanchoClient({
    username: OSU_USERNAME,
    password: OSU_PASSWORD,
    apiKey: OSU_API_KEY
});

banchoClient.connect()
    .then(() => console.log('Connected to Bancho!'))
    .catch(console.error);

// Chargement des données initiales
let authorizedUsers = loadData('authorizedUsers.json', []);
let verificationCodes = loadData('verificationCodes.json', {});
let userOsuLinks = loadData('userOsuLinks.json', {});
let pools = loadData('pools.json', {
    facile: { nm: [], hd: [], hr: [], dt: [], tb: [] },
    difficile: { nm: [], hd: [], hr: [], dt: [], tb: [] }
});
let abortCount = {};

discordClient.once('ready', () => {
    console.log('Bot Discord connecté !');
});

// Gestion des commandes admin
discordClient.on('messageCreate', message => {
    if (message.channel.id === DISCORD_CHANNEL_ID && message.content.startsWith('!admin')) {
        if (message.author.id !== ADMIN_ID) {
            message.reply("Vous n'avez pas l'autorisation d'utiliser cette commande.");
            return;
        }

        const args = message.content.split(' ');
        const action = args[1];
        const userId = args[2];

        if (action === 'add') {
            if (!authorizedUsers.includes(userId)) {
                authorizedUsers.push(userId);
                saveData('authorizedUsers.json', authorizedUsers);
                message.reply(`L'utilisateur avec l'ID ${userId} a été ajouté à la liste des utilisateurs autorisés.`);
            } else {
                message.reply(`L'utilisateur avec l'ID ${userId} est déjà autorisé.`);
            }
        } else if (action === 'remove') {
            authorizedUsers = authorizedUsers.filter(id => id !== userId);
            saveData('authorizedUsers.json', authorizedUsers);
            message.reply(`L'utilisateur avec l'ID ${userId} a été retiré de la liste des utilisateurs autorisés.`);
        } else if (action === 'list') {
            message.reply(`Utilisateurs autorisés: ${authorizedUsers.join(', ') || 'Aucun utilisateur autorisé.'}`);
        } else {
            message.reply('Commande invalide. Utilisez `!admin add [ID]`, `!admin remove [ID]`, ou `!admin list`.');
        }
    }
});

// Fonction pour générer un code de vérification aléatoire
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Gestion de la commande !verif add $pseudo
discordClient.on('messageCreate', async message => {
    if (message.channel.id === DISCORD_CHANNEL_ID && message.content.startsWith('!verif add')) {
        const args = message.content.slice('!verif add'.length).trim();
        const osuUsername = args

        if (!osuUsername) {
            message.reply('Erreur : Vous devez spécifier un pseudo osu!.\nExemple : `!verif add KIHCA`');
            return;
        }

        if (verificationCodes[message.author.id] && !verificationCodes[message.author.id].verified) {
            message.reply('Erreur : Vous êtes déjà vérifié. Vous ne pouvez pas demander une nouvelle vérification.');
            return;
        }

        const verificationCode = generateVerificationCode();
        verificationCodes[message.author.id] = { osuUsername, verificationCode };
        saveData('verificationCodes.json', verificationCodes);

        try {
            // Envoi du message privé sur osu! via l'API bancho.js
            const osuUser = await banchoClient.getUser(osuUsername);
            if (osuUser) {
                await osuUser.sendMessage(`Votre code de vérification pour lier votre compte osu! est : ${verificationCode}`);
                console.log(`${verificationCode} ${osuUser}`);
                message.reply('Code de vérification envoyé sur osu! en message privé.');
            } else {
                message.reply('Erreur : Impossible de trouver le joueur sur osu!. Vérifiez le pseudo.');
            }
        } catch (error) {
            console.error('Erreur lors de l\'envoi du message privé sur osu!:', error);
            message.reply('Erreur : Impossible d\'envoyer le message privé sur osu!. Veuillez réessayer plus tard.');
        }
    }
});

// Gestion de la commande !verif code $code
discordClient.on('messageCreate', async message => {
    if (message.channel.id === DISCORD_CHANNEL_ID && message.content.startsWith('!verif code')) {
        const args = message.content.split(' ');
        const code = args[2];

        if (!code) {
            message.reply('Erreur : Vous devez spécifier un code de vérification.\nExemple : `!verif code 123456`');
            return;
        }

        const userVerification = verificationCodes[message.author.id];
        if (userVerification && userVerification.verificationCode === code) {
            userOsuLinks[message.author.id] = userVerification.osuUsername;
            saveData('userOsuLinks.json', userOsuLinks);
            delete verificationCodes[message.author.id];
            saveData('verificationCodes.json', verificationCodes);
            message.reply(`Votre compte osu! (${userVerification.osuUsername}) a été lié avec succès.`);
        } else {
            message.reply('Erreur : Code de vérification incorrect ou expiré.');
        }
    }
});

// Gestion de la commande !setup
discordClient.on('messageCreate', async message => {
    if (message.channel.id === DISCORD_CHANNEL_ID && message.content.startsWith('!setup')) {
        if (!authorizedUsers.includes(message.author.id)) {
            message.reply("Vous n'avez pas l'autorisation d'utiliser cette commande.");
            return;
        }

        const args = message.content.slice('!setup'.length).trim().split(' ');
        const difficulty = args[0];
        const poolConfig = args.slice(1).join(' ');

        if (!pools[difficulty]) {
            message.reply('Erreur de syntaxe. Utilisez la commande comme suit :\n' +
                '`!setup [difficulté] nm: 4166593 / 4605437 - hd: 4622389 - hr: 4579389 - dt: 3299371 - tb: 4473039`\n' +
                'Exemple : `!setup facile nm: 4166593 - hd: 4622389`');
            return;
        }

        const poolArgs = poolConfig.split(' - ');
        const newPool = {
            nm: [], hd: [], hr: [], dt: [], tb: []
        };

        let error = false;

        poolArgs.forEach(arg => {
            const [mod, maps] = arg.split(': ');
            if (newPool[mod] && maps) {
                newPool[mod] = maps.split(' / ');
            } else {
                error = true;
            }
        });

        if (error) {
            message.reply('Erreur de syntaxe. Utilisez la commande comme suit :\n' +
                '`!setup [difficulté] nm: 4166593 / 4605437 - hd: 4622389 - hr: 4579389 - dt: 3299371 - tb: 4473039`\n' +
                'Exemple : `!setup facile nm: 4166593 - hd: 4622389`');
        } else {
            pools[difficulty] = newPool;
            saveData('pools.json', pools);
            message.reply(`Le pool "${difficulty}" a été configuré avec succès.`);

            const poolConfigMessage = Object.entries(newPool).map(([mod, maps]) => {
                return `${mod.toUpperCase()}: ${maps.join(' / ') || 'Aucune map configurée'}`;
            }).join('\n');

            message.channel.send(`Configuration actuelle du pool "${difficulty}" :\n${poolConfigMessage}`);
        }
    }
});

// Gestion de la commande !tryouts
discordClient.on('messageCreate', async message => {
    if (message.channel.id === DISCORD_CHANNEL_ID && message.content.startsWith('!tryouts')) {
        const args = message.content.split(' ');
        let playerName = args[1];
        const difficulty = args[2] || args[1];

        if (!difficulty || !pools[difficulty]) {
            message.reply('Erreur : commande incorrecte. Utilisez `!tryouts [difficulté]` si votre compte est lié ou `!tryouts [pseudo] [difficulté]`.\n' +
                'Exemple : `!tryouts facile` ou `!tryouts KIHCA facile`');
            return;
        }

        if (!playerName || pools[difficulty]) {
            playerName = userOsuLinks[message.author.id];
            if (!playerName) {
                message.reply('Erreur : Vous devez d\'abord lier votre compte osu! en utilisant `!verif add [pseudo]`.');
                return;
            }
        }

        try {
            const { lobbyLink, password } = await createLobbyAndInvitePlayer(playerName, difficulty, message.author);
            message.reply(`Lobby créé : ${lobbyLink}`);
        } catch (error) {
            console.error(error);
            message.reply('Erreur lors de la création du lobby ou de l\'invitation du joueur.');
        }
    }
});

// Création du lobby et invitation du joueur
async function createLobbyAndInvitePlayer(playerName, difficulty, author) {
    try {
        const lobbyChannel = await banchoClient.createLobby(`Tryouts - ${playerName} - ${difficulty}`);
        const lobby = lobbyChannel.lobby;

        if (!lobby) {
            throw new Error('Impossible de récupérer le lobby.');
        }

        abortCount[playerName] = 0;

        lobbyChannel.on('message', async (msg) => {
            if (msg.user.username === playerName && msg.message.toLowerCase() === 'abort') {
                abortCount[playerName]++;
                if (abortCount[playerName] <= 2) {
                    await lobbyChannel.sendMessage('!mp abort');
                    console.log(`Le joueur ${playerName} a utilisé abort (${abortCount[playerName]} fois).`);
                } else {
                    await lobbyChannel.sendMessage(`Vous avez atteint la limite de 2 aborts.`);
                    console.log(`Le joueur ${playerName} a dépassé la limite d'aborts.`);
                }
            }
        });

        lobbyChannel.on('message', async (msg) => {
          if (msg.user.username === playerName && msg.message.toLowerCase() === 'close') {
              await lobbyChannel.sendMessage('!mp close');
              console.log(`Le joueur ${playerName} a utilisé !mp close.`);
          }
      });      

        const lobbyLink = lobby.getHistoryUrl();
        if (!lobbyLink) {
            throw new Error('Impossible de récupérer l\'URL du lobby.');
        }

        await addLinkToSheet(lobbyLink);

        const password = generateRandomPassword();
        await lobbyChannel.sendMessage(`!mp password ${password}`);
        await lobbyChannel.sendMessage(`!mp set 0 3 16`);
        await lobbyChannel.sendMessage(`!mp invite ${playerName}`);
        await author.send(`Le lobby pour ${playerName} (${difficulty}) a été créé.\nMot de passe : ${password}\nLien du lobby : ${lobbyLink}`);

        let mapQueue = [
            ...pools[difficulty].nm.map(id => ({ mod: 'nm', id })),
            ...pools[difficulty].hd.map(id => ({ mod: 'hd', id })),
            ...pools[difficulty].hr.map(id => ({ mod: 'hr', id })),
            ...pools[difficulty].dt.map(id => ({ mod: 'dt', id })),
            ...pools[difficulty].tb.map(id => ({ mod: 'tb', id }))
        ];

        let currentMapIndex = 0;

        async function playNextMap() {
            if (currentMapIndex < mapQueue.length) {
                const { mod, id } = mapQueue[currentMapIndex];
                switch (mod) {
                    case 'nm':
                        await lobbyChannel.sendMessage('!mp mods nf');
                        break;
                    case 'hd':
                        await lobbyChannel.sendMessage('!mp mods nf hd');
                        break;
                    case 'hr':
                        await lobbyChannel.sendMessage('!mp mods nf hr');
                        break;
                    case 'dt':
                        await lobbyChannel.sendMessage('!mp mods nf dt');
                        break;
                    case 'tb':
                        await lobbyChannel.sendMessage('!mp mods freemod nf');
                        break;
                }

                await new Promise(resolve => setTimeout(resolve, 2000));
                await lobbyChannel.sendMessage(`!mp map ${id}`);
                console.log(`Map ${id} ajoutée avec mod ${mod}.`);

                currentMapIndex++;

                lobby.once('matchFinished', async () => {
                    console.log('Match terminé, changement de la carte.');
                    await playNextMap();
                });
            } else {
                await lobbyChannel.sendMessage('Toutes les maps ont été jouées.');
                console.log('Toutes les maps ont été jouées.');
            }
        }

        lobby.on('allPlayersReady', async () => {
            console.log(`${playerName} est prêt.`);
            await lobbyChannel.sendMessage('!mp start 5');
        });

        await playNextMap();

        console.log('Lobby configuré avec les maps.');
        return { lobbyLink, password };
    } catch (error) {
        console.error(error);
        throw new Error('Erreur lors de la création du lobby ou de l\'invitation.');
    }
}

// Connexion du bot Discord
discordClient.login(DISCORD_TOKEN);
// Connexion du bot Discord
discordClient.login(DISCORD_TOKEN);

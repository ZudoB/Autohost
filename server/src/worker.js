const LocalSessionManager = require("./sessionmanager/LocalSessionManager");
const SessionManager = require("./sessionmanager/SessionManager");
const APIServer = require("./api/APIServer");
const {getMe} = require("./gameapi/api");
const {runQueue} = require("./taskqueue/queue");
const DMInterface = require("./sessionmanager/DMInterface");
const DiscordBot = require("./discord/DiscordBot");
const {cpus} = require("os");
const SmurfProtection = require("./smurf/SmurfProtection");

const lsm = new LocalSessionManager();
const gsm = new SessionManager();
const sp = new SmurfProtection();

let discord;

global.sessionManager = gsm;
global.localSessionManager = lsm;
global.smurfProtection = sp;

ipc.onReady = function () {
    getMe().then(async profile => {
        global.botUserID = profile._id;

        discord = new DiscordBot(process.env.DISCORD_TOKEN, workerIndex, Math.min(cpus().length, 8));

        await lsm.restoreSessions();

        if (isFirstWorker) {
            new DMInterface();
            await lsm.createPersistLobbies();
        }

        setInterval(() => {
            lsm.report();
        }, 5000);

        new APIServer(process.env.API_PORT || 8180);

        runQueue();
    });
}

ipc.onMessage("lsm.createSession", ([isPrivate, type, args]) => {
    return lsm.createSession(isPrivate, type, args);
});

ipc.onMessage("lsm.inviteToSession", ([sessionID, user]) => {
    return lsm.inviteToSession(sessionID, user);
});

ipc.onMessage("lsm.destroySession", sessionID => {
    return lsm.destroySession(sessionID);
});

ipc.onMessage("lsm.getSessionByID", id => {
    return lsm.getSessionByID(id);
});

ipc.onMessage("lsm.getSessionByTournamentMatch", ([tournament, match]) => {
    return lsm.getSessionByTournamentMatch(tournament, match);
});

ipc.onMessage("lsm.destroySessionByTournamentMatch", ([tournament, match]) => {
    return lsm.destroySessionByTournamentMatch(tournament, match);
});

ipc.onMessage("lsm.xrc", ([target, code]) => {
    return lsm.xrc(target, code);
});

ipc.onMessage("discord.getGuildsWithMember", member => {
    return discord.getGuildsWithMember(member);
});

ipc.onMessage("discord.getGuildRoles", guilds => {
    return discord.getGuildRoles(guilds);
});

ipc.onMessage("discord.applyUserRoles", user => {
    return discord.applyUserRoles(user);
});

ipc.onMessage("discord.validateConfigChanges", ([guild, config, user]) => {
    return discord.validateConfigChanges(guild, config, user);
});

ipc.onMessage("discord.isMemberPresent", ([guild, member]) => {
    return discord.isMemberPresent(guild, member);
});

ipc.onMessage("discord.createInvite", guild => {
    return discord.createInvite(guild);
});

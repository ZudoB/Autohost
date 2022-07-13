const EventEmitter = require("events");

const api = require("../gameapi/api");
const commands = require("./commands");
const APMCalculator = require("./APMCalculator");
const {getForcedPlayCount, incrementForcedPlayCount} = require("../redis/redis");
const {TWO_PLAYER_MODES, APM_LIMIT_EXEMPTIONS} = require("../data/enums");
const {checkAll} = require("./rules");
const ordinal = require("ordinal");
const motds = require("./motds");
const {BloomFilter} = require("bloom-filters");
const {logMessage, LOG_LEVELS} = require("../log");
const {DBUser} = require("../db/models");
const {getUser} = require("../gameapi/api");

/**
 * Autohost! Attaches to a {@link Ribbon} and manages everything in the associated lobby.
 */
class Autohost extends EventEmitter {

    constructor({ribbon, host, persistLobby}) {
        super();

        if (!ribbon.room) {
            throw new Error("Ribbon should be connected to a lobby!");
        }

        this.creationTime = Date.now();
        this.timeoutWarned = false;
        this.apmLimitExemption = APM_LIMIT_EXEMPTIONS.NONE;

        this.persist = false;
        this.host = host;

        this.motd = undefined;

        this.apmCalculator = new APMCalculator(this);

        /** cache for player info **/
        this.playerData = new Map();
        /** cache for username lookup **/
        this.usernamesToIds = new Map();
        /** moderators **/
        this.moderatorUsers = new Map();
        /** users who were !allowed **/
        this.allowedUsers = new Map();

        /** users who have already seen the motd **/
        this.welcomedUsers = new BloomFilter(8000, 10);

        this.twoPlayerMode = TWO_PLAYER_MODES.STATIC_HOTSEAT;

        this.twoPlayerOpponent = undefined;
        this.twoPlayerChallenger = undefined;
        this.twoPlayerQueue = [];

        this.bracketSwapWarnedPlayers = {};

        this.rules = {};

        this.autostart = 0;

        this.motdID = "defaultMOTD";

        this.persistLobby = persistLobby;
        this.ribbon = ribbon;

        this.smurfProtection = false;

        if (this.host && !this.persistLobby) {
            getUser(this.host).then(user => {
                this.ribbon.room.setName(`${user.username.toUpperCase()}'S AUTOHOST ROOM`);
            });
        }
    }

    log(message) {
        // todo: move
        logMessage(LOG_LEVELS.FINE, "Autohost", message, {
            room: this.roomID,
            rules: this.rules,
            host_mode: this.ribbon?.room?.settings?.owner !== botUserID,
            ingame: this.ribbon.room.ingame,
            in_1v1: this.twoPlayerOpponent,
            persist: this.persist
        });
    }

    async setup() {
        this.ribbon.room.on("playersupdate", () => {
            if (this.ribbon.room.memberCount === 1 && !this.persist && this.someoneDidJoin) {
                this.destroy("Your room was closed because everyone left.");
            } else {
                this.checkAutostart();
            }
        });

        this.ribbon.on("gmupdate", () => {
            this.saveConfig();
        });

        this.ribbon.on("gmupdate.leave", leave => {
            const profile = this.playerData.get(leave);

            this.bracketSwapWarnedPlayers[leave] = 0;

            if (profile) {
                this.usernamesToIds.delete(profile.username.toLowerCase());
            }

            if (this.host === leave) {
                this.ribbon.room.takeOwnership();
            }

            if (this.twoPlayerChallenger === leave) {
                this.twoPlayerChallenger = undefined;
                this.nextChallenger();
                return;
            }

            if (this.twoPlayerOpponent === leave) {
                this.disableQueue();
                this.ribbon.sendChatMessage("The 1v1 queue was disabled because the opponent left.");
            }

            const queueIndex = this.twoPlayerQueue.indexOf(leave);
            if (queueIndex !== -1) {
                this.twoPlayerQueue.splice(queueIndex, 1);
            }
        });


        this.ribbon.on("replay", replay => {
            replay.frames.forEach(frame => {
                if (frame.type === "ige" && frame.data?.data?.type === "interaction" && frame.data?.data?.data?.type === "garbage") {
                    this.apmCalculator.addGarbageIGE(frame.data?.data?.sender, frame.data?.data?.data?.amt);
                }
            });
        });

        this.ribbon.on("gmupdate.bracket", async update => {
            if (!this.ribbon.room.isHost || update.bracket === "spectator") return;

            const playerData = await this.getPlayerData(update.uid);

            const ineligibleMessage = await this.checkPlayerEligibility(update.uid);

            if (ineligibleMessage) {
                this.ribbon.room.switchPlayerBracket(update.uid, "spectator");

                if (this.bracketSwapWarnedPlayers[update.uid]) return;

                this.bracketSwapWarnedPlayers[update.uid] = true;

                setTimeout(() => {
                    this.bracketSwapWarnedPlayers[update.uid] = false;
                }, 10000);

                this.sendMessage(playerData.username, `${ineligibleMessage}.`);
            }
        });

        this.ribbon.on("chat", async chat => {
            // if (chat.user.role === "bot") return; // ignore other bots

            const message = chat.content.trim();

            if (message.startsWith(">teto ")) {
                this.ribbon.sendChatMessage(":mahoblush:");
                return;
            }

            if (!message.startsWith("!")) return; // ignore not commands

            const username = chat.user.username;
            const user = chat.user._id;

            if (!user) return; // ignore osk trying to bully us

            let host = user === this.host;
            const mod = [...this.moderatorUsers.values()].indexOf(user) !== -1;

            const dbProfile = await DBUser.findOne({tetrio_id: user});
            const dev = dbProfile && dbProfile.roles.developer;

            if (!host && !dev) {
                host = ["admin", "mod"].indexOf((await this.getPlayerData(user)).role) !== -1;
            }

            const args = message.substring(1).split(" ");
            const command = args.shift().toLowerCase();

            if (commands.hasOwnProperty(command)) {
                const commandObj = commands[command];

                if (!this.ribbon.room.isHost && commandObj.needhost) {
                    this.sendMessage(username, "The host needs to exit !hostmode before you can run this command.");
                    return;
                }

                if (!dev && commandObj.devonly) {
                    this.sendMessage(username, "Only Autohost's developer can use this command.");
                    return;
                }

                if (!host && !dev && commandObj.hostonly) {
                    this.sendMessage(username, "Only the lobby host can use this command.");
                    return;
                }

                if (!host && !mod && !dev && commandObj.modonly) {
                    this.sendMessage(username, "Only lobby moderators can use this command.");
                    return;
                }

                commandObj.handler(user, username, args, this, dev);
            }
        });

        this.ribbon.on("readymulti", async data => {
            if (!this.ribbon.room.isHost) {
                if (this.ribbon.room.players.indexOf(botUserID) !== -1) {
                    const name = (await this.getPlayerData(this.ribbon.room.settings.owner)).username?.toUpperCase();
                    const count = parseInt(await getForcedPlayCount()) || 23; // default to a sensible number if it doesn't work
                    this.ribbon.sendChatMessage(`You thought there would be some funny easter egg here, didn't you, ${name}? Did you think I'd start playing at 5000 APM or something? Seriously?`);
                    this.ribbon.sendChatMessage(`I'm trying my best to help people, and this absolute COMEDIAN over here thought it'd be HILARIOUS to force a room moderation bot into the players bracket.`);
                    this.ribbon.sendChatMessage(`Now watch as, for the ${ordinal(count + 1)} time in my life, I get kicked from the server. I don't get paid for this, you know.`);
                    await incrementForcedPlayCount();
                } else {
                    this.ribbon.sendChatMessage("Please avoid starting the game while in host mode, as this can lead to unexpected behaviour.");
                }
            }

            this.ribbon.room.takeOwnership();

            this.apmCalculator.clearListenIDs();
            for (const player of data.contexts) {
                const playerData = await this.getPlayerData(player.user._id);

                if (this.apmLimitExemption === APM_LIMIT_EXEMPTIONS.RANKED && playerData.league.rank !== "z") {
                    this.log("Exempting " + player.user.username + " from APM limiter.");
                } else {
                    this.apmCalculator.addListenID(player.listenID, player.user.username);
                }

                this.checkPlayerEligibility(player.user._id).then(ineligible => {
                    if (ineligible) {
                        this.ribbon.room.kickPlayer(player.user._id);
                        this.log(player.user._id + " failed final check.");
                    } else {
                        this.log(player.user._id + " verified for play.");
                    }
                });
            }
        });

        this.ribbon.on("startmulti", () => {
            setTimeout(() => {
                if (this.ribbon.room.ingame) { // don't start if the game's already over
                    this.apmCalculator.start();
                }
            }, 20000);

            // ok this seems to work, but i'm not sure
            // `startscope` seems to prompt the server to send replay data, which we Really Want™
            this.ribbon.room.players.forEach(playerID => {
                this.ribbon.sendMessage({
                    command: "startscope",
                    data: playerID
                });
            });
        });

        this.ribbon.on("replayexpectend", gameover => {
            this.apmCalculator.die(gameover.listenID);
        });

        this.ribbon.on("endmulti", endstate => {
            this.gameEndedAt = Date.now();

            this.apmCalculator.stop();

            for (const i in endstate.leaderboard) {
                if (endstate.leaderboard.hasOwnProperty(i)) {
                    const player = endstate.leaderboard[i];
                    if (i < Math.min(3, endstate.leaderboard.length - 1)) {
                        logMessage(LOG_LEVELS.ULTRAFINE, "Smurf Protection", "Recorded win for " + player.user._id);
                        smurfProtection.recordWin(player.user._id);
                    } else {
                        logMessage(LOG_LEVELS.ULTRAFINE, "Smurf Protection", "Recorded loss for " + player.user._id);
                        smurfProtection.recordLoss(player.user._id);
                    }
                }
            }

            const firstPlace = endstate.currentboard.find(player => player.success);

            if (firstPlace && this.twoPlayerMode === TWO_PLAYER_MODES.DYNAMIC_HOTSEAT && firstPlace.user._id !== this.twoPlayerOpponent) {
                this.ribbon.sendChatMessage(`${firstPlace.user.username.toUpperCase()} has become the champion!`);

                this.twoPlayerOpponent = firstPlace.user._id;
                this.twoPlayerChallenger = undefined;
                if (this.twoPlayerQueue.indexOf(firstPlace.user._id) !== -1) {
                    this.twoPlayerQueue.splice(this.twoPlayerQueue.indexOf(firstPlace.user._id), 1);
                }
            }

            setTimeout(() => {
                this.nextChallenger();
                this.checkAutostart();
            }, 10000);
        });

        this.ribbon.on("gmupdate.join", async join => {
            this.someoneDidJoin = true;

            const user = await api.getUser(join._id);

            this.playerData.set(user._id, user);
            this.usernamesToIds.set(user.username.toLowerCase(), user._id);

            const {message, rule} = await checkAll(this.rules, user, this);

            if (rule) {
                this.ribbon.room.switchPlayerBracket(user._id, "spectator");
            }

            const actualMotdID = motds.hasOwnProperty(this.motdID) ? this.motdID : "defaultMOTD";

            motds[actualMotdID](this, join._id, user.username, rule, message).then(message => {
                if (message && !this.welcomedUsers.has(join._id)) {
                    DBUser.findOne({tetrio_id: join._id}).then(user => {
                        let toSend = message;

                        if (user?.join_emote) {
                            toSend += ` :${user.join_emote}:`;
                        }

                        this.ribbon.sendChatMessage(toSend);
                    });
                    this.welcomedUsers.add(join._id);
                    this.saveConfig();
                }
            });
        });


        setTimeout(() => {
            if (!this.someoneDidJoin && !this.persist) {
                this.destroy("Your lobby timed out because nobody joined in time.");
            }
        }, 30000);

        this.emit("ready");
    }

    async checkPlayerEligibility(player) {
        if (this.twoPlayerOpponent) {
            const elMessage = this.check2pEligibility(player);
            if (elMessage) return elMessage;
        }

        const playerData = await this.getPlayerData(player);

        if ([...this.allowedUsers.values()].indexOf(player) !== -1) {
            // user can play
            return;
        }

        return (await checkAll(this.rules, playerData, this)).message;
    }

    get roomID() {
        return this.ribbon.room.settings.id;
    }

    sendMessage(username, message) {
        this.ribbon.sendChatMessage(`[${username.toUpperCase()}] -> ${message}`);
    }

    async getUserID(username) {
        if (this.usernamesToIds.has(username.toLowerCase())) {
            return this.usernamesToIds.get(username.toLowerCase());
        } else {
            const data = (await this.getPlayerData(username.toLowerCase()));
            return data ? data._id : undefined;
        }
    }

    async getPlayerData(player) {
        player = player.toLowerCase();
        if (this.playerData.has(player)) {
            return this.playerData.get(player);
        } else {
            this.log("Loading player data for " + player);
            const data = await api.getUser(player);
            if (data) {
                this.playerData.set(data._id, data);
                this.usernamesToIds.set(data.username.toLowerCase(), data._id);
            }
            return data;
        }
    }

    modPlayer(user, username) {
        this.moderatorUsers.set(username.toLowerCase(), user);
    }

    unmodPlayer(username) {
        if (this.moderatorUsers.has(username.toLowerCase())) {
            this.moderatorUsers.delete(username.toLowerCase());
            return true;
        }
        return false;
    }

    recheckPlayers() {
        return Promise.all(this.ribbon.room.players.map(async player => {
            if (await this.checkPlayerEligibility(player)) {
                if (!this.ribbon.room.ingame) {
                    this.ribbon.room.switchPlayerBracket(player, "spectator");
                }
            }
        }));
    }

    checkAutostart() {
        if (Date.now() - this.gameEndedAt < 5000 || this.ribbon.room.ingame) return;

        if (this.autostart === 0) {
            if (this.autostartTimer) {
                clearTimeout(this.autostartTimer);
                this.autostartTimer = undefined;
            }

            return;
        }

        if (this.ribbon.room.ingame) return;

        if (this.ribbon.room.players.length < 2 && this.autostartTimer) {
            if (!this.twoPlayerOpponent) {
                this.ribbon.sendChatMessage("Start cancelled - waiting for players...");
            }
            clearTimeout(this.autostartTimer);
            this.autostartTimer = undefined;
        } else if (this.ribbon.room.players.length >= 2 && !this.autostartTimer) {
            if (!this.twoPlayerOpponent) {
                this.ribbon.sendChatMessage("Game starting in " + this.autostart + " seconds!");
            }
            this.autostartTimer = setTimeout(() => {
                this.start();
                this.autostartTimer = undefined;
            }, this.autostart * 1000);
        }
    }

    check2pEligibility(user) {
        if (this.twoPlayerChallenger !== user && this.twoPlayerOpponent !== user) {
            if (this.twoPlayerQueue.indexOf(user) === -1) {
                return "There is currently a queue for 1v1s in this room - type !queue to join";
            } else {
                return "Please wait to play";
            }
        }
    }

    nextChallenger() {
        if (!this.twoPlayerOpponent || this.ribbon.room.ingame) {
            return false;
        }

        this.twoPlayerChallenger = this.twoPlayerQueue.shift();

        this.ribbon.room.players.forEach(player => {
            this.ribbon.room.switchPlayerBracket(player, "spectator");
        });

        if (!this.twoPlayerChallenger) {
            this.ribbon.sendChatMessage("The 1v1 queue is empty! Type !queue to join.");
            return false;
        }

        this.ribbon.room.switchPlayerBracket(this.twoPlayerOpponent, "player");
        this.ribbon.room.switchPlayerBracket(this.twoPlayerChallenger, "player");

        this.getPlayerData(this.twoPlayerChallenger).then(playerData => {
            this.ribbon.sendChatMessage(`${playerData.username.toUpperCase()} is up next!`);
        });

        return true;
    }

    disableQueue() {
        this.twoPlayerOpponent = undefined;
        this.twoPlayerQueue = [];
        this.autostart = 0
        if (this.autostartTimer) {
            clearTimeout(this.autostartTimer);
            this.autostartTimer = undefined;
        }
        this.saveConfig();
    }

    allowPlayer(user, username) {
        this.allowedUsers.set(username.toLowerCase(), user);
    }

    unallowPlayer(username) {
        if (this.allowedUsers.has(username.toLowerCase())) {
            this.allowedUsers.delete(username.toLowerCase());
            return true;
        }
        return false;
    }

    async start() {
        clearTimeout(this.autostartTimer);
        this.autostartTimer = undefined;

        if (this.twoPlayerOpponent) {
            if (!this.twoPlayerChallenger) {
                this.nextChallenger();
            }
        } else {
            await this.recheckPlayers();
        }

        if (this.ribbon.room.players.length < 2) {
            this.ribbon.sendChatMessage("Not enough players to start.");
            return;
        }

        this.ribbon.room.start();
    }

    destroy(message) {
        this.emit("stop", message);
        this.ribbon.disconnectGracefully();
        clearTimeout(this.autostartTimer);
        clearInterval(this.timeoutInterval);
    }

    saveConfig() {
        this.emit("configchange");
    }
}

module.exports = Autohost;

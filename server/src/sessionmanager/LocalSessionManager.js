const Ribbon = require("../ribbon/Ribbon");
const Autohost = require("../autohost/Autohost");
const TournamentAutohost = require("../tournaments/TournamentAutohost");
const StreamedTournamentAutohost = require("../tournaments/StreamedTournamentAutohost");
const LoginSession = require("./LoginSession");
const redis = require("../redis/redis");
const {serialise, deserialise} = require("../redis/serialiser");
const {logMessage, LOG_LEVELS} = require("../log");
const persistlobbies = require("./persistlobbies");

const SESSION_TYPES = {
    "Autohost": Autohost,
    "TournamentAutohost": TournamentAutohost,
    "StreamedTournamentAutohost": StreamedTournamentAutohost,
    "LoginSession": LoginSession
};

class LocalSessionManager {

    constructor() {
        this.sessions = new Map();
    }

    log(message) {
        // todo: move
        logMessage(LOG_LEVELS.FINE, "LocalSessionMananger", message);
    }

    _joinOrCreate(isPrivate, code) {
        return new Promise((resolve, reject) => {
            const ribbon = new Ribbon(process.env.TOKEN);

            ribbon.once("joinroom", () => {
                ribbon.room.takeOwnership();
            });

            ribbon.on("whisper", data => {
                if (data.msg === "you have taken host of this room!") {
                    if (ribbon.room.id !== code) {
                        ribbon.room.setRoomID(code);
                    } else {
                        resolve(ribbon);
                    }
                }
            })

            ribbon.on("ok", msg => {
                if (msg === "room ID updated!") {
                    resolve(ribbon);
                }
            });

            ribbon.on("err", err => {
                if (err === "no such room") {
                    ribbon.createRoom(isPrivate);
                } else if (err === "you are already in this room") {
                    setTimeout(() => {
                        ribbon.joinRoom(code);
                    }, 5000);
                } else if (err === "not the creator of this room") {
                    reject("someone sniped our room code");
                    ribbon.disconnectGracefully();
                } else if (err === "already the host of this room") {
                    if (ribbon.room.id !== code) {
                        ribbon.room.setRoomID(code);
                    } else {
                        resolve(ribbon);
                    }
                }
            });

            ribbon.on("dead", () => {
                reject("ribbon died");
            });

            ribbon.on("ready", () => {
                ribbon.joinRoom(code);
            });
        });
    }

    _sessionSerialise(session, id) {
        const flags = [];
        if (session.persist) flags.push("persist");
        if (session.autostart) flags.push("autostart");
        if (session.ingame) flags.push("ingame");
        if (!session.someoneDidJoin) flags.push("pending timeout");
        if (session.smurfProtection) flags.push("smurf protection");

        return {
            _time: Date.now(),
            _id: id,
            type: session instanceof Autohost ? "Autohost" : (session instanceof TournamentAutohost ? "TournamentAutohost" : (session instanceof StreamedTournamentAutohost ? "StreamedTournamentAutohost" : (session instanceof LoginSession ? "LoginSession" : ""))),
            worker: workerName,
            roomID: session.roomID,
            name: session.ribbon.room?.name || "",
            host: session.host,
            private: !!session.ribbon.room?.isPrivate,
            players: session.ribbon.room?.players || [],
            spectators: session.ribbon.room?.spectators || [],
            loginComplete: session.loginComplete,
            loginOwner: session.owner,
            flags,
            rules: session.rules,
            moderators: session.moderatorUsers ? [...session.moderatorUsers.values()] : undefined,
            tournamentID: session.tournamentID,
            matchID: session.matchID,
            nudgeTimer: !!session.nudgeTimer,
            joinTimer: !!session.joinTimer,
            player1: session.player1,
            player2: session.player2
        }
    }

    _applyRibbonEvents(session, sessionID) {
        session.on("configchange", async () => {
            if (!session.persistLobby) {
                await redis.setLobby(sessionID, serialise(session));
            }
            this.report();
            this.log("Saved session data for session " + sessionID);
        });

        session.on("stop", async message => {
            session.closing = true;
            if (!session.persistLobby) {
                await redis.deleteLobby(sessionID);
            }
            this.sessions.delete(sessionID);
            logMessage(LOG_LEVELS.INFO, "LocalSessionManager", `Deleting lobby for ${sessionID} (${message})`);
            await ipc.sendAsync("X-PRIMARY", "system.lobbygone", sessionID);
        });

        session.ribbon.on("kick", ({reason}) => {
            if (reason === "this room was disbanded") {
                session.destroy("Your lobby was disbanded by TETR.IO staff.");
            }
        });

        session.ribbon.once("dead", async () => {
            if (session.closing) return;

            this.log(`Ribbon died for room ${session.roomID}, restoring...`);

            try {
                session.ribbon = await this._joinOrCreate(session.ribbon.room.isPrivate, session.roomID);
                this.log(`Re-applying ribbon events`);
                session.setup();
            } catch (e) {
                this.sessions.delete(sessionID);
                logMessage(LOG_LEVELS.ERROR, "LocalSessionManager", `Could not restore ${sessionID}: ${e}`);
            }
        });
    }

    report() {
        return ipc.sendAsync("X-PRIMARY", "system.reportlobbies", [...this.sessions].map(s => this._sessionSerialise(s[1], s[0])));
    }

    createSession(isPrivate, type, params) {
        return new Promise(resolve => {
            params = params || {};
            const ribbon = new Ribbon(process.env.TOKEN);

            const sessionID = Date.now() + "." + Math.floor(Math.random() * 10000);

            ribbon.on("joinroom", () => {
                params.ribbon = ribbon;

                const session = new SESSION_TYPES[type](params);

                session.once("ready", () => {
                    resolve(this._sessionSerialise(session, sessionID));
                });

                this.sessions.set(sessionID, session);

                session.setup();

                this._applyRibbonEvents(session, sessionID);

                this.report();
            });

            ribbon.on("ready", () => {
                ribbon.createRoom(isPrivate);
            });
        });
    }

    restoreSession(sessionID, data) {
        return new Promise((resolve, reject) => {
            if (!SESSION_TYPES.hasOwnProperty(data?.type)) return;

            const ribbon = new Ribbon(process.env.TOKEN);

            ribbon.on("joinroom", () => {
                const session = new SESSION_TYPES[data.type]({ribbon});

                deserialise(data, session);

                session.setup();

                ribbon.room.takeOwnership();

                this._applyRibbonEvents(session, sessionID);

                this.sessions.set(sessionID, session);
                this.report();

                resolve(this._sessionSerialise(session, sessionID));
            });

            let joinAttempts = 0;

            ribbon.on("err", err => {
                if (err === "no such room") {
                    reject(err);
                } else if (err === "you are already in this room") {
                    joinAttempts++;

                    if (joinAttempts > 5) {
                        reject("Couldn't get back in!");
                    }

                    this.log("Trying to join again shortly, server hasn't caught on yet.");
                    setTimeout(() => {
                        ribbon.joinRoom(data.data.roomID);
                    }, 5000);
                }
            });

            ribbon.on("ready", () => {
                ribbon.joinRoom(data.data.roomID);
            });
        });
    }

    async restoreSessions() {
        const sessionIDs = await redis.getAllLobbies();

        for (const id of sessionIDs) {
            if (await this.getSessionByID(id)) continue;

            const data = await redis.getLobby(id);
            if (!data) continue;
            try {
                this.log("Restoring session " + id);
                await this.restoreSession(id, data);
            } catch (e) {
                this.log(`Deleting session ${id} (restore failed: ${e})`);
                await redis.deleteLobby(id);
            }
        }
    }

    async getSessionByID(id) {
        const session = this.sessions.get(id);
        return session ? this._sessionSerialise(session, id) : undefined;
    }

    async destroySession(id) {
        const session = this.sessions.get(id);
        if (session) {
            session.destroy();
            this.sessions.delete(id);
        }
    }

    async inviteToSession(id, user) {
        const session = this.sessions.get(id);
        if (session) {
            session.ribbon.socialInvite(user);
        }
    }

    async getSessionByTournamentMatch(tournament, match) {
        const session = [...this.sessions].find(session => session[1].tournamentID === tournament && session[1].matchID === match);
        return session ? this._sessionSerialise(session[1], session[0]) : undefined;
    }

    async destroySessionByTournamentMatch(tournament, match) {
        let sessions;
        let matches;

        if (match instanceof Array) {
            matches = match;
        } else {
            matches = [match];
        }

        if (match) {
            sessions = [...this.sessions.values()].filter(session => session.tournamentID === tournament && matches.indexOf(session.matchID) !== -1);
        } else {
            sessions = [...this.sessions.values()].filter(session => session.tournamentID === tournament);
        }

        if (sessions.length > 0) {
            for (const session of sessions) {
                session.destroy();
            }
        }
    }

    async getSessions() {
        return [...this.sessions].map(session => this._sessionSerialise(session[1], session[0]));
    }

    async xrc(target, code) {
        let sessions;

        if (target === "X-ALL") {
            sessions = [...this.sessions.values()];
        } else if (target === "X-PERSIST") {
            sessions = [...this.sessions.values()].filter(s => s.persist);
        } else {
            sessions = [...this.sessions.values()].filter(s => s.roomID === target);
        }

        for (const autohost of sessions) {
            const callback = function (message) {
                redis.addRCEResponse(workerName, autohost.roomID, message);
            };

            try {
                eval(code);
            } catch (e) {
                callback(`Exception encountered while executing RCE.\n\n${e.message}\n\n${e.stack}`);
            }
        }
    }

    async createPersistLobbies() {
        for (const lobby of persistlobbies) {
            const sessionID = Date.now() + "." + Math.floor(Math.random() * 10000);

            try {
                const ribbon = await this._joinOrCreate(!!process.env.PERSIST_ROOMS_DISABLED, lobby.code);

                const session = new Autohost({ribbon, host: botUserID, persistLobby: lobby.id});

                session.persist = true;

                await session.setup();

                for (const opt in lobby.options) {
                    session[opt] = lobby.options[opt];
                }

                ribbon.room.setRoomConfig(lobby.config.concat({
                    index: "meta.name",
                    value: lobby.name
                }));

                this._applyRibbonEvents(session, sessionID);
                this.sessions.set(sessionID, session);

                logMessage(LOG_LEVELS.INFO, "LocalSessionManager", `Created persist lobby ${lobby.code}`);
            } catch (e) {
                logMessage(LOG_LEVELS.ERROR, "LocalSessionManager", `Could not create persist lobby ${lobby.code}: ${e}`);
            }
        }
    }
}

module.exports = LocalSessionManager;

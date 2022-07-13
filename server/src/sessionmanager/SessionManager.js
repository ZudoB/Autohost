class SessionManager {

    createSession(isPrivate, type, args) {
        return ipc.sendAsync("X-RANDOM", "lsm.createSession", [isPrivate, type, args]);
    }

    async getSessions() {
        return (await ipc.sendAsync("X-PRIMARY", "system.lobbies"));
    }

    async restoreSessions() {
        return (await ipc.sendToAll("lsm.restoreSessions"));
    }

    async getSessionByID(id) {
        return (await ipc.sendToAll("lsm.getSessionByID", id)).find(s => !!s);
    }

    async getSessionByTournamentMatch(tournament, match) {
        return (await ipc.sendToAll("lsm.getSessionByTournamentMatch", [tournament, match])).find(s => !!s);
    }

    async destroySessionByTournamentMatch(tournament, match) {
        return (await ipc.sendToAll("lsm.destroySessionByTournamentMatch", [tournament, match]));
    }

    async destroySession(session) {
        return (await ipc.sendToAll("lsm.destroySession", session));
    }

    async inviteToSession(session, user) {
        return (await ipc.sendToAll("lsm.inviteToSession", [session, user]));
    }

    async xrc(target, code) {
        return (await ipc.sendToAll("lsm.xrc", [target, code])).flat();
    }
}

module.exports = SessionManager;

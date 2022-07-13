const {
    DBTournament,
    DBParticipant,
    DBLeaderboard,
    DBTournamentLog,
    DBStreamedMatch,
    DBUser,
    DBMatch
} = require("../db/models");
const {
    TOURNAMENT_TYPES,
    TOURNAMENT_STATES,
    PUNISHMENT_TYPES,
    MATCH_STATES,
    TOURNEY_LOG_TYPES
} = require("../data/enums");
const {RANK_HIERARCHY, TOURNAMENT_CONSTANTS} = require("../data/data");
const {getUser, getNews} = require("../gameapi/api");
const mongoose = require("mongoose");
const {getBan} = require("../data/globalbans");
const {queueAddTasks} = require("../redis/redis");
const {pushNotificationBulk} = require("../api/push");
const {logMessage, LOG_LEVELS} = require("../log");
const RESTError = require("../RESTError");

class Tournament {

    constructor(dbTournament) {
        this.dbTournament = dbTournament;
    }

    log(action, actor, target, meta) {
        return DBTournamentLog.create({
            tournament: this.dbTournament._id,
            time: new Date(),
            action, actor, target, meta
        });
    }

    static async create(opts) {
        opts.state = TOURNAMENT_STATES.REGISTRATION;

        const dbTournament = await DBTournament.create(opts);

        logMessage(LOG_LEVELS.INFO, "Tournament", `Tournament ${dbTournament._id} (${dbTournament.name}) created by ${dbTournament.host}`);

        return new Tournament(dbTournament);
    }

    static async get(urlOrID) {
        let dbTournament;

        try {
            const objectID = mongoose.Types.ObjectId(urlOrID);
            dbTournament = await DBTournament.findById(objectID);
        } catch (e) {
            dbTournament = await DBTournament.findOne({url: urlOrID});
        }

        if (dbTournament) {
            return new Tournament(dbTournament);
        } else {
            throw new RESTError("Tournament not found.", 404);
        }
    }

    async delete() {
        if (this.dbTournament.frozen_reason) {
            throw new RESTError("This tournament is frozen.", 403);
        }

        this.dbTournament.frozen_reason = "pending deletion";
        await this.dbTournament.save();

        logMessage(LOG_LEVELS.INFO, "Tournament", `Tournament ${this.dbTournament._id} (${this.dbTournament.name}) is being deleted`);

        await queueAddTasks([
            {
                task: "delete",
                data: this.dbTournament._id
            }
        ]);
    }

    async rollback() {
        if (this.dbTournament.frozen_reason) {
            throw new RESTError("This tournament is frozen.", 403);
        }

        this.dbTournament.state = TOURNAMENT_STATES.ROLLBACK;
        await this.dbTournament.save();

        logMessage(LOG_LEVELS.INFO, "Tournament", `Tournament ${this.dbTournament._id} (${this.dbTournament.name}) is being rolled back`);

        await queueAddTasks([
            {
                task: "rollback",
                data: this.dbTournament._id
            }
        ]);
    }

    async createParticipant(userID) {
        if (this.dbTournament.state !== TOURNAMENT_STATES.REGISTRATION) {
            throw new RESTError("Registrations are closed.", 403);
        }

        const user = await getUser(userID);

        await DBParticipant.create({
            user: user._id,
            name: user.username,
            tournament: this.dbTournament._id,
            tr: user.league?.rating || -1,
            apm: user.league?.apm || 0,
            vs: user.league?.vs || 0,
            rank: user.league?.rank || "z",
            percentile_rank: user.league?.rank || "z",
            checked_in: false,
            disqualified: false,
            challonge_id: null
        });

        logMessage(LOG_LEVELS.INFO, "Tournament", `${user._id} (${user.username}) registered for ${this.dbTournament._id}`);

        await ipc.sendToAll("discord.applyUserRoles", userID);
    }

    async deleteParticipant(userID) {
        const participant = await DBParticipant.findOne({
            tournament: this.dbTournament._id,
            user: userID
        });

        if (!participant) {
            throw new RESTError("Participant is not registered.", 404);
        }

        if (this.dbTournament.state !== TOURNAMENT_STATES.IN_PROGRESS) {
            logMessage(LOG_LEVELS.INFO, "Tournament", `${participant.user} (${participant.name}) is being unregistered from ${this.dbTournament._id}`);
            await participant.delete(); // unregister
            await ipc.sendToAll("discord.applyUserRoles", userID);
            return true; // deleted
        } else {
            logMessage(LOG_LEVELS.INFO, "Tournament", `${participant.user} (${participant.name}) is being disqualified from ${this.dbTournament._id}`);
            // todo: dq in matches
            participant.disqualified = true; // dq
            await participant.save();
            return false; // dq'd
        }
    }

    async closeRegistration() {
        if (this.dbTournament.frozen_reason) {
            throw new RESTError("This tournament is frozen.", 403);
        }

        if (this.dbTournament.state === TOURNAMENT_STATES.REGISTRATION) {
            const participants = await DBParticipant.find({tournament: this.dbTournament._id});
            if (participants.length < 2) {
                throw new RESTError("A tournament must have at least two registered participants before registration can be closed.", 400);
            }

            logMessage(LOG_LEVELS.INFO, "Tournament", `${this.dbTournament._id} (${this.dbTournament.name}) is switching phases (registration > pre checkin)`);

            this.dbTournament.state = TOURNAMENT_STATES.PENDING_CHECK_IN;
            await this.dbTournament.save();
        } else {
            throw new RESTError("Registration is not open.", 403);
        }
    }

    async openCheckIn() {
        if (this.dbTournament.frozen_reason) {
            throw new RESTError("This tournament is frozen.", 403);
        }

        if (this.dbTournament.state !== TOURNAMENT_STATES.PENDING_CHECK_IN) {
            throw new RESTError("Check in cannot be opened in this state.", 400);
        }

        logMessage(LOG_LEVELS.INFO, "Tournament", `${this.dbTournament._id} (${this.dbTournament.name}) is switching phases (pre checkin > checkin)`);

        await pushNotificationBulk((await this.getParticipants()).map(p => p.user), {
            title: this.dbTournament.name + " is checking in!",
            body: "Check in now to secure your place in the bracket.",
            tournament: this.dbTournament._id
        });

        this.dbTournament.state = TOURNAMENT_STATES.CHECK_IN;
        this.dbTournament.save();
    }

    getParticipants() {
        return DBParticipant.find({tournament: this.dbTournament._id});
    }

    async closeCheckIn() {
        if (this.dbTournament.state !== TOURNAMENT_STATES.CHECK_IN) {
            throw new RESTError("Check in is not open.", 400);
        }

        const participants = await DBParticipant.find({tournament: this.dbTournament._id});

        if (participants.length < 2) {
            throw new RESTError("At least two participants need to be checked in before the tournament can start.", 400);
        }

        logMessage(LOG_LEVELS.INFO, "Tournament", `${this.dbTournament._id} (${this.dbTournament.name}) is switching phases (checkin > seeding)`);

        this.dbTournament.state = TOURNAMENT_STATES.SEEDING;
        await this.dbTournament.save();

        await queueAddTasks([{
            task: "seed",
            data: this.dbTournament._id
        }]);
    }

    async _checkinUserState(userID, checkedIn) {
        if (this.dbTournament.state !== TOURNAMENT_STATES.CHECK_IN) {
            throw new RESTError("Check in is not open.", 400);
        }

        const participant = await DBParticipant.findOne({
            tournament: this.dbTournament._id,
            user: userID
        });

        if (!participant) {
            throw new RESTError("Participant is not registered.", 404);
        }

        participant.checked_in = !!checkedIn;
        await participant.save();
    }

    checkInUser(userID) {
        return this._checkinUserState(userID, true);
    }

    checkOutUser(userID) {
        return this._checkinUserState(userID, false);
    }

    async start() {
        if (this.dbTournament.frozen_reason) {
            throw new RESTError("This tournament is frozen.", 403);
        }

        if (this.dbTournament.state !== TOURNAMENT_STATES.PENDING_START) {
            throw new RESTError("Cannot start the tournament in this state.", 400);
        }

        logMessage(LOG_LEVELS.INFO, "Tournament", `${this.dbTournament._id} (${this.dbTournament.name}) is switching phases (prestart > starting)`);

        this.dbTournament.state = TOURNAMENT_STATES.STARTING;
        await this.dbTournament.save();

        await queueAddTasks([
            {
                task: "tournament_start",
                data: this.dbTournament._id
            }
        ]);
    }

    async checkCompletionState() {
        // if (this.dbTournament.state !== TOURNAMENT_STATES.IN_PROGRESS) {
        //     // we shouldn't change states if we're not currently running
        //     return;
        // }

        // todo: complete

        // const matches = await getAllMatches(this.dbTournament.native_url);
        //
        // if (matches.every(m => m.state === "complete")) { // if this is the last match to be completed, swap state
        //     this.dbTournament.state = TOURNAMENT_STATES.MATCHES_COMPLETE;
        //     this.dbTournament.save();
        // }
    }

    async reportMatchScore(matchID, player1score, player2score, winner) {
        if (this.dbTournament.state !== TOURNAMENT_STATES.IN_PROGRESS) {
            throw new RESTError("Tournament state invalid", 400);
        }

        await this.closeInvalidMatches();

        await queueAddTasks([{
            task: "report_score",
            data: {
                tournament: this.dbTournament._id,
                args: [this.dbTournament.native_url, matchID, player1score, player2score, winner?.challonge_id]
            }
        }]);
    }

    async finaliseScores() {
        await this.closeInvalidMatches();

        // todo: fix

        // // finalise scores on challongeœ
        // await endTournament(this.dbTournament.native_url);
        //
        // // get the challonge participants inc their final ranks
        // const participants = await getParticipants(this.dbTournament.native_url);
        //
        // for (const participant of participants) {
        //     await DBParticipant.updateOne({
        //         challonge_id: participant.id,
        //         tournament: this.dbTournament._id
        //     }, {
        //         position: participant.final_rank
        //     });
        // }

        this.dbTournament.state = TOURNAMENT_STATES.TOURNAMENT_COMPLETE;
        this.dbTournament.save();
    }

    async initLobby(match) {
        if (this.dbTournament.state !== TOURNAMENT_STATES.IN_PROGRESS) {
            throw new RESTError("The tournament hasn't started yet.", 400);
        }

        if (match.state !== "open") {
            throw new RESTError("Match pending or already finished, contact staff.", 400);
        }

        const existingLobby = await sessionManager.getSessionByTournamentMatch(this.dbTournament._id, match.id);

        if (existingLobby) {
            return existingLobby;
        }

        return await sessionManager.createSession(true, "TournamentAutohost", {
            match
        });
    }

    async getStreamLobby() {
        throw new RESTError("not yet implemented", 502);
    }

    async addStaff(user, role) {
        if (this.dbTournament.staff.find(staff => staff.user === user)) {
            throw new RESTError("This user is already staff for this tournament.", 400);
        }

        const userBan = await getBan(user, [PUNISHMENT_TYPES.HOST_BLOCK, PUNISHMENT_TYPES.TOURNAMENT_BLOCK]);

        if (!userBan) {
            logMessage(LOG_LEVELS.INFO, "Tournament", `${user} is being added to staff for ${this.dbTournament._id}`);

            this.dbTournament.staff.push({user, role});
            await this.dbTournament.save();
        } else {
            logMessage(LOG_LEVELS.WARNING, "Tournament", `Rejecting ${user} from a tournament staff role: ${userBan.type} - ${userBan.reason}`);
            throw new RESTError("User is not eligible to staff this tournament.", 403);
        }
    }

    async removeStaff(user) {
        const idx = this.dbTournament.staff.findIndex(staff => staff.user === user);

        if (idx === -1) {
            throw new RESTError("Staff member not found.", 404);
        }

        logMessage(LOG_LEVELS.INFO, "Tournament", `${user} is being removed from staff for ${this.dbTournament._id}`);

        this.dbTournament.staff.splice(idx, 1);

        await this.dbTournament.save();
    }

    async isMod(user) {
        const profile = await DBUser.findOne({tetrio_id: user});
        if (profile?.roles?.developer) return true;

        return user === this.dbTournament.host || !!this.dbTournament.staff.find(staff => staff.role === "moderator" && staff.user === user);
    }

    async checkEligibility(user) {
        let profile;
        let rankKey;
        let pastTense = false;

        const bans = await getBan(user, [PUNISHMENT_TYPES.TOURNAMENT_BLOCK, PUNISHMENT_TYPES.HOST_BLOCK]);

        if (bans) {
            return {
                eligible: false,
                reason: "You are banned from participating in tournaments."
            }
        }

        if (this.dbTournament.discord.enforce_membership) {
            const dbUser = await DBUser.findOne({tetrio_id: user});

            if (!dbUser.discord_id) {
                return {
                    eligible: false,
                    reason: "You must have a linked Discord account to take part in this tournament. Please link your account and try again.",
                    cta: {
                        url: "/settings/discord",
                        router: true,
                        caption: "Link Account"
                    }
                }
            }

            if (!(await ipc.sendToAll("discord.isMemberPresent", [this.dbTournament.discord.guild, dbUser.discord_id])).find(p => !!p)) {
                const invite = (await ipc.sendToAll("discord.createInvite", this.dbTournament.discord.guild)).find(p => !!p);

                if (!invite) {
                    return {
                        eligible: false,
                        reason: "You must join the Discord server for this tournament before you can register."
                    }
                }

                return {
                    eligible: false,
                    reason: "You must join the Discord server for this tournament before you can register.",
                    cta: {
                        url: "https://discord.gg/" + invite,
                        router: false,
                        caption: "Join Discord"
                    }
                }
            }
        }

        if (this.dbTournament.leaderboard) {
            rankKey = "rank";
            pastTense = true;
            const lb = await DBLeaderboard.findById(this.dbTournament.leaderboard);
            if (!lb || !lb.ready) {

                if (this.dbTournament.host === user) {
                    return {
                        eligible: false,
                        reason: "The leaderboard snapshot is being processed. Please wait a few minutes before trying again. If this message persists, contact the developer."
                    }
                } else {
                    return {
                        eligible: false,
                        reason: "Registration isn't ready yet, check back in a few minutes."
                    }
                }
            }

            profile = lb.leaderboard.find(u => u._id === user);

            if (!profile) {
                return {
                    eligible: false,
                    reason: "You were not ranked on this tournament's announcement date."
                }
            }
        } else {
            rankKey = "percentile_rank";
            profile = await getUser(user);
        }


        if (this.dbTournament.require_calibration && profile.league[rankKey] === "z") {
            return {
                eligible: false,
                reason: "You haven't completed your 10 calibration matches yet."
            };
        }

        if (this.dbTournament.require_rank && profile.league[rankKey] === "z") {
            return {
                eligible: false,
                reason: "You don't have a confirmed rank (RD > 100)."
            };
        }

        if (RANK_HIERARCHY.indexOf(this.dbTournament.rank_limit.max) < RANK_HIERARCHY.indexOf(profile.league[rankKey])) {
            return {
                eligible: false,
                reason: `Your rank ${pastTense ? "was" : "is"} too high ${pastTense ? "on this tournament's announcement date" : "for this tournament"}.`
            };
        }

        if (profile.league[rankKey] !== "z" && RANK_HIERARCHY.indexOf(this.dbTournament.rank_limit.min) > RANK_HIERARCHY.indexOf(profile.league[rankKey])) {
            return {
                eligible: false,
                reason: `Your rank ${pastTense ? "was" : "is"} too low ${pastTense ? "on this tournament's announcement date" : "for this tournament"}.`
            };
        }

        if (this.dbTournament.historical_max !== "x") {
            const news = (await getNews(user)).filter(n => n.type === "rankup");

            for (const entry of news) {
                if (RANK_HIERARCHY.indexOf(entry.data.rank) > RANK_HIERARCHY.indexOf(this.dbTournament.historical_max)) {
                    return {
                        eligible: false,
                        reason: `Players who have achieved ranks higher than ${this.dbTournament.historical_max.toUpperCase()} in the past are not eligible for this tournament.`
                    }
                }
            }
        }

        return {
            eligible: true
        };
    }

    async getMatches() {
        return DBMatch.find({tournament: this.dbTournament._id});
    }

    async getMatch(matchID) {
        return DBMatch.findOne({
            _id: matchID,
            tournament: this.dbTournament._id
        });
    }

    async getUserMatches(userID) {
        const participant = await DBParticipant.findOne({user: userID});
        if (!participant) return [];
        return DBMatch.find({
            tournament: this.dbTournament._id,
            $or: [{player1: participant._id}, {player2: participant._id}]
        });
    }

    async updateMatchStates() {
        const matches = await this.getMatches();

        logMessage(LOG_LEVELS.INFO, "Tournament", `Updating match states for ${this.dbTournament._id}`);

        const pendingMatches = matches.filter(m => m.state === MATCH_STATES.PENDING);
        const openMatches = matches.filter(m => m.state === MATCH_STATES.OPEN);

        for (const match of openMatches) {
            if (match.opened_at && Date.now() >= (match.opened_at.getTime() + TOURNAMENT_CONSTANTS.MATCH_TIMEOUT_DURATION)) {
                const participant1 = await DBParticipant.findById(match.player1);
                const participant2 = await DBParticipant.findById(match.player2);

                const session = await sessionManager.getSessionByTournamentMatch(match.tournament, match._id);

                const p1Present = !!(session && (session.players.indexOf(participant1.user) !== -1 || session.spectators.indexOf(participant1.user) !== -1));
                const p2Present = !!(session && (session.players.indexOf(participant2.user) !== -1 || session.spectators.indexOf(participant2.user) !== -1));

                if (p1Present && !p2Present) {
                    match.p1score = 1;
                    match.p2score = 0;
                    participant2.disqualified = true;
                    await participant2.save();
                    await this.log(TOURNEY_LOG_TYPES.REPORT_SCORES, botUserID, match._id, "1-0");
                    await this.log(TOURNEY_LOG_TYPES.DISQUALIFY, botUserID, participant2.user, "no-show");
                } else if (p2Present && !p1Present) {
                    match.p2score = 1;
                    match.p1score = 0;
                    participant1.disqualified = true;
                    await participant1.save();
                    await this.log(TOURNEY_LOG_TYPES.REPORT_SCORES, botUserID, match._id, "0-1");
                    await this.log(TOURNEY_LOG_TYPES.DISQUALIFY, botUserID, participant1.user, "no-show");
                } else if (p1Present && p2Present) {
                    // todo: force-start match if it's not already in progress
                    continue;
                } else {
                    participant1.disqualified = true;
                    participant2.disqualified = true;
                    await participant1.save();
                    await participant2.save();
                    await this.log(TOURNEY_LOG_TYPES.DISQUALIFY, botUserID, participant1.user, "no-show");
                    await this.log(TOURNEY_LOG_TYPES.DISQUALIFY, botUserID, participant2.user, "no-show");
                }

                if (session) {
                    await sessionManager.destroySession(session._id);
                }

                logMessage(LOG_LEVELS.FINE, "Tournament", `${match._id} timed out. p1 present = ${p1Present}, p2 present = ${p2Present}`);

                match.state = MATCH_STATES.COMPLETE;
                await match.save();
            }
        }

        for (const match of pendingMatches) {
            // start initial matches
            if (match.dependencies.length === 0) {
                logMessage(LOG_LEVELS.FINE, "Tournament", `Match ${match._id} has no dependencies, opening`);
                match.state = MATCH_STATES.OPEN;
                match.opened_at = new Date();
                await match.save();
                continue;
            }

            // start matches where prerequisites are complete
            let depsComplete = 0;
            for (const depID of match.dependencies) {
                const match = matches.find(m => m._id.toString() === depID.toString());
                if (match.state === MATCH_STATES.COMPLETE) depsComplete++;
            }

            if (depsComplete !== match.dependencies.length) {
                continue;
            }

            logMessage(LOG_LEVELS.FINE, "Tournament", `All ${depsComplete} prerequisite matches for are complete ${match._id}, changing states`);
            match.state = MATCH_STATES.OPEN;
            match.opened_at = new Date();


            const m1 = match.dependencies[0] && matches.find(m => m._id.toString() === match.dependencies[0].toString());
            const m2 = match.dependencies[1] && matches.find(m => m._id.toString() === match.dependencies[1].toString());

            if (m1 && m2) {
                // todo: this is dumb!
                const m1winner = (m1.p1score > m1.p2score) ? m1.player1 : (m1.p1score < m1.p2score) ? m1.player2 : undefined;
                const m2winner = (m2.p1score > m2.p2score) ? m2.player1 : (m2.p1score < m2.p2score) ? m2.player2 : undefined;

                match.player1 = m1winner;
                match.player2 = m2winner;
            } else if (m1) {
                // bracket reset... i guess?
                match.player1 = m1.player1;
                match.player2 = m1.player2;
            }

            console.log(match);

            if (!match.player1) {
                logMessage(LOG_LEVELS.FINE, "Tournament", `${match._id} was closed in favour of player 2 since there was no player 1`);
                await this.log(TOURNEY_LOG_TYPES.REPORT_SCORES, botUserID, match._id, "0-1");
                match.p1score = 0;
                match.p2score = 1;
                match.state = MATCH_STATES.COMPLETE;
            } else if (!match.player2) {
                logMessage(LOG_LEVELS.FINE, "Tournament", `${match._id} was closed in favour of player 1 since there was no player 2`);
                await this.log(TOURNEY_LOG_TYPES.REPORT_SCORES, botUserID, match._id, "1-0");
                match.p1score = 1;
                match.p2score = 0;
                match.state = MATCH_STATES.COMPLETE;
            }

            await match.save();
        }
    }

    async closeInvalidMatches() {
        throw new RESTError("Not yet implemented", 502);
    }

    async closeAllMatches() {
        await sessionManager.destroySessionByTournamentMatch(this.dbTournament._id);
    }

    markMatchAsStreamed(match) {
        return DBStreamedMatch.create({tournament: this.dbTournament._id, match: parseInt(match)});
    }

    unmarkMatchAsStreamed(match) {
        return DBStreamedMatch.deleteOne({tournament: this.dbTournament._id, match: parseInt(match)});
    }

    async reopenMatch(match) {
        // todo
        await this.closeInvalidMatches();
    }

    // noinspection JSUnusedGlobalSymbols
    toJSON() {
        return this.dbTournament.toJSON();
    }
}


module.exports = Tournament;

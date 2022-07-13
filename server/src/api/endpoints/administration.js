const {Router, json} = require("express");
const {
    DBLog, DBUser, DBNotification, DBSubscription, DBTournament, DBParticipant, DBLeaderboard, DBPreset,
    DBTournamentLog
} = require("../../db/models");
const {auth, requireDeveloper, getUserToken, requireModerator} = require("../auth");
const {getUser} = require("../../gameapi/api");
const {pushNotification} = require("../push");
const {loadavg} = require("os");
const {logMessage, LOG_LEVELS} = require("../../log");
const redis = require("../../redis/redis");

module.exports = function () {
    const app = Router();

    app.get("/stats", auth, requireModerator, async (req, res) => {
        const users = await DBUser.estimatedDocumentCount();
        const tournaments = await DBTournament.estimatedDocumentCount();
        const notifications = await DBNotification.estimatedDocumentCount();
        const participants = await DBParticipant.estimatedDocumentCount();
        const leaderboards = await DBLeaderboard.estimatedDocumentCount();
        const subscriptions = await DBSubscription.estimatedDocumentCount();
        const presets = await DBPreset.estimatedDocumentCount();
        const tournamentlogs = await DBTournamentLog.estimatedDocumentCount();

        const workers = await ipc.sendAsync("X-PRIMARY", "ipc.getWorkerStatuses");

        const graphs = await ipc.sendAsync("X-PRIMARY", "system.stats");

        res.json({
            users,
            tournaments,
            notifications,
            participants,
            leaderboards,
            subscriptions,
            presets,
            tournamentlogs,
            graphs,
            load: loadavg(),
            uptime: process.uptime(),
            workers
        });
    });

    app.get("/logs", auth, requireDeveloper, async (req, res) => {
        const skip = parseInt(req.query.skip) || 0;
        const logs = await DBLog.find({level: {$gte: req.query.level}}, {}, {limit: 100, skip}).sort({time: -1});

        res.json({logs});
    });

    app.post("/impersonate", auth, requireDeveloper, json(), async (req, res) => {
        const user = await getUser(req.body.user);
        if (!user) {
            return res.status(404).json({error: "User not found."});
        }

        const token = await getUserToken(user._id);
        res.json({token});
    });

    app.post("/forcejoin/:room", auth, requireDeveloper, async (req, res) => {
        try {
            res.json({success: "Force-joined " + req.params.room + "."});
        } catch (e) {
            res.status(500).json({error: "Failed to force-join: " + e});
        }
    });

    app.post("/xrc", auth, requireDeveloper, json(), async (req, res) => {
        await sessionManager.xrc(req.body.context, req.body.code);
        res.json({success: "RCE sent."});
    });

    app.get("/xrc", auth, requireDeveloper, json(), async (req, res) => {
        const responses = await redis.getRCEResponses();
        res.json({responses: responses});
    });

    app.delete("/xrc", auth, requireDeveloper, json(), async (req, res) => {
        await redis.deleteRCEResponses();
        res.json({success: "Cleared RCE responses."});
    });

    app.post("/dispatch", auth, requireDeveloper, json(), async (req, res) => {
        const payload = {
            title: req.body.title,
            body: req.body.body,
            tournament: req.body.tournament,
            urgent: !!req.body.urgent,
            component: req.body.component
        };

        const users = await DBUser.find();

        for (const user of users) {
            try {
                await pushNotification(user.tetrio_id, payload);
            } catch (e) {
                res.status(500).json({error: e.toString()});
                return;
            }
        }

        res.json({success: `Pushed ${users.length} notifications.`});
    });

    app.post("/maintenance/:task", auth, requireDeveloper, async (req, res) => {
        switch (req.params.task) {
            case "notifs_all": {
                const result = await DBNotification.deleteMany();
                res.json({success: `Deleted ${result.deletedCount} notifications.`});
                break;
            }
            case "notifs_expired": {
                const result = await DBNotification.deleteMany({time: {$lte: new Date(Date.now() - 2592000000)}});
                res.json({success: `Deleted ${result.deletedCount} notifications.`});
                break;
            }
            case "subs": {
                const result = await DBSubscription.deleteMany();
                res.json({success: `Deleted ${result.deletedCount} subscriptions.`});
                break;
            }
            case "kill_orphans": {
                const tournaments = await DBTournament.find();

                // erase orphaned participants
                const tournamentIDs = await tournaments.map(t => t._id);
                const participantResult = await DBParticipant.deleteMany({tournament: {$nin: tournamentIDs}});

                // erase orphaned leaderboards
                const safeLeaderboards = await tournaments.map(t => t.leaderboard).filter(t => !!t);
                const leaderboardResult = await DBLeaderboard.deleteMany({_id: {$nin: safeLeaderboards}});

                // erase orphaned events
                const logResult = await DBTournamentLog.deleteMany({tournament: {$nin: tournamentIDs}});

                res.json({success: `Deleted ${participantResult.deletedCount} orphaned participants, ${leaderboardResult.deletedCount} orphaned leaderboards, ${logResult.deletedCount} orphaned events.`});

                break;
            }
            default:
                return res.status(404).json({error: "Unknown maintenance task."})
        }

        logMessage(LOG_LEVELS.INFO, "Admin", "Executed maintenance task " + req.params.task);
    });

    app.get("/account", auth, requireModerator, async (req, res) => {
        const seen = await DBUser.find({}, {
            seen: true,
            tetrio_id: true,
            last_name: true
        }).sort({seen: -1}).limit(50).exec();
        const created = await DBUser.find({}, {
            created: true,
            tetrio_id: true,
            last_name: true
        }).sort({_id: -1}).limit(50).exec();
        res.json({seen, created});
    });

    app.get("/account/:user", auth, requireModerator, async (req, res) => {
        const profile = await getUser(req.params.user);
        if (!profile) {
            return res.status(404).json({error: "TETR.IO user not found."});
        }

        const projection = {
            tetrio_id: true,
            created: true,
            seen: true,
            discord_id: true,
            discord_tag: true,
            roles: true,
            last_name: true,
        };

        if (req.user.roles.developer) {
            projection["ip"] = true;
        }

        const user = await DBUser.findOne({tetrio_id: profile._id}, projection);

        if (!user) {
            return res.status(404).json({error: "Profile not found. Either they've never logged in, or the account was deleted."});
        }

        res.json({user});
    });

    app.post("/account/:id/roles", auth, requireModerator, json(), async (req, res) => {
        const user = await DBUser.findOne({tetrio_id: req.params.id});

        if (!user) {
            return res.status(404).json({error: "User not found."});
        }

        if (req.body.hasOwnProperty("moderator") && !req.user.roles.developer) {
            delete req.body.moderator; // don't allow changes
        }

        if (req.body.hasOwnProperty("moderator")) user.roles.moderator = !!req.body.moderator;
        if (req.body.hasOwnProperty("partner")) user.roles.partner = !!req.body.partner;
        if (req.body.hasOwnProperty("supporter")) user.roles.supporter = !!req.body.supporter;

        await user.save();

        logMessage(LOG_LEVELS.INFO, "Admin", `${req.tetrioID} updated user roles for ${req.params.id}`);
        res.json({success: "Updated user roles."});
    });

    app.post("/account/:id/invalidate", auth, requireModerator, async (req, res) => {
        const user = await DBUser.findOne({tetrio_id: req.params.id});

        if (!user) {
            return res.status(404).json({error: "User not found."});
        }

        user.token_cycle++;

        await user.save();

        logMessage(LOG_LEVELS.INFO, "Admin", `${req.tetrioID} cycled tokens for ${req.params.id}`);
        res.json({success: "Invalidated all session tokens."});
    });

    return app;
}

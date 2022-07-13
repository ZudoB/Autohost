const {getUser} = require("../../gameapi/api");
const {Router, json} = require("express");
const {body, validationResult} = require("express-validator");
const {TOURNAMENT_TYPES, PUNISHMENT_TYPES, TOURNAMENT_STATES, TOURNEY_LOG_TYPES} = require("../../data/enums");
const {auth, disallowBlocked, requireDeveloper, requireModerator} = require("../auth");
const Tournament = require("../../tournaments/Tournament");
const slowDown = require("express-slow-down");
const {DISALLOWED_URLS, RANK_HIERARCHY} = require("../../data/data");
const {DBTournament, DBParticipant, DBLeaderboard, DBTournamentLog, DBDispute} = require("../../db/models");
const mongoose = require("mongoose");
const {parseSet} = require("../../ribbon/configparser");
const {queueAddTasks} = require("../../redis/redis");
const {pushNotification} = require("../push");
const {createChatToken} = require("../chat/chat");

const ALPHABET = "bcdfghjklmnpqrstvwxyz0123456789";

function codeGenerator() {
    let str = "";
    for (let i = 0; i < 10; i++) {
        str += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return str;
}

async function tournamentSettingsPostValidationMiddleware(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({errors: errors.array()});
    }

    const {
        url,
        partnered,
        leaderboard_dump,
        max_participants,
        image,
        brand_colour,
        type
    } = req.body;

    if ((url || image !== "autohost.png" || brand_colour !== "#4dba87" || leaderboard_dump || partnered) && !req.user.roles.partner) {
        return res.status(403).json({error: "You do not have permission to use partner-exclusive features."});
    }

    const MAXPCAP = type === TOURNAMENT_TYPES.ROUND_ROBIN ? 40 : (req.user.roles.partner ? 512 : 256);
    if (max_participants > MAXPCAP) {
        return res.status(400).json({error: `Participant count must be less than or equal to ${MAXPCAP}.`});
    }

    if (DISALLOWED_URLS.indexOf(url) !== -1) {
        return res.status(400).json({error: "You cannot use that custom URL, sorry."});
    }

    next();
}

const tournamentSettingsValidation = [
    body("name").isLength({
        min: 3,
        max: 100
    }).withMessage("Tournament name must be between 3 and 100 characters long."),
    body("summary").isLength({min: 3, max: 200}).withMessage("Summary must be between 3 and 200 characters long."),
    body("description").isString().withMessage("Description is required."),
    body("shortname").matches(/^[a-zA-Z0-9 ]*$/).isLength({
        min: 3,
        max: 16
    }).withMessage("Short name must be between 3 and 16 characters long, and only contain alphanumeric characters and spaces."),
    body("partnered").isBoolean().default(false),
    body("url").optional({checkFalsy: true}).matches(/^[a-zA-Z0-9_]{3,16}$/).withMessage("Custom URL must be between 3 and 16 characters long, and must only contain letters, numbers and underscores."),
    body("type").isIn(Object.keys(TOURNAMENT_TYPES)).withMessage("Tournament type is not valid."),
    body("ft").isInt({min: 1, max: 99}).withMessage("FT value must be between 1 and 99."),
    body("wb").isInt({min: 1, max: 99}).withMessage("WB value must be between 1 and 99."),
    body("lategame_ft").isInt({min: 1, max: 99}).withMessage("Late FT value must be between 1 and 99."),
    body("lategame_wb").isInt({min: 1, max: 99}).withMessage("Late WB value must be between 1 and 99."),
    body("lategame").isInt({
        min: 2,
        max: 256
    }).custom(value => (value % 2 === 0)).withMessage("Later match definition should be a multiple of 2, and be between 2 and 256"),
    body("config").custom(value => !!parseSet(value)),
    body("rank_limit_min").isIn(RANK_HIERARCHY).withMessage("Rank limit is not valid."), // todo: validate ranks
    body("rank_limit_max").isIn(RANK_HIERARCHY).withMessage("Rank limit is not valid."), // todo: validate ranks
    body("historical_max").isIn(RANK_HIERARCHY).withMessage("Historical max is not valid."),
    body("require_calibration").isBoolean().withMessage("Calibration requirement is not valid."),
    body("require_rank").isBoolean().withMessage("Rank requirement is not valid."),
    body("leaderboard_dump").isBoolean().withMessage("Leaderboard dump setting is not valid."),
    body("seeding").isIn(["tr", "vs", "apm"]).withMessage("Invalid seeding type."),
    body("max_participants").isInt({min: 4}).withMessage("Participant count must be greater than or equal to 4."),
    body("start_at").isISO8601().withMessage("Start date is not valid."),
    body("image").optional().default("autohost.png"), // todo: validate image
    body("brand_colour").optional().default("#4dba87"), // todo: validate brand colour,
    body("is_private").optional().isBoolean().default(false),
    body("discord_guild").optional().isString(),
    body("discord_role").optional().isString(),
    body("discord_enforce").optional().isBoolean().default(false),
    body("roomcode").optional().matches(/^[A-Z0-9]{1,12}$/),
    tournamentSettingsPostValidationMiddleware
];

module.exports = function () {
    const app = Router();

    const stateChangeRateLimit = slowDown({
        windowMs: 900000, // 15 minutes
        delayAfter: 5,
        delayMs: 100,
        keyGenerator(req) {
            return req.tetrioID
        }
    });

    app.get("/", (req, res, next) => {
        if (req.query.mine || req.query.frozen) {
            auth(req, res, next);
        } else {
            next();
        }
    }, async (req, res) => {
        let query = {
            $and: [{frozen_reason: null}]
        };

        if (req.query.frozen) {
            query = {frozen_reason: {$ne: null}};
        } else if (req.query.mine) {
            const tournaments = (await DBParticipant.find({user: req.tetrioID})).map(t => t.tournament);
            query.$and.push({
                $or: [
                    {_id: {$in: tournaments}},
                    {host: req.tetrioID}
                ]
            });
        } else {
            query.$and.push({
                $or: [
                    {private: false},
                    {private: null}
                ]
            });
        }

        const tournaments = await DBTournament.find(query, {
            name: true,
            summary: true,
            url: true,
            state: true,
            partnered: true,
            host: true,
            rank_limit: true,
            start_at: true,
            frozen_reason: true
        }).sort({
            start_at: 1
        }).exec();

        res.json({tournaments});
    });

    // noinspection JSCheckFunctionSignatures (shut the fuck up)
    app.post("/",
        auth,
        disallowBlocked,
        json(),
        ...tournamentSettingsValidation,
        async (req, res) => {
            const {
                name,
                url,
                shortname,
                summary,
                description,
                partnered,
                type,
                ft,
                wb,
                lategame,
                lategame_ft,
                lategame_wb,
                config,
                rank_limit_min,
                rank_limit_max,
                historical_max,
                require_rank,
                require_calibration,
                leaderboard_dump,
                seeding,
                start_at,
                max_participants,
                image,
                brand_colour,
                is_private,
                discord_guild,
                discord_role,
                discord_enforce,
                roomcode
            } = req.body;

            let realURL = url;

            if (!realURL) {
                realURL = codeGenerator();
            }

            let leaderboard = undefined;

            if (leaderboard_dump) {
                const leaderboardObject = await DBLeaderboard.create({ready: false});
                leaderboard = leaderboardObject._id;

                await queueAddTasks([{
                    task: "leaderboard",
                    data: leaderboard
                }]);
            }

            try {
                const tournament = await Tournament.create({
                    host: req.tetrioID,
                    partnered,
                    name,
                    url: realURL,
                    shortname,
                    summary,
                    description,
                    type,
                    ft,
                    wb,
                    lategame: {
                        definition: lategame,
                        ft: lategame_ft,
                        wb: lategame_wb
                    },
                    config,
                    historical_max,
                    rank_limit: {
                        min: rank_limit_min,
                        max: rank_limit_max
                    },
                    seeding,
                    require_rank,
                    require_calibration,
                    start_at,
                    max_participants,
                    image,
                    leaderboard,
                    brand_colour,
                    private: is_private,
                    discord: {
                        guild: discord_guild,
                        role: discord_role,
                        enforce_membership: discord_enforce
                    },
                    roomcode
                });

                await tournament.log(TOURNEY_LOG_TYPES.CREATE, req.tetrioID);

                res.json(tournament);
            } catch (e) {
                res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
            }
        });

    // noinspection JSCheckFunctionSignatures
    app.patch("/:tournament", auth, disallowBlocked, json(), ...tournamentSettingsValidation,
        async (req, res) => {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!req.user.roles.developer && tournament.dbTournament.host !== req.tetrioID) {
                res.status(403).json({error: "You are not the host of this tournament."});
                return;
            }

            if (tournament.dbTournament.state !== TOURNAMENT_STATES.REGISTRATION) {
                res.status(400).json({error: "Tournament cannot be modified in this state."});
                return;
            }

            const {
                name,
                shortname,
                summary,
                description,
                partnered,
                ft,
                wb,
                lategame,
                lategame_ft,
                lategame_wb,
                config,
                rank_limit_min,
                rank_limit_max,
                historical_max,
                require_rank,
                require_calibration,
                start_at,
                max_participants,
                image,
                brand_colour,
                is_private,
                discord_guild,
                discord_role,
                discord_enforce,
                roomcode
            } = req.body;

            tournament.dbTournament.name = name;
            tournament.dbTournament.shortname = shortname;
            tournament.dbTournament.summary = summary;
            tournament.dbTournament.description = description;
            tournament.dbTournament.partnered = partnered;
            tournament.dbTournament.ft = ft;
            tournament.dbTournament.wb = wb;
            tournament.dbTournament.lategame.definition = lategame;
            tournament.dbTournament.lategame.ft = lategame_ft;
            tournament.dbTournament.lategame.wb = lategame_wb;
            tournament.dbTournament.config = config;
            tournament.dbTournament.rank_limit.min = rank_limit_min;
            tournament.dbTournament.rank_limit.max = rank_limit_max;
            tournament.dbTournament.historical_max = historical_max;
            tournament.dbTournament.require_rank = require_rank;
            tournament.dbTournament.require_calibration = require_calibration;
            tournament.dbTournament.start_at = start_at;
            tournament.dbTournament.max_participants = max_participants;
            tournament.dbTournament.image = image;
            tournament.dbTournament.brand_colour = brand_colour;
            tournament.dbTournament.private = is_private;
            tournament.dbTournament.discord.guild = discord_guild;
            tournament.dbTournament.discord.role = discord_role;
            tournament.dbTournament.discord.enforce_membership = discord_enforce;
            tournament.dbTournament.roomcode = roomcode;

            await tournament.dbTournament.save();

            await tournament.log(TOURNEY_LOG_TYPES.EDIT, req.tetrioID);

            return res.json({success: "Tournament updated."});
        });

    app.get("/:tournament", async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);
            if (tournament.dbTournament.frozen_reason) {
                return res.status(403).json({error: `This tournament has been removed by a moderator (${tournament.dbTournament.frozen_reason})`});
            }
            res.json({tournament});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.get("/:tournament/statecheck", async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (tournament.dbTournament.state === req.query.state) {
                if (tournament.dbTournament.state === TOURNAMENT_STATES.IN_PROGRESS) {
                    try {
                        const matches = await tournament.getMatches(true);

                        if (matches.filter(m => m.state === "complete").length !== parseInt(req.query.complete)) {
                            return res.status(205).end(); // reset content
                        }
                    } catch {
                        // ignore
                    }
                }

                return res.status(204).end(); // no content
            } else {
                res.status(205).end(); // reset content
            }
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.delete("/:tournament", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!req.user.roles.developer && tournament.dbTournament.host !== req.tetrioID) {
                return res.status(403).json({error: "You are not the host of this tournament."});
            }

            await tournament.log(TOURNEY_LOG_TYPES.DELETE, req.tetrioID);

            await tournament.delete();

            res.json({success: "Tournament deleted."});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/rollback", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!req.user.roles.developer && tournament.dbTournament.host !== req.tetrioID) {
                return res.status(403).json({error: "You are not the host of this tournament."});
            }

            await tournament.log(TOURNEY_LOG_TYPES.ROLLBACK, req.tetrioID);

            await tournament.rollback();

            res.json({success: "Rollback started."});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.get("/:tournament/participant", async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            res.json({participants: await tournament.getParticipants()});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/participant", stateChangeRateLimit, auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            const eligibility = await tournament.checkEligibility(req.tetrioID);

            if (eligibility.eligible) {
                await tournament.createParticipant(req.tetrioID);
                await tournament.log(TOURNEY_LOG_TYPES.REGISTER_SELF, req.tetrioID);
                res.json({success: `You are now registered for the tournament.`});
            } else {
                res.status(403).json({error: eligibility.reason});
            }
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.delete("/:tournament/participant", stateChangeRateLimit, auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            await tournament.deleteParticipant(req.tetrioID);
            await tournament.log(TOURNEY_LOG_TYPES.UNREGISTER_SELF, req.tetrioID);

            res.json({success: `You are no longer registered for the tournament.`});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.delete("/:tournament/participant/:participant", stateChangeRateLimit, auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!(await tournament.isMod(req.tetrioID))) {
                return res.status(403).json({error: "Only tournament moderators can remove participants."});
            }

            if (await tournament.deleteParticipant(req.params.participant)) {
                await tournament.log(TOURNEY_LOG_TYPES.UNREGISTER_OTHER, req.tetrioID, req.params.participant);
            } else {
                await tournament.log(TOURNEY_LOG_TYPES.DISQUALIFY, req.tetrioID, req.params.participant);
            }

            res.json({success: `Participant removed.`});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/checkin", stateChangeRateLimit, auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            await tournament.checkInUser(req.tetrioID);
            await tournament.log(TOURNEY_LOG_TYPES.CHECK_IN_SELF, req.tetrioID);

            res.json({success: `You are now checked in for the tournament.`});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.delete("/:tournament/checkin", stateChangeRateLimit, auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            await tournament.checkOutUser(req.tetrioID);
            await tournament.log(TOURNEY_LOG_TYPES.CHECK_OUT_SELF, req.tetrioID);

            res.json({success: `You are now checked out from the tournament.`});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/close-registration", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!req.user.roles.developer && tournament.dbTournament.host !== req.tetrioID) {
                return res.status(403).json({error: "You are not the host of this tournament."});
            }

            await tournament.closeRegistration();
            await tournament.log(TOURNEY_LOG_TYPES.CLOSE_REGISTRATION, req.tetrioID);
            res.json({success: "Registration has been closed."});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/open-checkin", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!req.user.roles.developer && tournament.dbTournament.host !== req.tetrioID) {
                return res.status(403).json({error: "You are not the host of this tournament."});
            }

            await tournament.openCheckIn();
            await tournament.log(TOURNEY_LOG_TYPES.OPEN_CHECK_IN, req.tetrioID);
            res.json({success: "Check in has been opened."});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/close-checkin", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!req.user.roles.developer && tournament.dbTournament.host !== req.tetrioID) {
                return res.status(403).json({error: "You are not the host of this tournament."});
            }

            await tournament.closeCheckIn();
            await tournament.log(TOURNEY_LOG_TYPES.CLOSE_CHECK_IN, req.tetrioID);
            res.json({success: "Check in has been closed."});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/start", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!req.user.roles.developer && tournament.dbTournament.host !== req.tetrioID) {
                return res.status(403).json({error: "You are not the host of this tournament."});
            }

            await tournament.start();
            await tournament.log(TOURNEY_LOG_TYPES.START_TOURNAMENT, req.tetrioID);

            res.json({success: "Tournament is starting. GLHF!"});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/finalise", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!req.user.roles.developer && tournament.dbTournament.host !== req.tetrioID) {
                return res.status(403).json({error: "You are not the host of this tournament."});
            }

            await tournament.finaliseScores();
            await tournament.log(TOURNEY_LOG_TYPES.FINALISE_SCORES, req.tetrioID);
            res.json({success: "Tournament has been finalised. GGS!"});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.get("/:tournament/match", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            const matches = await tournament.getUserMatches(req.tetrioID);
            res.json({matches});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.get("/:tournament/match/all", async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            res.json({matches: await tournament.getMatches()});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.get("/:tournament/match/:match", async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            const match = await tournament.getMatch(req.params.match);

            if (!match) {
                res.status(404).json({error: "Match not found."});
                return;
            }

            res.json({match});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/match/:match/lobby", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            const match = await tournament.getMatch(req.params.match);

            if (!match) {
                res.status(404).json({error: "Match not found."});
                return;
            }

            const participantID = (await DBParticipant.findOne({
                tournament: tournament.dbTournament._id,
                user: req.tetrioID
            }))?._id.toString();

            if (match.player1?.toString() !== participantID && match.player2?.toString() !== participantID && !(await tournament.isMod(req.tetrioID))) {
                return res.status(403).json({error: "You don't have permission to view this match lobby."});
            }

            if (match.streamed) {
                const lobby = await tournament.getStreamLobby();
                res.json({lobby});
            } else {
                const chatToken = await createChatToken(req.tetrioID, "match:" + match._id, (await tournament.isMod(req.tetrioID)) ? "tournament_staff" : undefined);
                const lobby = await tournament.initLobby(match);
                res.json({
                    lobby: {
                        player1: lobby.player1,
                        player2: lobby.player2,
                        room_id: lobby.roomID,
                        chat_token: chatToken,
                        streamed: false
                    }
                });
            }

        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/match/:match/streamed", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            await tournament.markMatchAsStreamed(req.params.match);

            res.json({success: "Marked match as streamed."});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.delete("/:tournament/match/:match/streamed", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            await tournament.unmarkMatchAsStreamed(req.params.match);

            res.json({success: "Unmarked match as streamed."});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/match/:match/score", auth, disallowBlocked, json(),
        body("p1score").isNumeric(),
        body("p2score").isNumeric(),
        async (req, res) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({errors: errors.array()});
            }

            try {
                const tournament = await Tournament.get(req.params.tournament);

                if (!tournament) {
                    return res.status(404).json({error: "Tournament not found."});
                }

                if (!(await tournament.isMod(req.tetrioID))) {
                    return res.status(403).json({error: "Only tournament moderators can report scores."});
                }

                const match = (await tournament.getMatches(true)).find(m => m.id === parseInt(req.params.match));

                if (!match) {
                    return res.status(404).json({error: "Match not found."});
                }

                const p1score = Math.abs(parseInt(req.body.p1score));
                const p2score = Math.abs(parseInt(req.body.p2score));

                if (p1score === p2score) {
                    return res.status(400).json({error: "To report a score, one player must have a higher score than the other."});
                }

                await reportScores(tournament.dbTournament.native_url, match.id, p1score, p2score, p1score > p2score ? match.player1_id : match.player2_id);
                await tournament.closeInvalidMatches();
                await tournament.checkCompletionState();
                await tournament.log(TOURNEY_LOG_TYPES.REPORT_SCORES, req.tetrioID, match.id, `${p1score}-${p2score}`);

                res.json({success: "Score reported."});
            } catch (e) {
                res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
            }
        });

    app.post("/:tournament/match/:match/reopen", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!(await tournament.isMod(req.tetrioID))) {
                return res.status(403).json({error: "Only tournament moderators can reopen matches."});
            }

            await tournament.reopenMatch(req.params.match);
            await tournament.log(TOURNEY_LOG_TYPES.REOPEN_MATCH, req.tetrioID, req.params.match);
            res.json({success: "Reopened the match."});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/staff", auth, disallowBlocked, json(), async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                res.status(404).json({error: "Tournament not found."});
                return;
            }

            if (!req.user.roles.developer && tournament.dbTournament.host !== req.tetrioID) {
                return res.status(403).json({error: "You are not the host of this tournament."});
            }

            const user = await getUser(req.body.user);

            if (!user) {
                return res.status(404).json({error: "User not found."});
            }

            if (user._id === tournament.dbTournament.host) {
                return res.status(400).json({error: "You can't add yourself as a tournament staff member."});
            }

            // todo: role select
            const role = "moderator";

            await tournament.addStaff(user._id, role);
            await tournament.log(TOURNEY_LOG_TYPES.ADD_STAFF, req.tetrioID, user._id, role);

            res.json({success: "Assigned a new staff member."});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.delete("/:tournament/staff/:user", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                return res.status(404).json({error: "Tournament not found."});
            }

            if (!req.user.roles.developer && tournament.dbTournament.host !== req.tetrioID) {
                return res.status(403).json({error: "You are not the host of this tournament."});
            }

            await tournament.removeStaff(req.params.user);
            await tournament.log(TOURNEY_LOG_TYPES.REMOVE_STAFF, req.tetrioID, req.params.user);

            res.json({success: "Removed a staff member."});
        } catch (e) {
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/devhook-participants", auth, requireDeveloper, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                return res.status(404).json({error: "Tournament not found."});
            }

            for (const user of ["meirambek", "latence", "nanfros_vintage", "hellobbyebye123", "citrus1105", "sludgy", "ellythesun", "milkysune", "chillieggs", "chienhui", "liz2817", "huiiiiiiiiiiiiii", "tammymiyagi0208", "yaochen", "hello_k", "tagakantotngbata", "as20", "cici__", "sickillian", "vojta", "living_death", "rigulel", "funky3856", "koijir", "wantedonwii", "voncamp", "tairyfail", "corodius", "bubatum", "xidxodxidxod", "lucanguyen2107", "1301520", "asd86", "scram", "gearsdragon", "mrcranberry45", "ssurume", "andryianna", "tottenham", "jujijo", "kangminseung", "eljoho", "laim1", "yamjoonee", "pedromow", "shadowo", "jojobo617", "howoz", "xiaoshun", "sneakysnake", "adarheim", "phamtomk", "blrmnrh", "russianspyguy", "wao", "senior-boozman", "flaca", "thatduckgood", "urbanmoney", "thretrusis", "nagiowo", "nameless9126", "remsupremacy", "ndagamerz", "xitoc", "920420", "mxdnic", "exdan_lol", "lukkaly", "itkz5112", "lorcan-", "goya", "spbplays", "cestino", "chickenthighs", "blaii", "y0ki", "tetrisretsam", "silvergrey", "matisexi", "fixamaxima", "breziperzup", "h-menon", "athanrelle", "littlespy", "jikwei", "mophome", "kyutiespin", "wiiagab", "irazack", "starjumper", "bigzebra69", "jiqiren1143", "johnel", "flashm8", "facebookuser01", "jjamppong", "skrillero2", "elquina", "tapy", "el89", "klausking", "cidtetrisnob", "tiredalex", "orneml", "tranquanghung03", "sekko", "lazimouse", "al-vis", "daddyyyyyyyyyyyy", "sebun", "yisus121221", "sd120147", "chinaout1234", "claravic", "stpruby", "salasxpony", "mina_myoui17", "nhatminh2k7", "yzzagab", "sebastianhhkj", "hatredtom", "tomodori", "souptime", "loafofwheat", "d_struct0r", "phyl", "icommitwarcrimes", "cocopebl", "anidrak", "gammateck", "brotrap007", "dexter_221", "asgduin", "laura_wc", "baegopayo", "kuriyama", "owliere", "ascendant", "kokiezero", "wesssssss", "airfest", "sadmemefrog", "gpleaop", "leo1324", "fonzii", "li4ly", "hoshin", "lupmonroe", "irenic", "kiew", "brattwurst", "tarvy", "mindi", "astenator", "dived2014", "jiwelashleng", "litstar", "android27", "merumeru", "jateu", "vincents", "nzboy", "meatsauce", "imberzox", "pikachuisyellow", "petpet", "jascheng", "akde1", "server623", "kitty_purr", "nishuthetissue", "weirdlysa", "hannahlovesyou", "mclivin", "jackphua", "emiratos", "swaggygerbil", "chenisa", "ilyanna", "zuan22b", "derpanese", "pielalalala", "cha1234", "__stan", "sword5426", "sadboi1", "epicrobloxgamer", "daligrama", "jxismine6588", "itsghost", "juancit0", "dyborg", "nachumi", "r8spike", "diman", "ipegyou", "smquaxi", "viefgu", "cho991818", "froskyarr", "dashadabomb", "lemontide", "kilees", "mrcslnrd", "jiegan", "pollen__", "hardbeliever", "cumphilio", "tanweixiang", "weoweet", "cjxx", "weeingru", "dentel_floss", "uniquename", "mi6", "aeriuchinaga", "asda5002", "badonski", "cratoer", "st03", "arkinteck", "mitsukeyyy", "mhooyongzaa", "xolotl545", "yakamozzzz", "iamhuman", "kienz", "goatboi", "0_1", "riprull", "wwyy", "kdam", "moist700", "redgambit", "antlan", "yoka255", "kuang6166", "gracelee05", "ayachibenene", "cols", "danilafe", "highhamhank", "ascendren", "mrg", "xxuannn", "jace-onderulo", "hoak", "stoppy", "noriki", "intellegent", "who_are_you", "yorick12", "alenico", "tictac7", "noxice"]) {
                try {
                    await tournament.createParticipant(user);
                } catch {
                    // skip
                }
            }

            res.json({success: "Executed."});
        } catch (e) {
            console.warn(e);
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/devhook-checkin", auth, requireDeveloper, async (req, res) => {
        try {
            await DBParticipant.updateMany({
                tournament: mongoose.Types.ObjectId(req.params.tournament)
            }, {
                $set: {
                    checked_in: true
                }
            });

            res.json({success: "Executed."});
        } catch (e) {
            console.warn(e);
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/devhook-recheck", auth, requireDeveloper, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            await tournament.updateMatchStates();

            res.json({success: "Executed."});
        } catch (e) {
            console.warn(e);
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.get("/:tournament/eligiblity", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                return res.status(404).json({error: "Tournament not found."});
            }

            const eligiblity = await tournament.checkEligibility(req.tetrioID);

            return res.json(eligiblity);
        } catch (e) {
            console.warn(e);
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.get("/:tournament/log", auth, disallowBlocked, async (req, res) => {
        const tournament = await Tournament.get(req.params.tournament);

        if (!(await tournament.isMod(req.tetrioID))) {
            return res.status(403).json({error: "Only tournament staff can view logs."});
        }

        const logs = await DBTournamentLog.find({tournament: tournament.dbTournament._id}).sort({time: -1}).exec();
        res.json({logs});
    });

    app.post("/:tournament/freeze", auth, requireModerator, json(), async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                return res.status(404).json({error: "Tournament not found."});
            }

            if (!req.body.reason || req.body.reason.trim() === "") {
                return res.status(400).json({error: "No reason provided."});
            }

            tournament.dbTournament.frozen_reason = req.body.reason;
            await tournament.dbTournament.save();
            await pushNotification(tournament.dbTournament.host, {
                title: "Tournament removed",
                body: `Your tournament "${tournament.dbTournament.name}" was removed by a moderator for the following reason: ${req.body.reason}`,
                urgent: true
            });

            return res.json({success: "Tournament frozen."});
        } catch (e) {
            console.warn(e);
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.delete("/:tournament/freeze", auth, requireModerator, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                return res.status(404).json({error: "Tournament not found."});
            }

            tournament.dbTournament.frozen_reason = undefined;
            await tournament.dbTournament.save();

            return res.json({success: "Tournament unfrozen."});
        } catch (e) {
            console.warn(e);
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.get("/:tournament/chat", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                return res.status(404).json({error: "Tournament not found."});
            }

            const token = await createChatToken(req.tetrioID, "stream:" + tournament.dbTournament._id, (await tournament.isMod(req.tetrioID)) ? "tournament_staff" : undefined);

            res.json({token});
        } catch (e) {
            console.warn(e);
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.get("/:tournament/disputes", auth, disallowBlocked, async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                return res.status(404).json({error: "Tournament not found."});
            }

            if (!(await tournament.isMod(req.tetrioID))) {
                return res.status(403).json({error: "Only tournament staff can view disputes."});
            }

            const disputes = await DBDispute.find({tournament: tournament.dbTournament._id});

            res.json({disputes});
        } catch (e) {
            console.warn(e);
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    app.post("/:tournament/match/:match/dispute", auth, disallowBlocked, json(), async (req, res) => {
        try {
            const tournament = await Tournament.get(req.params.tournament);

            if (!tournament) {
                return res.status(404).json({error: "Tournament not found."});
            }

            const match = await tournament.getMatch(req.params.match);

            if (!match) {
                return res.status(404).json({error: "Match not found."});
            }

            await DBDispute.create({
                tournament: tournament.dbTournament._id,
                match: match._id,
                sender: req.tetrioID,
                time: new Date(),
                reason: req.body.reason
            });

            res.json({success: "Dispute raised."});
        } catch (e) {
            console.warn(e);
            res.status(e.getStatusCode()).json({error: e.getUserFacingMessage()});
        }
    });

    return app;
}

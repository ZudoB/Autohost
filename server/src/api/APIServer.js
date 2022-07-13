const Sentry = require("@sentry/node");
const express = require("express");
const cors = require("cors");
const {logMessage, LOG_LEVELS} = require("../log");
const {auth, disallowBlocked, requireSupporter} = require("./auth");
const {getFeatureFlags} = require("../redis/redis");
const {json} = require("body-parser");
const {getUser} = require("../gameapi/api");
const fetch = require("node-fetch");
const {getBans} = require("../data/globalbans");
const {TOURNAMENT_CONSTANTS} = require("../data/data");

class APIServer {

    constructor(port) {
        this.app = express();

        this.app.use(Sentry.Handlers.requestHandler());

        this.app.use(Sentry.Handlers.tracingHandler());

        this.app.enable("trust proxy");
        this.app.disable("x-powered-by");

        this.app.use(cors());

        // middleware for adding ip based on cloudflare info
        this.app.use((req, res, next) => {
            const ip = req.get("CF-Connecting-IP") || req.ip;
            const country = req.get("CF-IPCountry");
            req.realIP = ip;
            req.realCountry = country;
            next();
        });

        // logging middlware
        this.app.use((req, res, next) => {
            logMessage(LOG_LEVELS.ULTRAFINE, "Server", req.method + " " + req.path, {
                ip: req.realIP
            });
            next();
        });

        // middleware for blocking endpoints via flags
        this.app.use(async (req, res, next) => {
            const flags = await getFeatureFlags();
            if (!flags.blocked_endpoints) return next();

            const regex = new RegExp(flags.blocked_endpoints);

            if (regex.exec(req.originalUrl)) {
                return res.status(503).json({error: "This feature is currently unavailable."});
            } else {
                return next();
            }
        });

        this.app.get("/whois/:uid", async (req, res) => {
            const user = await getUser(req.params.uid);
            if (user) {
                res.json(user);
            } else {
                res.status(404).json({error: "User not found."});
            }
        });

        this.app.get("/profile", auth, (req, res) => {
            res.json({
                _id: req.user._id,
                roles: req.user.roles,
                tetrio_id: req.user.tetrio_id,
                discord_id: req.user.discord_id,
                discord_tag: req.user.discord_tag,
                join_emote: req.user.join_emote,
                discord_assignable_roles: req.user.discord_assignable_roles
            });
        });

        this.app.get("/punishments", auth, async (req, res) => {
            const punishments = await getBans(req.tetrioID);
            res.json({
                punishments: punishments.map(p => {
                    return {
                        id: p._id,
                        reason: p.reason,
                        type: p.type,
                        expiry: p.expiry
                    }
                })
            });
        });

        this.app.use("/tournament", require("./endpoints/tournament")());
        this.app.use("/login", require("./endpoints/login")());
        this.app.use("/notifications", require("./endpoints/notifications")());
        this.app.use("/administration", require("./endpoints/administration")());
        this.app.use("/moderation", require("./endpoints/moderation")());
        this.app.use("/discord", require("./endpoints/discord")());

        this.app.get("/", async (req, res) => {
            const flags = await getFeatureFlags();
            res.json({
                production: process.env.NODE_ENV === "production",
                version: require("../../package.json").version,
                account: botUserID,
                tournament_constants: TOURNAMENT_CONSTANTS,
                flags
            });
        });

        this.app.post("/report", auth, disallowBlocked, json(), async (req, res) => {
            const user = await getUser(req.tetrioID);

            if (["cheating", "nsfw", "spam", "other"].indexOf(req.body.category) === -1) {
                return res.status(400).json({error: "Invalid report category."});
            }

            await fetch("https://discord.com/api/webhooks/909059528312647750/JWWvr7gBNxbDd-2o9uVsrhM9rDXJchw8wfpztPgH7U7Xf2FYQR87tPOX37xtx1eJhbvP", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    username: `${user.username} [${user._id}]`,
                    avatar_url: `https://tetr.io/user-content/avatars/${user._id}.jpg?rv=${user.avatar_revision}`,
                    embeds: [
                        {
                            title: "New report received",
                            type: "rich",
                            description: req.body.reason,
                            // url: req.body.url,
                            fields: [
                                {
                                    name: "Category",
                                    value: req.body.category
                                },
                                {
                                    name: "Offending Content",
                                    value: req.body.url
                                }
                            ],
                            footer: {
                                text: "Please delete this message once the issue is resolved."
                            }
                        }
                    ]
                })
            });

            res.json({success: "Report sent. Thanks for the help!"});
        });

        this.app.post("/joinemote", auth, requireSupporter, json(), async (req, res) => {
            req.user.join_emote = req.body.emote;
            await req.user.save();
            res.json({success: "Emote updated."});
        });

        this.app.use((req, res) => {
            res.status(404).json({error: "Endpoint not found."});
        });

        this.app.use(Sentry.Handlers.errorHandler());

        const http = this.app.listen(port, () => {
            logMessage(LOG_LEVELS.INFO, "Server", `Now listening on port ${port}`);
        });

        new (require("./chat/chat").server)(http);
    }
}

module.exports = APIServer;

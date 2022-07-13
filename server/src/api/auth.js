const jwt = require("jsonwebtoken");
const {DBUser, DBPunishment, DBNotification} = require("../db/models");
const {PUNISHMENT_TYPES} = require("../data/enums");
const {getUser} = require("../gameapi/api");
const {logMessage, LOG_LEVELS} = require("../log");

function getUserToken(user) {
    return new Promise(async (resolve, reject) => {
        let dbUser = await DBUser.findOne({tetrio_id: user});

        if (!dbUser) {
            dbUser = await DBUser.create({
                tetrio_id: user,
                token_cycle: 0,
                roles: {
                    developer: false,
                    partner: false,
                    supporter: false,
                    moderator: false
                },
                punishments: [],
                created: new Date(),
                seen: new Date()
            });

            await DBNotification.create({
                user,
                component: "FirstJoin",
                time: new Date()
            });
        }

        // update last known name
        try {
            const profile = await getUser(user);
            if (profile) {
                dbUser.last_name = profile.username;
                await dbUser.save();
            }
        } catch (e) {
            logMessage(LOG_LEVELS.WARNING, "Auth", `Failed to update last known name of ${user}: ${e.message}`);
        }

        jwt.sign({
            sub: user,
            token_cycle: dbUser.token_cycle,
            scope: "auth"
        }, process.env.JWT_KEY, (err, jwt) => {
            if (err) return reject(err);

            resolve(jwt);
        });
    });
}

async function auth(req, res, next) {
    let token = req.query._token;

    if (!token) {
        const header = req.get("authorization");

        if (!header) {
            return res.status(401).json({error: "Authorization required"});
        }

        const parts = header.split(" ");

        if (parts.length !== 2 || parts[0] !== "Bearer") {
            return res.status(401).json({error: "Bearer token required"});
        }

        token = parts[1];
    }

    let claim;

    try {
        claim = await new Promise((resolve, reject) => {
            jwt.verify(token, process.env.JWT_KEY, (err, claim) => {
                if (err) return reject(err);

                resolve(claim);
            });
        });
    } catch (e) {
        return res.status(403).json({error: "Invalid token", force_reauth: true});
    }

    let dbUser = await DBUser.findOne({tetrio_id: claim.sub});
    const punishments = await DBPunishment.find({
        user: claim.sub, $or: [
            {expiry: null}, // indefinite
            {expiry: {$gt: new Date()}} // expires in the future
        ],
        revoked_by: null
    }).sort({_id: -1});

    if (!dbUser) {
        return res.status(403).json({error: "Account does not exist.", force_reauth: true});
    }

    dbUser.seen = new Date();
    dbUser.ip = {ip: req.realIP, country: req.realCountry};

    await dbUser.save();

    if (claim.scope !== "auth" || claim.token_cycle !== dbUser.token_cycle) {
        return res.status(403).json({error: "Your account status has changed. Please log in again.", force_reauth: true});
    }

    req.user = dbUser;

    req.punishments = punishments;
    req.tetrioID = claim.sub;

    next();
}

async function requireDeveloper(req, res, next) {
    if (!req.tetrioID) {
        throw new Error("Invalid middleware configuration");
    }

    if (req.user.roles.developer) {
        return next();
    } else {
        return res.status(403).json({error: "This action is restricted to users with the Developer role."});
    }
}

async function requireModerator(req, res, next) {
    if (!req.tetrioID) {
        throw new Error("Invalid middleware configuration");
    }

    if (req.user.roles.developer || req.user.roles.moderator) {
        return next();
    } else {
        return res.status(403).json({error: "This action is restricted to users with the Moderator role."});
    }
}

async function requireSupporter(req, res, next) {
    if (!req.tetrioID) {
        throw new Error("Invalid middleware configuration");
    }

    if (req.user.roles.supporter) {
        return next();
    } else {
        return res.status(403).json({error: "You do not have permission to perform this action."});
    }
}

async function disallowBlocked(req, res, next) {
    if (!req.tetrioID) {
        throw new Error("Invalid middleware configuration");
    }

    const platformBlocks = req.punishments.find(punishment => punishment.type === PUNISHMENT_TYPES.PLATFORM_BLOCK);

    if (platformBlocks) {
        return res.status(403).json({error: "Platform blocked users cannot perform this action."});
    } else {
        return next();
    }
}

module.exports = {getUserToken, auth, requireModerator, requireDeveloper, disallowBlocked, requireSupporter};

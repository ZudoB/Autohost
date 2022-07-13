const {Router, json} = require("express");
const api = require("../../gameapi/api");
const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");
const {getUserToken, auth} = require("../auth");
const {getFeatureFlags} = require("../../redis/redis");

module.exports = function () {
    const app = Router();

    const loginSpeedLimit = slowDown({
        windowMs: 900000, // 15 minutes
        delayAfter: 3,
        delayMs: 500
    });

    const loginRateLimit = rateLimit({
        windowMs: 900000, // 15 minutes
        max: 10,
        message: {
            error: "Too many login attempts from this IP. Please try again in 15 minutes."
        }
    });

    app.post("/", loginSpeedLimit, loginRateLimit, json(), async (req, res) => {
        if (!req.body.user) {
            return res.status(400).json({error: "No user specified."});
        }

        const user = await api.getUser(req.body.user.toLowerCase());

        if (!user) {
            return res.status(404).json({error: "User not found, check your spelling and try again."});
        }

        if (user.role === "banned") {
            return res.status(403).json({error: "You are banned from TETR.IO, and are therefore unable to use Autohost."});
        }

        if (user.role === "anon") {
            return res.status(400).json({error: "Anonymous accounts cannot be used to log in. Please create a TETR.IO account and log in with that."});
        }

        if (user.role === "bot") {
            return res.status(400).json({error: "Bot accounts cannot be used to log in, sorry!"});
        }

        const session = await sessionManager.createSession(true, "LoginSession", {owner: user._id});

        res.json({room: session.roomID, key: session._id, user: user._id});
    });

    app.get("/", async (req, res) => {
        const session = await sessionManager.getSessionByID(req.query.key);
        if (session && session.loginOwner === req.query.user) {
            if (session.loginComplete) {
                await sessionManager.destroySession(session._id);
                const token = await getUserToken(session.loginOwner);
                res.json({token});
            } else {
                res.json({login_retry: true});
            }
        } else {
            res.json({login_retry: false});
        }
    });

    return app;
}

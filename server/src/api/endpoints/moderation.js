const {Router, json} = require("express");
const {requireModerator, auth} = require("../auth");
const {body, validationResult} = require("express-validator");
const {DBPunishment, DBUser} = require("../../db/models");
const {PUNISHMENT_TYPES} = require("../../data/enums");
const {getUser} = require("../../gameapi/api");
const {pushNotification} = require("../push");

module.exports = function () {
    const app = Router();

    app.get("/lobbies", auth, requireModerator, async (req, res) => {
        res.json({
            sessions: await sessionManager.getSessions()
        });
    });

    app.get("/punishment",
        auth,
        requireModerator,
        async (req, res) => {
            const punishments = await DBPunishment.find().limit(100).sort({_id: -1}).exec();
            res.json({punishments});
        });

    app.delete("/punishment/:id",
        auth,
        requireModerator,
        async (req, res) => {
            const punishment = await DBPunishment.findById(req.params.id);
            if (!punishment) {
                return res.status(404).json({error: "Couldn't find that punishment."});
            }
            if (req.query.hard && req.user.roles.developer) {
                await punishment.delete();
                res.json({success: "Punishment deleted."});
            } else {
                punishment.revoked_by = req.tetrioID;
                await punishment.save();
                res.json({success: "Punishment revoked."});
            }
        });

    app.post("/punishment",
        auth,
        requireModerator,
        json(),
        body("user").isString().withMessage("User is invalid."),
        body("type").isIn(Object.values(PUNISHMENT_TYPES)).withMessage("Punishment type invalid."),
        body("reason").isLength({min: 3}).withMessage("Reason must have at least three characters."),
        body("note").isString().optional(),
        body("expiry").isISO8601().optional().withMessage("Expiry date must be valid."),
        async (req, res) => {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({errors: errors.array()});
            }

            const user = await getUser(req.body.user);

            if (!user) {
                return res.status(404).json({error: "TETR.IO user not found."});
            }

            try {
                await DBPunishment.create({
                    user: user._id,
                    type: req.body.type,
                    reason: req.body.reason,
                    staff: req.tetrioID,
                    expiry: req.body.expiry,
                    note: req.body.note
                });

                await pushNotification(user._id, {
                    title: "Account Notification",
                    body: "Your account has been restricted. Click for more information.",
                    urgent: true,
                    url: "/restrictions"
                });

                res.json({success: "Punishment created."});
            } catch (e) {
                res.status(500).json({error: e.message});
            }
        });

    app.post("/partnership/:user/:enable", async (req, res) => {
        const user = await getUser(req.params.user);

        const enable = req.params.enable === "enable";

        if (!user) {
            return res.status(404).json({error: "TETR.IO user not found."});
        }

        const result = await DBUser.updateOne({tetrio_id: user._id}, {
            $set: {
                "roles.partner": enable
            }
        });

        if (result.n === 1) {
            res.json({success: `${enable ? "Applied" : "Removed"} the partnership role.`});
        } else {
            res.status(404).json({error: "User needs to log in at least once before they can be (un)partnered."});
        }
    });

    return app;
}

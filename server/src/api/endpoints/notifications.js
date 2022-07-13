const {Router, json} = require("express");

const {auth} = require("../auth");
const {DBNotification, DBSubscription} = require("../../db/models");

module.exports = function () {
    const app = Router();

    app.post("/sub", auth, json(), async (req, res) => {
        if (!(req.body.subscription?.endpoint && req.body.subscription?.keys)) {
            return res.status(400).json({error: "Invalid subscription."});
        }

        try {
            await DBSubscription.create({
                user: req.tetrioID,
                sub: req.body.subscription
            });
            res.json({success: "Push notifications enabled on this device."});
        } catch (e) {
            res.status(500).json({error: "Failed to register a subscription."});
        }
    });

    app.get("/", auth, async (req, res) => {
        res.json({
            notifications: await DBNotification.find({
                user: req.tetrioID,
                time: {$gt: new Date(Date.now() - 2592000000)} // 30 days
            }).sort({time: -1}).exec()
        });
    });

    app.delete("/", auth, async (req, res) => {
        await DBNotification.updateMany({user: req.tetrioID}, {
            $set: {
                seen: true
            }
        });
        res.status(200).json({success: "Acknowledged notifications."});
    });

    app.delete("/:notification", auth, async (req, res) => {
        try {
            await DBNotification.findByIdAndUpdate(req.params.notification, {
                $set: {
                    seen: true
                }
            });
            res.status(200).json({success: "Acknowledged notification."});
        } catch (e) {
            res.status(404).json({error: "Couldn't find notification to acknowledge."});
        }
    });

    return app;
}

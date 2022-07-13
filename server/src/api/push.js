const webpush = require("web-push");
const {DBNotification, DBSubscription} = require("../db/models");
const {logMessage, LOG_LEVELS} = require("../log");
const {queueAddTasks} = require("../redis/redis");

webpush.setVapidDetails(
    "https://autoho.st",
    process.env.PUSH_PUBLIC_KEY,
    process.env.PUSH_PRIVATE_KEY
);

async function pushNotification(user, payload) {
    await DBNotification.create({
        user,
        title: payload.title,
        body: payload.body,
        tournament: payload.tournament && payload.tournament.length > 0 ? payload.tournament : undefined,
        url: payload.url && payload.url.length > 0 ? payload.url : undefined,
        component: payload.component,
        urgent: payload.urgent,
        meta: payload.meta || {},
        time: new Date()
    });

    const subscriptions = await DBSubscription.find({user});

    for (const subscription of subscriptions) {
        webpush.sendNotification(subscription.sub, JSON.stringify(payload)).then(() => {
            logMessage(LOG_LEVELS.FINE, "WebPush", "Delivered a web push notification for " + user);
        }).catch(e => {
            logMessage(LOG_LEVELS.FINE, "WebPush", `Failed to deliver a push notification for ${user} (${e.statusCode})`);
            if (e.statusCode === 410 || e.statusCode === 404) {
                subscription.remove();
            }
        });
    }
}

function pushNotificationBulk(users, payload) {
    return Promise.all(users.map(user => pushNotification(user, payload)));
}

module.exports = {pushNotification, pushNotificationBulk};

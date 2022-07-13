const {logMessage, LOG_LEVELS} = require("../log");

class APMCalculator {

    constructor(autohost) {
        this.ready = false;
        this.autohost = autohost;

        this.apmMap = new Map();

        this.listenIDToUsernameMap = new Map();
        this.usernameToListenIDMap = new Map();

        this.infractions = new Map();
    }

    log(message) {
        logMessage(LOG_LEVELS.FINE, "APMCalculator", message);
    }

    clearListenIDs() {
        this.listenIDToUsernameMap.clear();
        this.usernameToListenIDMap.clear();
    }

    addListenID(listenID, username) {
        this.listenIDToUsernameMap.set(listenID, username);
        this.usernameToListenIDMap.set(username, listenID);
    }

    start() {
        if (!this.autohost.rules.max_apm) return;

        this.log("Starting APM calculator");

        this.ready = true;

        this.multiplier = this.autohost.ribbon.room.settings.game.options.garbagemultiplier;
        this.max = this.autohost.rules.max_apm; // the max apm
        this.startTime = Date.now();

        this.apmMap.clear();
    }

    addGarbageIGE(sender, attack) {
        if (!this.ready || !this.usernameToListenIDMap.has(sender)) return;

        const listenID = this.usernameToListenIDMap.get(sender);

        let apm = this.apmMap.has(listenID) ? this.apmMap.get(listenID) : 0;
        apm += attack;
        this.apmMap.set(listenID, apm);
    }

    die(listenID) {
        if (!this.ready || !this.listenIDToUsernameMap.has(listenID)) return;

        const duration = Date.now() - this.startTime;

        // don't punish players for very short games
        if (duration < 20000) return;

        const attack = this.apmMap.get(listenID);
        const normalisedAPM = Math.floor(((attack / duration) * 1000 * 60) / this.multiplier * 10) / 10;

        const username = this.listenIDToUsernameMap.get(listenID);

        let infractions = this.infractions.get(username) || 0;

        if (normalisedAPM > this.max + 20) {
            infractions += 3;
        } else if (normalisedAPM > this.max + 10) {
            infractions += 2;
        } else if (normalisedAPM > this.max) {
            infractions += 1;
        } else if (infractions > 0) {
            infractions--;
        }

        this.log(`${username} died with ${normalisedAPM} APM (infractions = ${infractions})`);

        this.infractions.set(username, infractions);

        if (infractions >= 3 && normalisedAPM > this.max) {
            this.autohost.sendMessage(username, `You have been exceeding this room's APM limit consistently, and as such can no longer play. (${infractions} infractions)`);
        } else if (normalisedAPM > this.max) {
            this.autohost.sendMessage(username, `You exceeded this room's APM limit during this game. Please respect the other players in the room by playing at their level in the next game. (${infractions} infraction${Math.abs(infractions) !== 1 ? "s" : ""})`);
        }
    }

    stop() {
        this.ready = false;
    }
}

module.exports = APMCalculator;

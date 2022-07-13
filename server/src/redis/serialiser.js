const {BloomFilter} = require("bloom-filters");
const TournamentAutohost = require("../tournaments/TournamentAutohost");
const StreamedTournamentAutohost = require("../tournaments/StreamedTournamentAutohost");

const FIELDS = {};
FIELDS["Autohost"] = ["host", "bannedUsers", "moderatorUsers", "allowedUsers", "twoPlayerMode", "twoPlayerChallenger", "twoPlayerOpponent", "twoPlayerQueue", "rules", "roomID", "isPrivate", "persist", "autostart", "persist", "motdID", "someoneDidJoin", "welcomedUsers", "creationTime", "persistLobby", "apmLimitExemption", "smurfProtection"];
FIELDS["TournamentAutohost"] = ["tournamentID", "matchID", "player1", "player2", "player1ready", "player2ready", "player1disconnections", "player2disconnections", "spectatorsAllowed", "spectatorJoined", "matchStarted", "roomID"];
FIELDS["StreamedTournamentAutohost"] = ["tournamentID", "roomID"];

/**
 * Takes an Autohost instance and converts it to JSON that's safe for sticking in Redis.
 * @param autohost The Autohost instance.
 * @returns {Object} A JSON object.
 */
function serialise(autohost) {
    const type =
        autohost instanceof TournamentAutohost ? "TournamentAutohost" :
            (autohost instanceof StreamedTournamentAutohost ? "StreamedTournamentAutohost" : "Autohost");

    const fields = FIELDS[type];
    const data = {};

    fields.forEach(field => {
        if (autohost[field] instanceof Map || autohost[field] instanceof Set) {
            data[field] = [...autohost[field]];
        } else if (autohost[field] instanceof BloomFilter) {
            data[field] = autohost[field].saveAsJSON();
        } else {
            data[field] = autohost[field];
        }
    });


    return {type, data};
}

/**
 * Takes a JSON object returned by {@link serialise} and applies the contained settings to an Autohost instance.
 * @param {Object} data The serialised data.
 * @param target The target Autohost instance.
 */
function deserialise(data, target) {
    const fields = FIELDS[data.type];

    fields.forEach(field => {
        if (target[field] instanceof Map) {
            target[field] = new Map(data.data[field]);
        } else if (target[field] instanceof Set) {
            target[field] = new Set(data.data[field]);
        } else if (target[field] instanceof BloomFilter) {
            target[field] = BloomFilter.fromJSON(data.data[field]);
        } else {
            target[field] = data.data[field];
        }
    });
}

module.exports = {serialise, deserialise};

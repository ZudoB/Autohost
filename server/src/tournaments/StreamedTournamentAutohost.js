const EventEmitter = require("events");
const Tournament = require("./Tournament");
const {parseSet} = require("../ribbon/configparser");

class StreamedTournamentAutohost extends EventEmitter {

    constructor({tournamentID, ribbon}) {
        super();

        this.tournamentID = tournamentID;
        this.ribbon = ribbon;
    }

    async setup() {
        const tournament = await Tournament.get(this.tournamentID);

        const customConfig = parseSet(tournament.dbTournament.config);
        this.ribbon.room.setRoomConfig(customConfig);

        this.ribbon.room.setRoomConfig([
            {
                index: "meta.name",
                value: `[${tournament.dbTournament.shortname.toUpperCase()}] STREAM LOBBY`
            },
            {
                index: "meta.userlimit",
                value: "2"
            }
        ]);
    }

    get roomID() {
        return this.ribbon.room.id;
    }

    saveConfig() {
        this.emit("configchange");
    }
}

module.exports = StreamedTournamentAutohost;

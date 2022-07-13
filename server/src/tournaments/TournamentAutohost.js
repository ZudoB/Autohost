const EventEmitter = require("events");
const {setRoomCode} = require("../ribbon/ribbonutil");
const Tournament = require("./Tournament");
const {DBParticipant} = require("../db/models");

class TournamentAutohost extends EventEmitter {

    constructor({match, ribbon}) {
        super();

        this.ribbon = ribbon;

        if (match) {
            this.matchID = match._id;
            this.tournamentID = match.tournament;
        }
    }

    async setup() {
        this.tournament = await Tournament.get(this.tournamentID);
        this.match = await this.tournament.getMatch(this.matchID);

        if (this.tournament.dbTournament.roomcode) {
            await setRoomCode(this.ribbon, this.tournament.dbTournament.roomcode + Math.floor(Math.random() * 10000));
        }

        this.player1 = await DBParticipant.findById(this.match.player1);
        this.player2 = await DBParticipant.findById(this.match.player2);

        this.ribbon.room.setRoomConfig([
            {
                index: "meta.name",
                value: `${this.tournament.dbTournament.name.toUpperCase()} ROUND ${this.match.round} - ${this.player1.name.toUpperCase()} VS ${this.player2.name.toUpperCase()}`
            },
            {
                index: "meta.userlimit",
                value: "2"
            },
            {
                index: "meta.match.ft",
                value: this.tournament.dbTournament.ft.toString()
            },
            {
                index: "meta.match.wb",
                value: this.tournament.dbTournament.wb.toString()
            }
        ]);

        this.saveConfig();
        this.emit("ready");
    }

    get roomID() {
        return this.ribbon.room.settings.id;
    }

    destroy(message) {
        this.emit("stop", message);
        this.ribbon.disconnectGracefully();
    }

    saveConfig() {
        this.emit("configchange");
    }
}

module.exports = TournamentAutohost;

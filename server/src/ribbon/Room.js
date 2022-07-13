const EventEmitter = require("events");

class Room extends EventEmitter {

    constructor(ribbon, settings) {
        super();

        this.ribbon = ribbon;
        this.settings = settings;

        this.ribbon.on("gmupdate", settings => {
            this.settings = settings;
        });

        this.ribbon.on("gmupdate.join", join => {
            this.settings.players.push(join);
            this.emit("playersupdate");
        });

        this.ribbon.on("gmupdate.bracket", bracket => {
            const idx = this.settings.players.findIndex(player => player._id === bracket.uid);
            const player = this.settings.players[idx];
            player.bracket = bracket.bracket;
            this.settings.players[idx] = player;
            this.emit("playersupdate");
        });

        this.ribbon.on("gmupdate.host", host => {
            this.settings.owner = host;
        });

        this.ribbon.on("gmupdate.leave", id => {
            const idx = this.settings.players.findIndex(player => player._id === id);
            this.settings.players.splice(idx, 1);
            this.emit("playersupdate");
        });
    }

    get name() {
        return this.settings.meta?.name;
    }

    get isHost() {
        return this.settings.owner === botUserID;
    }

    get ingame() {
        return this.settings.game.state === "ingame";
    }

    get id() {
        return this.settings.id;
    }

    get isPrivate() {
        return this.settings.type === "private";
    }

    get players() {
        return this.settings.players?.filter(player => player.bracket === "player").map(player => player._id) || [];
    }

    get spectators() {
        return this.settings.players?.filter(player => player.bracket === "spectator").map(player => player._id) || [];
    }

    get memberCount() {
        return this.settings.players?.length || 0;
    }

    setRoomConfig(data) {
        this.ribbon.sendMessage({
            command: "updateconfig",
            data
        });
    }

    setName(name) {
        this.setRoomConfig([
            {
                index: "meta.name",
                value: name
            }
        ]);
    }

    switchPlayerBracket(player, bracket) {
        this.ribbon.sendMessage({
            command: "switchbrackethost",
            data: {
                uid: player,
                bracket
            }
        });
    }

    hasPlayer(id) {
        return !!this.settings.players.find(player => player._id === id);
    }

    kickPlayer(player, duration) {
        this.ribbon.sendMessage({command: "kick", data: {uid: player, duration}});
    }

    unbanPlayer(player) {
        this.ribbon.sendMessage({command: "unban", data: player});
    }

    transferOwnership(player) {
        this.ribbon.sendMessage({command: "transferownership", data: player});
    }

    takeOwnership() {
        this.ribbon.sendMessage({command: "takeownership"});
    }

    start() {
        this.ribbon.sendMessage({command: "startroom"});
    }

    setRoomID(id) {
        this.ribbon.sendMessage({command: "setroomid", data: id});
    }
}

module.exports = Room;

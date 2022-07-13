const EventEmitter = require("events");
const {setRoomCode} = require("../ribbon/ribbonutil");

class LoginSession extends EventEmitter {

    constructor({owner, ribbon}) {
        super();

        this.ribbon = ribbon;
        this.owner = owner;
    }

    setup() {
        this.loginComplete = false;

        setTimeout(() => {
            this.ribbon.sendChatMessage("Session timed out.");
            this.destroy();
        }, 1000 * 60 * 20);

        this.ribbon.room.setName("Log in to Autohost");

        this.ribbon.on("gmupdate.join", join => {
            if (join._id === this.owner) {
                this.ribbon.sendChatMessage(`Welcome, ${join.username.toUpperCase()}. Type LOGIN to continue logging into Autohost. If you weren't trying to log in, simply leave the lobby.`);
            } else {
                this.ribbon.sendChatMessage(`This lobby is intended for another user. Please check your spelling and try again.`);
            }
        });

        this.ribbon.on("chat", chat => {
            if (chat.user._id !== this.owner || chat.system) return;

            const message = chat.content.trim();
            if (message.toLowerCase() === "login") {
                this.loginComplete = true;
                this.ribbon.sendChatMessage(":verified: Login complete! You can now leave this room.");
            } else {
                this.ribbon.sendChatMessage(":notlikethis: That's not quite right, please try again.");
            }
        });

        setRoomCode(this.ribbon, "AHLOGIN" + Math.floor(Math.random() * 10000)).finally(() => {
            this.emit("ready");
        });

    }

    destroy() {
        this.emit("stop");
        this.closing = true;
        this.ribbon.disconnectGracefully();
    }

    get roomID() {
        return this.ribbon.room.id;
    }

}

module.exports = LoginSession;

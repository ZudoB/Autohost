const api = require("../gameapi/api");
const Ribbon = require("../ribbon/Ribbon");
const {getBan} = require("../data/globalbans");
const {PUNISHMENT_TYPES} = require("../data/enums");

function sendAutohostWelcome(ribbon, user) {
    ribbon.sendDM(user, "Hi there! Autohost is a bot for TETR.IO that allows for additional host features in custom games. \n\nType !public to create a public lobby. \nType !private to create a private lobby. \n\nIf you're new to Autohost, visit https://autoho.st/about to learn more.");
}

async function lobbyCreationCommandHandler(isPrivate, ribbon, user) {
    const ban = await getBan(user, PUNISHMENT_TYPES.HOST_BLOCK);
    if (ban) {
        ribbon.sendDM(user, `Your account is blocked from hosting lobbies for the following reason:\n\n${ban.reason}`);
        return;
    }

    const {_id, roomID} = await sessionManager.createSession(isPrivate, "Autohost", {host: user});

    await sessionManager.inviteToSession(_id, user);

    ribbon.sendDM(user, `Your ${isPrivate ? "private" : "public"} lobby has been created! \n\nI've tried to invite you, but in case that doesn't work, the room code is ${roomID} - join from the Multiplayer menu.`);
    // setTimeout(() => {
    //     if (!session.someoneDidJoin) {
    //         session.destroy("Your lobby timed out because you didn't join in time. Create another one to continue.");
    //     }
    // }, 25000);
}


const COMMANDS = {
    public(ribbon, user) {
        return lobbyCreationCommandHandler(false, ribbon, user);
    },
    private(ribbon, user) {
        return lobbyCreationCommandHandler(true, ribbon, user);
    },
    sip(ribbon, user) {
        ribbon.sendDM(user, ":serikasip:");
    }
};


class DMInterface {

    constructor() {
        this.connect();
    }

    connect() {
        this.ribbon = new Ribbon(process.env.TOKEN);

        this.ribbon.on("social.notification", notif => {
            if (notif.type === "friend") {
                const user = notif.data.relationship.from._id;
                api.friendUser(user).then(() => { // in order to send dms, there needs to be an open dm session or a friendship from our side
                    sendAutohostWelcome(this.ribbon, user);
                    setTimeout(() => {
                        api.unfriendUser(user);
                    }, 10000);
                });
            }
        });


        this.ribbon.on("social.dm", dm => {
            // if (dm.data.userdata.role === "bot") return;

            if (dm.data.content.startsWith("!")) {
                const args = dm.data.content.substring(1).trim().split(" ");
                const command = args.shift().toLowerCase();

                if (COMMANDS.hasOwnProperty(command)) {
                    COMMANDS[command](this.ribbon, dm.data.user, args);
                } else {
                    this.ribbon.sendDM(dm.data.user, "Sorry, that is not a valid command here. Most Autohost commands should be used in game chat, rather than DMs with me.");
                }
            } else {
                sendAutohostWelcome(this.ribbon, dm.data.user);
            }
        });

        this.ribbon.on("ready", () => {
            this.ribbon.sendMessage({
                command: "social.presence",
                data: {
                    status: "online"
                }
            });
        });

        this.ribbon.on("dead", unrecoverable => {
            if (!unrecoverable) {
                this.connect();
            }
        });
    }

}

module.exports = DMInterface;

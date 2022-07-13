const Tournament = require("./Tournament");
const {pushNotificationBulk} = require("../api/push");

module.exports = {
    sip: {
        participantonly: false,
        handler(user, username, args, autohost) {
            autohost.ribbon.sendChatMessage(":serikasip:");
        }
    },
    warmup: {
        participantonly: true,
        handler(user, username, args, autohost) {
            autohost.ribbon.sendChatMessage("test");
        }
    },
    staff: {
        participantonly: true,
        async handler(user, username, args, autohost) {
            if (args.length === 0) {
                autohost.sendMessage(username, "Usage: !staff [message]");
                return;
            }

            const message = args.join(" ");
            const tournament = await Tournament.get(autohost.tournamentID);

            const ids = tournament.dbTournament.staff.filter(staff => staff.role === "moderator").map(staff => staff.user);
            await pushNotificationBulk(ids, {
                body: message,
                tournament: autohost.tournamentID,
                urgent: true,
                component: "StaffAssistance",
                title: "Assistance request in " + autohost.roomID + " from " + username.toUpperCase(),
                meta: {
                    room: autohost.roomID,
                    match: autohost.matchID,
                    sender: user,
                    sender_name: username
                }
            });

            ids.push(tournament.dbTournament.host);


            autohost.sendMessage(username, "Tournament staff have been notified of your request for assistance.");
        }
    },
    nospec: {
        participantonly: true,
        async handler(user, username, args, autohost) {
            const tournament = await Tournament.get(autohost.tournamentID);

            autohost.spectatorsAllowed = false;

            for (const spec of autohost.ribbon.room.spectators) {
                if (spec !== botUserID && spec !== autohost.player1.user && spec !== autohost.player2.user && !(await tournament.isMod(spec))) {
                    autohost.ribbon.room.kickPlayer(spec, 60000);
                }
            }

            autohost.sendMessage(username, "Spectators are no longer allowed in this lobby.");
        }
    }
};

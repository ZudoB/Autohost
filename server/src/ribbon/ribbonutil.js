const {logMessage, LOG_LEVELS} = require("../log");

function setRoomCode(ribbon, code) {
    return new Promise((resolve, reject) => {

        code = code.trim().substring(0, 15).toUpperCase();

        const handleGmupdate = gmupdate => {
            if (gmupdate.id === code) {
                ribbon.off("gmupdate", handleGmupdate);
                ribbon.off("err", handleError);
                resolve();
            }
        }

        const handleError = err => {
            switch (err) {
                case "room ID is in use":
                    logMessage(LOG_LEVELS.WARNING, "Ribbon Util", `Couldn't set room code ${code}, already in use`);
                    reject("That room code is already in use.");
                    break;
                case "only TETR.IO supporters can do this":
                    logMessage(LOG_LEVELS.ERROR, "Ribbon Util", `Couldn't set room code ${code}, we don't have Supporter`);
                    reject("Autohost doesn't have TETR.IO Supporter, so this command won't work. Change the code manually with !hostmode.");
                    break
                case "this room ID may be profane. use a different one, or ask a moderator to set it for you":
                    logMessage(LOG_LEVELS.WARNING, "Ribbon Util", `Couldn't set room code ${code}, server rejected for profanity`);
                    reject("That room code was rejected by the server for being profane.");
                    break;
                default:
                    return;
            }

            ribbon.off("gmupdate", handleGmupdate);
            ribbon.off("err", handleError);
        }

        ribbon.on("gmupdate", handleGmupdate);
        ribbon.on("err", handleError);

        ribbon.room.setRoomID(code);
    });
}

module.exports = {setRoomCode};

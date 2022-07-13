const {DBLog} = require("./db/models");

const LOG_LEVELS = {
    ULTRAFINE: 10,
    FINE: 20,
    INFO: 30,
    WARNING: 40,
    ERROR: 50,
    CRITICAL: 60
};

function logMessage(level, component, message, meta) {
    const time = new Date();
    const wn = global?.workerName || "primary";
    console.log(`{${wn}} [${component}] [${time.toLocaleString()}] ${message}`);
    DBLog.create({
        level, time, component, message, meta,
        worker: wn
    }).catch(e => {
        console.warn("Failed to log message", e);
    });
}

module.exports = {logMessage, LOG_LEVELS};

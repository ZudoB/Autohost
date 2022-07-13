const {cpus} = require("os");
const cluster = require("cluster");
const {getMe} = require("./gameapi/api");
const {logMessage, LOG_LEVELS} = require("./log");

if (!process.env.TOKEN) {
    console.error("Please specify a TETR.IO bot token in the TOKEN environment variable.");
    process.exit(1);
}

// janky hack!
Error.prototype.getStatusCode = function () {
    return 500;
}

Error.prototype.getUserFacingMessage = function () {
    console.warn(this.stack);
    return "Something went wrong, please try again later.";
}


getMe().then(user => {
    console.log(user);

    if (user.role !== "bot") {
        console.error("Please specify a TETR.IO bot token in the TOKEN environment variable.");
        return process.exit(1);
    }

    if (cluster.isPrimary) {
        // spin up workers

        const workers = [];

        for (let i = 0; i < Math.min(cpus().length, 8); i++) {
            const child_proc = cluster.fork();
            child_proc.process.on("error", e => console.warn("Worker error", e));
            workers.push(child_proc);
        }

        require("./ipc")(workers);
        require("./primary");

        logMessage(LOG_LEVELS.INFO, "Process", "Autohost primary process started at " + new Date().toISOString());
    } else {
        require("./ipc")();
        require("./worker");
    }
}).catch(e => {
    console.error(e);
    return process.exit(1);
});

process.on("uncaughtException", e => {
    logMessage(LOG_LEVELS.CRITICAL, "Process", "Uncaught exception! " + e.message);
});

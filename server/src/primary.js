const chalk = require("chalk");
const pkg = require("../package.json");
const {loadavg} = require("os");

console.log(`${"-".repeat(40)}
${chalk.greenBright("Auto") + chalk.blueBright("host")} version ${chalk.yellowBright(pkg.version)}
Developed by Zudo at ${chalk.underline("https://autoho.st")}
${"-".repeat(40)}`);

const stats_load_30s = [];
const stats_players_30s = [];
const stats_lobbies_30s = [];

let lobbies = new Map();

ipc.onMessage("system.stats", async () => {
    return {stats_load_30s, stats_players_30s, stats_lobbies_30s};
});

ipc.onMessage("system.lobbies", async () => {
    return [...lobbies.values()];
});

ipc.onMessage("system.lobbygone", async lobby => {
    lobbies.delete(lobby);
});

ipc.onMessage("system.reportlobbies", async reported => {
    for (const lobby of reported) {
        lobbies.set(lobby._id, lobby);
    }
});

function getLoad() {
    return Math.floor((loadavg()[0]) * 100) / 100;
}

setInterval(() => {
    stats_load_30s.push(getLoad());
    stats_players_30s.push([...lobbies.values()].reduce((a, b) => a + b.players.length + b.spectators.length, 0));
    stats_lobbies_30s.push(lobbies.size);
    if (stats_load_30s.length > 120) {
        stats_load_30s.shift();
        stats_players_30s.shift();
        stats_lobbies_30s.shift();
    }
}, 30000);

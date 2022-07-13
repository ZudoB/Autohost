const {DBLeaderboard, DBTournament, DBParticipant, DBMatch, DBDispute} = require("../db/models");
const {getLeaderboardSnapshot} = require("../gameapi/api");
const {queueGetTask} = require("../redis/redis");
const {TOURNAMENT_STATES, MATCH_STATES} = require("../data/enums");
const {logMessage, LOG_LEVELS} = require("../log");
const Tournament = require("../tournaments/Tournament");

async function task_leaderboard(leaderboardID) {
    const leaderboardObject = await DBLeaderboard.findById(leaderboardID);
    const snapshot = await getLeaderboardSnapshot();

    leaderboardObject.ready = true;
    leaderboardObject.leaderboard = snapshot.data.users;
    leaderboardObject.markModified("leaderboard");
    await leaderboardObject.save();
}

async function task_seed(tournamentID) {
    const tournament = await Tournament.get(tournamentID);

    const participants = await DBParticipant.find({tournament: tournament.dbTournament._id, checked_in: true});

    const participantArray = participants.slice(0, tournament.dbTournament.max_participants).sort((a, b) => b[tournament.dbTournament.seeding] - a[tournament.dbTournament.seeding]);

    for (const index in participantArray) {
        if (participantArray.hasOwnProperty(index)) {
            const p = participantArray[index];
            await DBParticipant.findByIdAndUpdate(p._id, {
                $set: {
                    seed: parseInt(index) + 1
                }
            });
        }
    }

    // todo: actually create matches
    const match1 = await DBMatch.create({
        tournament: tournament.dbTournament._id,
        round: 1,
        p1score: 0,
        p2score: 0,
        player1: participants[0]?._id,
        player2: participants[1]?._id,
        state: MATCH_STATES.PENDING,
        streamed: false
    });

    const match2 = await DBMatch.create({
        tournament: tournament.dbTournament._id,
        round: 1,
        p1score: 0,
        p2score: 0,
        player1: participants[2]?._id,
        player2: participants[3]?._id,
        state: MATCH_STATES.PENDING,
        streamed: false,
        dependencies: []
    });

    await DBMatch.create({
        tournament: tournament.dbTournament._id,
        round: 2,
        p1score: 0,
        p2score: 0,
        state: MATCH_STATES.PENDING,
        streamed: false,
        dependencies: [match1._id, match2._id]
    });

    tournament.dbTournament.state = TOURNAMENT_STATES.PENDING_START;
    await tournament.dbTournament.save();
}

async function task_tournament_start(tournamentID) {
    const tournament = await Tournament.get(tournamentID);
    tournament.dbTournament.state = TOURNAMENT_STATES.IN_PROGRESS;
    await tournament.dbTournament.save();

    await tournament.updateMatchStates();
}

async function task_rollback(tournamentID) {
    const tournament = await Tournament.get(tournamentID);

    logMessage(LOG_LEVELS.FINE, "Task: Rollback", "Closing tournament matches", {tournamentID});
    await tournament.closeAllMatches();

    logMessage(LOG_LEVELS.FINE, "Task: Rollback", "Reactivating participants", {tournamentID});
    await DBParticipant.updateMany({tournament: tournament.dbTournament._id}, {
        $set: {
            disqualified: false
        }
    });

    logMessage(LOG_LEVELS.FINE, "Task: Rollback", "Clearing matches", {tournamentID});
    await DBMatch.deleteMany({tournament: tournament.dbTournament._id});

    logMessage(LOG_LEVELS.FINE, "Task: Rollback", "Clearing disputes", {tournamentID});
    await DBDispute.deleteMany({tournament: tournament.dbTournament._id});

    logMessage(LOG_LEVELS.FINE, "Task: Rollback", "Changing state", {tournamentID});
    tournament.dbTournament.state = TOURNAMENT_STATES.REGISTRATION;
    await tournament.dbTournament.save();
}

async function task_delete(tournamentID) {
    const tournament = await Tournament.get(tournamentID);

    logMessage(LOG_LEVELS.FINE, "Task: Delete", "Closing tournament matches", {tournamentID});
    await tournament.closeAllMatches();

    logMessage(LOG_LEVELS.FINE, "Task: Delete", "Deleting actual tournament", {tournamentID});
    await tournament.dbTournament.delete();

}

async function task_report_score(data) {
    const tournament = await Tournament.get(data.tournament);
    const args = data.args;
    await challonge.reportScores(args[0], args[1], args[2], args[3], args[4]);
    await tournament.checkCompletionState();
}

async function handleTask(data) {
    switch (data.task) {
        case "leaderboard":
            await task_leaderboard(data.data);
            break;
        case "seed":
            await task_seed(data.data);
            break;
        case "tournament_start":
            await task_tournament_start(data.data);
            break;
        case "rollback":
            await task_rollback(data.data);
            break;
        case "delete":
            await task_delete(data.data);
            break;
        case "report_score":
            await task_report_score(data.data);
            break;
    }
}

function sleep(time) {
    return new Promise(resolve => {
        setTimeout(() => resolve(), time);
    });
}

async function runQueue() {
    const task = await queueGetTask();

    if (task) {
        logMessage(LOG_LEVELS.FINE, "Task Queue", "Processing task of type " + task.task);
        await handleTask(task);
    }

    await sleep(1000 + Math.floor(Math.random() * 1000));

    setImmediate(() => runQueue());
}

module.exports = {runQueue};

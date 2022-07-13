const redis = require("redis");

const client = redis.createClient(process.env.REDIS_URI);

function getLobby(id) {
    return new Promise((resolve, reject) => {
        client.hget("lobbysettings:" + workerName, id, (err, res) => {
            if (err) return reject(err);

            if (res) {
                resolve(JSON.parse(res));
            } else {
                resolve(null);
            }
        });
    });
}

function setLobby(id, settings) {
    return new Promise((resolve, reject) => {
        client.hset("lobbysettings:" + workerName, id, JSON.stringify(settings), err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteLobby(id) {
    return new Promise((resolve, reject) => {
        client.hdel("lobbysettings:" + workerName, id, err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function deleteAllLobbies() {
    return new Promise((resolve, reject) => {
        client.del("lobbysettings:" + workerName, err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function getAllLobbies() {
    return new Promise((resolve, reject) => {
        client.hkeys("lobbysettings:" + workerName, (err, res) => {
            if (err) return reject(err);

            if (res) {
                resolve(res);
            } else {
                resolve([]);
            }
        });
    });
}


function getForcedPlayCount() {
    return new Promise(resolve => {
        client.get("forced_play_count", (err, res) => {
            if (err) {
                resolve(0);
            } else {
                resolve(res);
            }
        })
    });
}

function incrementForcedPlayCount() {
    return new Promise((resolve, reject) => {
        client.incr("forced_play_count", err => {
            if (err) return reject(err);
            resolve();
        })
    });
}

function getCachedAPIResponse(reqKey) {
    return new Promise((resolve, reject) => {
        const key = "cache:" + Buffer.from(reqKey).toString("base64");
        client.get(key, (err, response) => {
            if (err) return reject(err);
            resolve(JSON.parse(response));
        });
    });
}

function storeCachedAPIResponse(reqKey, response, ttl) {
    return new Promise((resolve, reject) => {
        const key = "cache:" + Buffer.from(reqKey).toString("base64");
        client.set(key, JSON.stringify(response), "EX", ttl, err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function getFeatureFlags() {
    return new Promise((resolve, reject) => {
        client.hgetall("featureflags", (err, flags) => {
            if (err) return reject(err);
            resolve(flags || {});
        });
    });
}

function queueAddTasks(tasks) {
    return new Promise((resolve, reject) => {
        client.rpush("taskqueue", tasks.map(task => JSON.stringify(task)), err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function queueGetTask() {
    return new Promise((resolve, reject) => {
        client.lpop("taskqueue", (err, task) => {
            if (err) return reject(err);
            resolve(task ? JSON.parse(task) : undefined);
        });
    });
}

function addRCEResponse(worker, lobby, message) {
    return new Promise((resolve, reject) => {
        client.lpush("rce_responses", JSON.stringify({worker, lobby, message, time: Date.now()}), err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

function getRCEResponses() {
    return new Promise((resolve, reject) => {
        client.lrange("rce_responses", 0, -1, (err, responses) => {
            if (err) return reject(err);
            resolve(responses.map(r => JSON.parse(r)));
        });
    });
}

function deleteRCEResponses() {
    return new Promise((resolve, reject) => {
        client.del("rce_responses", err => {
            if (err) return reject(err);
            resolve();
        });
    });
}

module.exports = {
    getLobby,
    setLobby,
    deleteLobby,
    getAllLobbies,
    getForcedPlayCount,
    incrementForcedPlayCount,
    getCachedAPIResponse,
    storeCachedAPIResponse,
    getFeatureFlags,
    queueAddTasks,
    queueGetTask,
    deleteAllLobbies,
    addRCEResponse,
    getRCEResponses,
    deleteRCEResponses
};

const {logMessage} = require("./log");
global.ipc = {};

ipc._returnChannels = new Map();
ipc._messageHandlers = new Map();
ipc._workers = [];

const WORKER_NAMES = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "w10", "w11", "w12", "w13", "w14", "w15", "w16"];

const workerNames = new Map();

ipc.sendAsync = function (target, command, data) {
    const messageID = Date.now() + "." + Math.floor(Math.random() * 10000);

    let resolve;
    let reject;

    const promise = new Promise((a, b) => {
        resolve = a;
        reject = b;
    });

    function send() {
        process.send({
            _id: messageID,
            target,
            command,
            data
        });
    }


    let timeout = setTimeout(() => {
        send();
        // reject(new Error(`IPC timeout - ${command} [${messageID}]`));
    }, 5000);

    ipc._returnChannels.set(messageID, data => {
        clearTimeout(timeout);
        resolve(data);
    });

    send();

    return promise;
}

ipc.sendToAll = async function (command, data) {
    let workers = await ipc.sendAsync("X-PRIMARY", "ipc.getWorkers");
    if (!workers) {
        workers = ipc._workers;
    } else {
        ipc._workers = workers;
    }
    return await Promise.all(workers.map(worker => ipc.sendAsync(worker, command, data)));
}

ipc.onMessage = function (command, callback) {
    ipc._messageHandlers.set(command, callback);
}

function ipcReplyHandler(message) {
    const promise = ipc._returnChannels.get(message._id);
    if (promise) {
        promise(message.data);
    }
}

async function ipcMessageHandler(message, sender) {
    const handler = ipc._messageHandlers.get(message.command);
    if (handler) {
        const res = await handler(message.data);
        const reply = {
            command: "ipc.reply",
            _id: message._id,
            data: res
        };
        if (sender) {
            sender.process.send(reply);
        } else {
            process.send(reply);
        }
    } else {
        throw new Error("not handling an ipc message!");
        // todo: ipc error of some sort
    }
}

ipc.onMessage("ipc.workerInfo", info => {
    global.workerIndex = info.index;
    global.workerName = info.name;
    global.isFirstWorker = info.first;
    ipc.onReady && ipc.onReady();
});

ipc.onMessage("ipc.getWorkers", () => [...workerNames.keys()]);
ipc.onMessage("ipc.getWorkerStatuses", () => {
    const workers = {};
    for (const [name, worker] of workerNames.entries()) {
        workers[name] = !worker.isDead();
    }
    return workers;
});

module.exports = function (workers) {
    if (workers) {
        let workerIndex = 0;
        for (const worker of workers) {
            workerNames.set(WORKER_NAMES[workerIndex], worker);
            worker.process.send({
                command: "ipc.workerInfo", data: {
                    index: workerIndex,
                    name: WORKER_NAMES[workerIndex],
                    first: workerIndex === 0
                }
            });
            workerIndex++;

            worker.process.on("message", message => {
                if (message.command === "ipc.reply") {
                    const livingWorkers = workers.filter(worker => !worker.isDead());
                    for (const target of livingWorkers) {
                        if (target && !target.isDead()) {
                            target.process.send({
                                _id: message._id,
                                data: message.data,
                                command: message.command
                            });
                        } else {
                            throw new Error("not sending an ipc reply!");
                        }
                    }
                } else {
                    if (message.target === "X-PRIMARY") {
                        ipcMessageHandler(message, worker);
                    } else {
                        let target;

                        if (message.target === "X-RANDOM") {
                            const livingWorkers = workers.filter(worker => !worker.isDead());
                            target = livingWorkers[Math.floor(Math.random() * livingWorkers.length)];
                        } else {
                            target = workerNames.get(message.target);
                            if (!target) {
                                // ipc error
                                return;
                            }
                        }

                        if (target && !target.isDead()) {
                            target.process.send({
                                _id: message._id,
                                data: message.data,
                                command: message.command
                            });
                        } else {
                            logMessage("IPC", "not sending an ipc message! " + message.command);
                            // throw new Error("not sending an ipc message!");
                        }
                    }
                }
            });
        }

    } else {
        process.on("message", message => {
            if (message.command === "ipc.reply") {
                ipcReplyHandler(message);
            } else {
                ipcMessageHandler(message);
            }
        });
    }
}

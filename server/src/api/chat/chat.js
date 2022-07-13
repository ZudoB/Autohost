const ws = require("ws");
const msgpack = require("msgpack-lite");
const {logMessage, LOG_LEVELS} = require("../../log");
const {randomBytes} = require("crypto");
const jwt = require("jsonwebtoken");
const {DBUser} = require("../../db/models");

function server(http) {
    const server = new ws.Server({server: http, path: "/chat"});

    const clients = new Map();
    const userIDs = new Map();
    const userRoles = new Map();
    const roomMemberships = new Map();

    this.getRooms = function () {
        return [...new Set([...roomMemberships.values()])];
    }

    function doMessageSend(senderRoom, msgToSend) {
        for (const [name, room] of roomMemberships) {
            if (room !== senderRoom) continue;
            const client = clients.get(name);
            client.send(msgpack.encode({command: "message", data: msgToSend}));
        }
    }

    function handleMessage(name, ws, message) {
        const senderRoom = roomMemberships.get(name);

        if (!senderRoom) {
            ws.send(msgpack.encode({command: "cope", data: "not in a room"}));
            return ws.close(1002);
        }

        logMessage(LOG_LEVELS.FINE, "Chat Server", `[${name}] ${message}`);

        const msgToSend = {
            id: Math.random(), // this is stupid!
            content: message,
            sender: userIDs.get(name),
            role: userRoles.get(name)
        };

        ipc.sendToAll("chat.doMessageSend", [senderRoom, msgToSend]);
    }

    function handleAuth(name, ws, token) {
        jwt.verify(token, process.env.JWT_KEY, (err, claim) => {
            if (err || claim.scope !== "chat" || !claim.sub || !claim.room) {
                ws.send(msgpack.encode({command: "cope", data: "invalid token"}));
                return ws.close(1002);
            }

            userIDs.set(name, claim.sub);
            userRoles.set(name, claim.role);
            roomMemberships.set(name, claim.room);

            if (claim.room.startsWith("stream:")) {
                ws.send(msgpack.encode({
                    command: "message",
                    data: {
                        id: Math.random(),
                        system: true,
                        content: "Welcome to the chat room for streamed matches. Players in streamed matches, as well as tournament staff, can see your messages here."
                    }
                }));
            } else if (claim.room.startsWith("match:")) {
                ws.send(msgpack.encode({
                    command: "message",
                    data: {
                        id: Math.random(),
                        system: true,
                        content: "Welcome to match chat. Communicate with your opponent here."
                    }
                }));
            }

            const userCount = [...roomMemberships.values()].filter(room => room === claim.room).length;

            ws.send(msgpack.encode({
                command: "message",
                data: {
                    id: Math.random(),
                    system: true,
                    content: `There ${userCount === 1 ? "is one user" : "are " + userCount + " users"} in chat.`
                }
            }));

            ipc.sendToAll("chat.doMessageSend", [claim.room, {
                id: Math.random(),
                role: userRoles.get(name),
                sender: claim.sub,
                content: "connected to chat",
                system: true
            }]);
        });
    }

    function handleCommand(name, ws, command, data) {
        switch (command) {
            case "auth":
                handleAuth(name, ws, data);
                break;
            case "message":
                handleMessage(name, ws, data);
                break;
        }
    }

    server.on("connection", ws => {
        const name = workerName + "-" + randomBytes(32).toString("hex");
        clients.set(name, ws);

        ws.on("message", msg => {
            try {
                const message = msgpack.decode(msg);
                handleCommand(name, ws, message.command, message.data);
            } catch (e) {
                console.warn(e);
                ws.send(msgpack.encode({command: "cope", data: "malformed message"}));
                ws.close(1002);
            }
        });

        ws.on("close", () => {
            if (roomMemberships.has(name) && userIDs.has(name)) {
                ipc.sendToAll("chat.doMessageSend", [roomMemberships.get(name), {
                    id: Math.random(),
                    role: userRoles.get(name),
                    sender: userIDs.get(name),
                    content: "disconnected from chat",
                    system: true
                }]);
            }
            clients.delete(name);
            userIDs.delete(name);
            roomMemberships.delete(name);
        });
    });

    ipc.onMessage("chat.doMessageSend", ([senderRoom, msgToSend]) => {
        doMessageSend(senderRoom, msgToSend);
    });
}

function createChatToken(user, room, role) {
    return new Promise(async (resolve, reject) => {
        const profile = await DBUser.findOne({tetrio_id: user});
        if (!profile) reject("User profile not found.");

        let realRole = role;
        if (profile.roles.developer) {
            realRole = "developer";
        } else if (profile.roles.moderator) {
            realRole = "moderator";
        }

        jwt.sign({
            sub: user,
            room,
            scope: "chat",
            role: realRole
        }, process.env.JWT_KEY, {
            expiresIn: "1h"
        }, (err, jwt) => {
            if (err) return reject(err);
            resolve(jwt);
        });
    });
}

module.exports = {server, createChatToken};

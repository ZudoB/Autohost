const WebSocket = require("ws");
const msgpack = require("msgpack-lite");
const EventEmitter = require("events");
const Room = require("./Room");
const api = require("../gameapi/api");
const {logMessage, LOG_LEVELS} = require("../log");

const RIBBON_ENDPOINT = "wss://tetr.io/ribbon";

const RIBBON_PREFIXES = {
    STANDARD: 0x45,
    EXTRACTED_ID: 0xAE,
    BATCH: 0x58,
    PING_PONG: 0xB0
};

const PING_PONG = {
    PING: 0x0B,
    PONG: 0x0C
};

function ribbonDecode(packet) {
    switch (packet[0]) {
        case RIBBON_PREFIXES.STANDARD:
            return [msgpack.decode(packet.slice(1))];
        case RIBBON_PREFIXES.EXTRACTED_ID:
            const message = msgpack.decode(packet.slice(5));
            const view = new DataView(packet.buffer);
            message.id = view.getUint32(1, false); // shove it back in
            return [message];
        case RIBBON_PREFIXES.BATCH:
            const items = [];
            const lengths = [];
            const batchView = new DataView(packet.buffer);

            // Get the lengths
            for (let i = 0; true; i++) {
                const length = batchView.getUint32(1 + (i * 4), false);
                if (length === 0) {
                    // We've hit the end of the batch
                    break;
                }
                lengths.push(length);
            }

            // Get the items at those lengths
            let pointer = 0;
            for (let i = 0; i < lengths.length; i++) {
                items.push(packet.slice(1 + (lengths.length * 4) + 4 + pointer, 1 + (lengths.length * 4) + 4 + pointer + lengths[i]));
                pointer += lengths[i];
            }

            return [].concat(...items.map(item => ribbonDecode(item)));
        case RIBBON_PREFIXES.PING_PONG:
            if (packet[1] === PING_PONG.PONG) {
                return [{command: "pong"}];
            } else {
                return [];
            }
        default: // wtf?
            return [msgpack.decode(packet)]; // osk does this so i will too :woomy:
    }
}

function ribbonEncode(message) { // todo: perhaps we should actually follow tetrio.js implementation here?
    const msgpacked = msgpack.encode(message);
    const packet = new Uint8Array(msgpacked.length + 1);
    packet.set([RIBBON_PREFIXES.STANDARD], 0);
    packet.set(msgpacked, 1);

    return packet;
}

class Ribbon extends EventEmitter {

    constructor(token) {
        super();

        this.endpoint = RIBBON_ENDPOINT;

        this.token = token;

        this.dead = false;
        this.open = false;
        this.authed = false;

        this.room = undefined;

        this.migrating = false;

        this.sendHistory = [];
        this.sendQueue = [];
        this.lastSent = 0;
        this.lastReceived = -99;

        this.lastPong = Date.now();

        api.getRibbonVersion().then(version => {
            this.version = version;
            return api.getRibbonEndpoint();
        }).then(endpoint => {
            this.endpoint = endpoint;
        }).catch(() => {
            this.log("Failed to get the ribbon endpoint, using the default instead");
        }).finally(() => {
            this.connect();
        });
    }

    connect() {
        logMessage(LOG_LEVELS.FINE, "Ribbon", "Connecting to " + this.endpoint);

        this.ws = new WebSocket(this.endpoint);

        this.ws.on("message", data => {
            const messages = ribbonDecode(new Uint8Array(data));
            messages.forEach(msg => this.handleMessageInternal(msg));
        });

        this.ws.on("open", () => {
            logMessage(LOG_LEVELS.FINE, "Ribbon", "WebSocket open " + this.ws.url);

            this.open = true;

            if (this.resume_token) {
                this.sendMessageImmediate({
                    command: "resume",
                    socketid: this.socket_id,
                    resumetoken: this.resume_token
                });
                this.sendMessageImmediate({command: "hello", packets: this.sendHistory});
            } else {
                this.sendMessageImmediate({command: "new"});
            }

            this.pingInterval = setInterval(() => {
                if (this.ws.readyState !== 1) return;

                if (Date.now() - this.lastPong > 30000) {
                    logMessage(LOG_LEVELS.FINE, "Ribbon", "Pong timed out, disconnecting");
                    this.ws.close(4001, "pong timeout");
                }

                this.ws.send(new Uint8Array([RIBBON_PREFIXES.PING_PONG, PING_PONG.PING]));
            }, 5000);
        });

        this.ws.on("close", (code, reason) => {
            logMessage(LOG_LEVELS.FINE, "Ribbon", `WebSocket closed: ${code} (${reason})`);

            if (this.migrateEndpoint) {
                this.connect(this.migrateEndpoint);
                return;
            }

            this.ws.removeAllListeners();
            this.open = false;
            clearInterval(this.pingInterval);

            if (!this.dead) {
                this.connect();
            }
        });

        this.ws.on("error", err => {
            logMessage(LOG_LEVELS.WARNING, "Ribbon", "Disconnecting due to WebSocket error: " + err.message);
            this.ws.removeAllListeners();
            this.open = false;
            this.ws.close(1006, "WebSocket error");

            if (!this.dead) {
                this.connect();
            }
        });
    }

    sendMessageImmediate(message) {
        if (process.env.DUMP_RIBBON) {
            logMessage(LOG_LEVELS.ULTRAFINE, "RibbonOut", JSON.stringify(message));
        }
        this.ws.send(ribbonEncode(message));
    }

    flushQueue() {
        if (!this.open) return;
        const messageCount = this.sendQueue.length;
        for (let i = 0; i < messageCount; i++) {
            const message = this.sendQueue.shift();
            this.sendMessageImmediate(message);
        }
    }

    die(unrecoverable) {
        unrecoverable = !!unrecoverable;

        if (this.dead) return;

        this.dead = true;

        if (this.ws) {
            this.ws.close(1000, "die called");
        }

        this.emit("dead", unrecoverable);
    }

    disconnectGracefully() {
        this.flushQueue();
        this.sendMessageImmediate({command: "die"});
        this.die();
    }

    sendMessage(message) {
        this.lastSent++;
        message.id = this.lastSent;
        this.sendQueue.push(message);
        this.sendHistory.push(message);
        if (this.sendQueue.length >= 500) {
            this.sendHistory.shift();
        }
        this.flushQueue();
    }

    handleMessageInternal(message) {
        if (message.command !== "pong" && process.env.DUMP_RIBBON) {
            logMessage(LOG_LEVELS.ULTRAFINE, "RibbonIn", JSON.stringify(message));
        }

        if (message.type === "Buffer") {
            const packet = Buffer.from(message.data);
            const message = ribbonDecode(packet);
            this.handleMessageInternal(message);
        }

        if (message.command !== "hello" && message.id) {
            if (message.id > this.lastReceived) {
                this.lastReceived = message.id;
            } else {
                return;
            }
        }

        switch (message.command) {
            case "kick":
                if (message.data.reason === "BANNED") {
                    logMessage(LOG_LEVELS.CRITICAL, "Ribbon", "Autohost is BANNED (or was kicked by staff) - check immediately!");
                    this.die(true);
                } else {
                    logMessage(LOG_LEVELS.WARNING, "Ribbon", "Ribbon kicked (reason: " + message.data.reason + ")");
                    this.emit("kick", message.data);
                    this.die();
                }
                break;
            case "nope":
                logMessage(LOG_LEVELS.ERROR, "Ribbon", "Ribbon noped out! This shouldn't happen.");
                this.emit("nope", message.data);
                this.die();
                break;
            case "hello":
                this.socket_id = message.id;
                this.resume_token = message.resume;

                if (!this.authed) {
                    this.sendMessageImmediate({ // auth the client
                        command: "authorize",
                        id: this.lastSent,
                        data: {
                            token: this.token,
                            handling: {
                                arr: 0,
                                das: 0,
                                sdf: 0,
                                safelock: false
                            },
                            signature: {
                                commit: this.version
                            }
                        }
                    });
                }

                message.packets.forEach(p => this.handleMessageInternal(p)); // handle any dropped messages
                break;
            case "authorize":
                if (message.data.success) {
                    this.authed = true;

                    this.emit("ready");
                } else {
                    this.die();
                    logMessage(LOG_LEVELS.ERROR, "Ribbon", "Failed to authorise ribbon.");
                    this.emit("error", "failed to authorise");
                }
                break;
            case "migrate":
                this.endpoint = message.data.endpoint;
                this.ws.close(4003, "migrating");
                this.emit("migrate", message.data);
                break;
            case "pong":
                this.lastPong = Date.now();
                break;
            default:
                this.handleMessage(message);
        }
    }

    handleMessage(message) {
        switch (message.command) {
            case "joinroom":
                logMessage(LOG_LEVELS.INFO, "Ribbon", "Joined a room with ID " + message.data.id);
                this.room = new Room(this, {id: message.data.id});
                break;
            case "chat":
                const username = message.data.user.username;
                const text = message.data.content;
                logMessage(LOG_LEVELS.FINE, "Ribbon", `[${username}] ${text}`, {
                    user: message.data.user._id,
                    room: this.room?.id
                });
                break;
        }

        this.emit(message.command, message.data);
    }

    createRoom(isPrivate) {
        this.sendMessage({command: "createroom", data: isPrivate ? "private" : "public"});
    }

    joinRoom(code) {
        this.sendMessage({command: "joinroom", data: code});
    }

    socialInvite(player) {
        this.sendMessage({command: "social.invite", data: player});
    }

    sendDM(recipient, message) {
        this.sendMessage({command: "social.dm", data: {recipient, msg: message}});
    }

    ackDM(recipient) {
        this.sendMessage({command: "social.relationships.ack", data: recipient});
    }

    sendChatMessage(message) {
        this.sendMessage({command: "chat", data: message});
    }

    clearChat() {
        this.sendMessage({command: "clearchat"});
    }
}

module.exports = Ribbon;

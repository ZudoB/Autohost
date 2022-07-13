const mongoose = require("mongoose");
const {mongo} = require("mongoose");
const {MATCH_STATES} = require("../data/enums");

const userSchema = new mongoose.Schema({
    tetrio_id: {
        type: String,
        unique: true,
        index: true
    },
    roles: {
        developer: Boolean,
        partner: Boolean,
        supporter: Boolean,
        moderator: Boolean
    },
    token_cycle: Number,
    totp_secret: String,
    join_emote: String,
    discord_id: {
        type: String,
        index: true
    },
    discord_tag: String,
    discord_tokens: {},
    discord_assignable_roles: {
        announcements: {
            type: Boolean,
            default: false
        },
        tournaments: {
            type: Boolean,
            default: false
        }
    },
    seen: Date,
    created: Date,
    last_name: String,
    ip: {
        ip: String,
        country: String
    }
});

const tournamentSchema = new mongoose.Schema({
    url: {
        type: String,
        unique: true,
        index: true
    },

    partnered: Boolean,

    state: String,

    name: String,
    shortname: String,
    summary: String,
    description: String,

    type: String,

    ft: Number,
    wb: Number,

    lategame: {
        definition: Number,
        ft: Number,
        wb: Number
    },

    config: String,

    rank_limit: {
        min: String,
        max: String
    },

    historical_max: {
        type: String,
        default: "x"
    },

    require_calibration: Boolean,

    max_rd: {
        type: Number,
        min: 60,
        max: 350,
        default: 100
    },

    leaderboard: mongo.ObjectId,

    seeding: {
        type: String,
        enum: ["tr", "vs", "apm"],
        default: "tr"
    },

    host: String,

    start_at: Date,

    max_participants: {
        type: Number,
        default: 512
    },

    staff: [
        {
            user: String,
            role: String
        }
    ],

    image: {
        type: String,
        default: "autohost.png"
    },

    brand_colour: {
        type: String,
        default: "#4DBA87"
    },

    private: {
        type: Boolean,
        default: false
    },

    frozen_reason: String,

    discord: {
        guild: String,
        role: String,
        enforce_membership: {
            type: Boolean,
            default: false
        }
    },

    roomcode: String
});

const logSchema = new mongoose.Schema({
    time: {
        type: Date,
        index: true
    },
    level: {
        type: Number,
        default: 0,
        index: true
    },
    component: String,
    message: String,
    worker: String,
    meta: {}
}, {
    capped: 524288000 // 500 MiB
});

const punishmentSchema = new mongoose.Schema({
    user: {
        type: String,
        index: true
    },
    type: String,
    reason: String,
    staff: String,
    expiry: Date,
    note: String,
    revoked_by: String
});

const participantSchema = new mongoose.Schema({
    user: {
        type: String,
        index: true
    },
    tournament: {
        type: mongo.ObjectId,
        index: true,
    },
    name: String,
    tr: Number,
    apm: Number,
    vs: Number,
    rank: String,
    percentile_rank: String,
    checked_in: {
        type: Boolean,
        default: false
    },
    seed: Number,
    position: Number,
    disqualified: {
        type: Boolean,
        default: false
    }
});

participantSchema.index({user: 1, tournament: 1}, {unique: true});

const notificationSchema = new mongoose.Schema({
    user: {
        type: String,
        index: true
    },
    time: {
        type: Date
    },
    title: {
        type: String
    },
    body: {
        type: String
    },
    component: {
        type: String
    },
    tournament: mongo.ObjectId,
    url: String,
    seen: {
        type: Boolean,
        default: false
    },
    urgent: {
        type: Boolean,
        default: false
    },
    meta: {}
});

const subscriptionSchema = new mongoose.Schema({
    user: {
        type: String,
        index: true,
        required: true
    },
    sub: {
        endpoint: {
            type: String,
            required: true
        },
        keys: {
            p256dh: {
                type: String,
                required: true
            },
            auth: {
                type: String,
                required: true
            }
        }
    }
});

subscriptionSchema.index({user: 1, "sub.endpoint": 1}, {unique: true});

const leaderboardSchema = new mongoose.Schema({
    ready: {
        type: Boolean,
        default: false
    },
    leaderboard: Object
});

const presetSchema = new mongoose.Schema({
    code: {
        type: String,
        index: true,
        required: true
    },
    owner: String,
    global: Boolean,
    config: []
});

const tournamentLogSchema = new mongoose.Schema({
    tournament: {
        type: mongo.ObjectId,
        index: true
    },
    action: {
        type: String
    },
    time: Date,
    actor: String,
    target: String,
    meta: {}
});

const matchSchema = new mongoose.Schema({
    tournament: {
        type: mongo.ObjectId,
        index: true
    },
    round: Number,
    p1score: {
        type: Number,
        default: 0
    },
    p2score: {
        type: Number,
        default: 0
    },
    player1: mongo.ObjectId,
    player2: mongo.ObjectId,
    state: {
        type: String,
        enum: Object.values(MATCH_STATES)
    },
    streamed: {
        type: Boolean,
        default: false
    },
    opened_at: {
        type: Date
    },
    dependencies: {
        type: [mongo.ObjectId],
        default: []
    },
    started: {
        type: Boolean,
        default: false
    }
});

const discordGuildSchema = new mongoose.Schema({
    guild_id: {
        type: String,
        index: true
    },
    user_role: String,
    user_role_invert_behaviour: {
        type: Boolean,
        default: false
    },
    global_assignable_roles: {
        announcements: String,
        tournaments: String
    }
});

const disputeSchema = new mongoose.Schema({
    tournament: {
        type: mongo.ObjectId,
        index: true
    },
    match: {
        type: mongo.ObjectId,
        index: true
    },
    sender: String,
    reason: String,
    closed: {
        type: Boolean,
        default: false
    },
    time: Date
});

const DBUser = mongoose.model("User", userSchema);
const DBTournament = mongoose.model("Tournament", tournamentSchema);
const DBLog = mongoose.model("Log", logSchema);
const DBPunishment = mongoose.model("Punishment", punishmentSchema);
const DBParticipant = mongoose.model("Participant", participantSchema);
const DBNotification = mongoose.model("Notification", notificationSchema);
const DBSubscription = mongoose.model("Subscription", subscriptionSchema);
const DBLeaderboard = mongoose.model("Leaderboard", leaderboardSchema);
const DBPreset = mongoose.model("Preset", presetSchema);
const DBTournamentLog = mongoose.model("TournamentLog", tournamentLogSchema);
const DBDiscordGuild = mongoose.model("DiscordGuild", discordGuildSchema);
const DBMatch = mongoose.model("Match", matchSchema);
const DBDispute = mongoose.model("Dispute", disputeSchema);

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
    useFindAndModify: false
}).then(() => {
    console.log("MongoDB connected.");
}).catch(e => {
    console.error("Couldn't connect to MongoDB.", e);
    process.exit(1);
});

module.exports = {
    DBTournament,
    DBLog,
    DBUser,
    DBPunishment,
    DBParticipant,
    DBNotification,
    DBSubscription,
    DBLeaderboard,
    DBPreset,
    DBTournamentLog,
    DBDiscordGuild,
    DBMatch,
    DBDispute
};

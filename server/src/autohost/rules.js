const {getBan} = require("../data/globalbans");
const {RANK_HIERARCHY} = require("../data/data");
const {PUNISHMENT_TYPES} = require("../data/enums");

function xpToLevel(xp) {
    return Math.pow(xp / 500, 0.6) + (xp / (5000 + Math.max(0, xp - 4000000) / 5000)) + 1;
}

const RULES = {
    anons_allowed: {
        type: Boolean,
        default: true,
        check(value, user) {
            return !value && user.role === "anon";
        },
        message() {
            return "Unregistered (anonymous / guest) players cannot play in this room";
        },
        description(value) {
            return `Anonymous players allowed: ${value ? ":checked:" : ":crossed:"}`;
        }
    },
    unrated_allowed: {
        type: Boolean,
        default: true,
        check(value, user) {
            return !value && user.league.percentile_rank === "z";
        },
        message() {
            return "Players who have not completed their Tetra League rating games cannot play in this room";
        },
        description(value) {
            return `Unrated players allowed: ${value ? ":checked:" : ":crossed:"}`;
        }
    },
    rankless_allowed: {
        type: Boolean,
        default: true,
        check(value, user) {
            return !value && user.league.rank === "z";
        },
        message() {
            return "Players without a rank letter cannot play in this room";
        },
        description(value) {
            return `Rankless players allowed: ${value ? ":checked:" : ":crossed:"}`;
        }
    },
    max_rank: {
        type: "rank",
        default: "z",
        check(value, user) {
            if (value !== "z" && user.league.percentile_rank !== "z") {
                if (RANK_HIERARCHY.indexOf(value) !== -1) {
                    return RANK_HIERARCHY.indexOf(user.league.percentile_rank) > RANK_HIERARCHY.indexOf(value);
                } else {
                    return Math.round(user.league.rating) > value;
                }
            }

            return false;
        },
        message(value) {
            if (RANK_HIERARCHY.indexOf(value) !== -1) {
                return `Your rank is too high for this room (maximum is around :rank${value.replace("+", "plus").replace("-", "minus")}:)`;
            } else {
                return `Your TR is too high for this room (maximum is ${value} TR)`;
            }
        },
        description(value) {
            if (value === "z") {
                return "Maximum rank: no limit";
            } else if (RANK_HIERARCHY.indexOf(value) !== -1) {
                return `Maximum rank: :rank${value.replace("+", "plus").replace("-", "minus")}:`;
            } else {
                return `Maximum rank: ${value} TR`;
            }
        }
    },
    min_rank: {
        type: "rank",
        default: "z",
        check(value, user) {
            if (value !== "z" && user.league.percentile_rank !== "z") {
                if (RANK_HIERARCHY.indexOf(value) !== -1) {
                    return RANK_HIERARCHY.indexOf(user.league.percentile_rank) < RANK_HIERARCHY.indexOf(value);
                } else {
                    return Math.round(user.league.rating) < value;
                }
            }

            return false;
        },
        message(value) {
            if (RANK_HIERARCHY.indexOf(value) !== -1) {
                return `Your rank is too low for this room (minimum is around :rank${value.replace("+", "plus").replace("-", "minus")}:)`;
            } else {
                return `Your TR is too low for this room (minimum is ${value} TR)`;
            }
        },
        description(value) {
            if (value === "z") {
                return "Minimum rank: no limit";
            } else if (RANK_HIERARCHY.indexOf(value) !== -1) {
                return `Minimum rank: :rank${value.replace("+", "plus").replace("-", "minus")}:`;
            } else {
                return `Minimum rank: ${value} TR`;
            }
        }
    },
    min_level: {
        type: Number,
        default: 0,
        check(value, user) {
            return value !== 0 && xpToLevel(user.xp) < value;
        },
        message(value) {
            return `Your level is too low for this room (minimum is ${value})`
        },
        description(value) {
            return `Minimum level: ${value}`;
        }
    },
    max_apm: {
        type: Number,
        default: 0,
        check(value, user, autohost) {
            return value > 0 && autohost.apmCalculator.infractions.get(user.username) >= 3;
        },
        message(value) {
            return `You cannot play as you have been consistently exceeding the room's APM limit (${value} APM)`;
        },
        description(value) {
            return `Maximum APM: ${value !== 0 ? value : "no limit"}`;
        },
        onchange(autohost, oldvalue, newvalue) {
            if (!oldvalue) {
                autohost.ribbon.sendChatMessage("Please note that APM limits are still in development, and may not behave as expected. Be generous with your APM limits, as low limits may inadvertently exclude legitimate players.");
            }

            if (newvalue > oldvalue) {
                if (oldvalue > 0) {
                    autohost.ribbon.sendChatMessage("The APM limit was increased. Players who previously exceeded the APM limit can now play again.");
                }
                autohost.apmCalculator.infractions.clear();
            }
        }
    }
};

async function checkAll(ruleset, user, autohost) {
    const ban = await getBan(user._id, PUNISHMENT_TYPES.PERSIST_BLOCK);

    if (ban && autohost.persist) {
        return {
            rule: "globalban",
            message: `You have been banned from participating in unattended Autohost lobbies such as this one - get in touch with the bot developer if you think this was done in error`
        }
    }

    if (autohost.smurfProtection && await smurfProtection.isSuspectedSmurf(user._id)) {
        return {
            rule: "smurfprotection",
            message: "Your account has been automatically flagged as suspicious, and as such you cannot play in this lobby right now. Please come back later, or find a different lobby to play in"
        }
    }

    for (const rule in RULES) {
        if (RULES.hasOwnProperty(rule)) {
            // default is a reserved keyword lol
            const {check, default: defaultValue, message} = RULES[rule];

            let value;

            if (ruleset.hasOwnProperty(rule)) {
                value = ruleset[rule];
            } else {
                value = defaultValue;
            }

            if (check(value, user, autohost)) {
                return {
                    rule,
                    message: message(value)
                };
            }
        }
    }

    return {rule: undefined, message: undefined};
}

module.exports = {checkAll, RULES};

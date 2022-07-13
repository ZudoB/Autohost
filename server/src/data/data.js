const RANK_HIERARCHY = ["d", "d+", "c-", "c", "c+", "b-", "b", "b+", "a-", "a", "a+", "s-", "s", "s+", "ss", "u", "x"];

const DISALLOWED_URLS = ["tournaments", "about", "moderation", "system", "lobby", "create-tournament", "settings", "admin"];

const TOURNAMENT_CONSTANTS = {
    MATCH_TIMEOUT_DURATION: process.env.NODE_ENV === "production" ? 600000 : 60000 // 10 minutes prod, 1 minute dev
};

module.exports = {RANK_HIERARCHY, DISALLOWED_URLS, TOURNAMENT_CONSTANTS};

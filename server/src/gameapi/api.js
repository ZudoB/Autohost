const fetch = require("node-fetch");
const {logMessage, LOG_LEVELS} = require("../log");
const {getCachedAPIResponse, storeCachedAPIResponse} = require("../redis/redis");

const API_BASE = "https://ch.tetr.io/api/";
const AUTHED_BASE = "https://tetr.io/api/";
const UA = "Autohost/" + require("../../package.json").version + " (zudo@kagar.in)";

function log(message) {
    logMessage(LOG_LEVELS.FINE, "GameAPI", message);
}

async function get(url) {
    return await (await fetch(encodeURI(API_BASE + url), {
        method: "GET",
        headers: {
            "Authorization": "Bearer " + process.env.TOKEN,
            "User-Agent": UA
        }
    })).json();
}

async function getAuthed(url) {
    return await (await fetch(encodeURI(AUTHED_BASE + url), {
        method: "GET",
        headers: {
            "Authorization": "Bearer " + process.env.TOKEN,
            "User-Agent": UA
        }
    })).json();
}

async function postAuthed(url, body) {
    return await (await fetch(encodeURI(AUTHED_BASE + url), {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + process.env.TOKEN,
            "Content-Type": "application/json",
            "User-Agent": UA
        },
        body: JSON.stringify(body)
    })).json();
}

async function getUser(id) {
    if (!id || id.length === 0) return undefined;

    const cachedResponse = await getCachedAPIResponse("users/" + id);

    if (cachedResponse) {
        log(`Retrieved CACHED user info for ${id}`);
        return cachedResponse;
    };

    const result = await get("users/" + id);

    if (result.success) {
        log(`Retrieved user info for ${id}`);
        await storeCachedAPIResponse("users/" + id, result.data.user, 600);
        return result.data.user;
    } else {
        return undefined;
    }
}

async function getNews(id) {
    if (!id || id.length === 0) return undefined;

    const cachedResponse = await getCachedAPIResponse("news/user_" + id);

    if (cachedResponse) {
        log(`Retrieved CACHED news info for ${id}`);
        return cachedResponse;
    };

    const result = await get("news/user_" + id);

    if (result.success) {
        log(`Retrieved news info for ${id}`);
        await storeCachedAPIResponse("news/user_" + id, result.data.news, 600);
        return result.data.news;
    } else {
        return undefined;
    }
}

async function getTLStream(id) {
    if (!id || id.length === 0) return undefined;

    const cachedResponse = await getCachedAPIResponse("streams/league_userrecent_" + id);

    if (cachedResponse) {
        log(`Retrieved CACHED league stream for ${id}`);
        return cachedResponse;
    };

    const result = await get("streams/league_userrecent_" + id);

    if (result.success) {
        log(`Retrieved league stream for ${id}`);
        await storeCachedAPIResponse("streams/league_userrecent_" + id, result.data.records, 600);
        return result.data.records;
    } else {
        return undefined;
    }
}

async function getMe() {
    const result = await getAuthed("users/me");

    if (result && result.success) {
        log(`Retrieved personal information`);
        return result.user;
    } else {
        return undefined;
    }
}

async function getRibbonVersion() {
    const result = await getAuthed("server/environment");

    if (result.success) {
        log(`Retrieved Ribbon version ${result.signature.commit.id}`);
        return result.signature.commit;
    } else {
        return undefined;
    }
}

async function getRibbonEndpoint() {
    const result = await getAuthed("server/ribbon");

    if (result && result.success) {
        log(`Retrieved recommended ribbon endpoint: ${result.endpoint}`)
        return result.endpoint;
    } else {
        throw new Error("Unable to find ribbon endpoint");
    }
}

async function friendUser(user) {
    log(`Friending user ${user}`);
    return await postAuthed("relationships/friend", {user});
}

async function unfriendUser(user) {
    log(`Unfriending user ${user}`);
    return await postAuthed("relationships/remove", {user});
}

async function getLeaderboardSnapshot() {
    return get("users/lists/league/all");
}

module.exports = {getUser, getMe, getRibbonVersion, getRibbonEndpoint, friendUser, unfriendUser, getLeaderboardSnapshot, getNews, getTLStream};

const fetch = require("node-fetch");

async function tokenExchange(code) {
    const body = new URLSearchParams();
    body.set("client_id", process.env.DISCORD_CLIENT_ID);
    body.set("client_secret", process.env.DISCORD_CLIENT_SECRET);
    body.set("grant_type", "authorization_code");
    body.set("code", code);
    body.set("redirect_uri", process.env.DISCORD_REDIRECT_URI);
    const res = await fetch("https://discord.com/api/v8/oauth2/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
    });
    return await res.json();
}

async function refreshToken(token) {
    const body = new URLSearchParams();
    body.set("client_id", process.env.DISCORD_CLIENT_ID);
    body.set("client_secret", process.env.DISCORD_CLIENT_SECRET);
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", token);
    body.set("redirect_uri", process.env.DISCORD_REDIRECT_URI);
    const res = await fetch("https://discord.com/api/v8/oauth2/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: body.toString()
    });
    return await res.json();
}

async function getDiscordUser(token) {
    const res = await fetch("https://discord.com/api/v8/users/@me", {
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    return await res.json();
}


async function getUserGuilds(token) {
    const res = await fetch("https://discord.com/api/v8/users/@me/guilds", {
        headers: {
            "Authorization": "Bearer " + token
        }
    });

    if (res.status === 401) {
        throw new Error("Unauthorised");
    }

    return await res.json();
}

module.exports = {tokenExchange, refreshToken, getDiscordUser, getUserGuilds};

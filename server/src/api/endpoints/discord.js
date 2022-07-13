const {Router} = require("express");
const {auth, disallowBlocked} = require("../auth");
const {json} = require("body-parser");
const {tokenExchange, getDiscordUser} = require("../../discord/oauth");
const {DBDiscordGuild, DBUser} = require("../../db/models");
const {logMessage, LOG_LEVELS} = require("../../log");

const REDIRECT_URI = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify&prompt=consent&state=`;
const INVITE_URI = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&scope=bot&permissions=8858370049`;

module.exports = function () {

    const app = new Router();

    app.get("/link", (req, res) => {
        res.redirect(REDIRECT_URI + encodeURIComponent(req.query.state));
    });

    app.get("/invite", (req, res) => {
        res.redirect(INVITE_URI);
    });

    app.get("/redirect", (req, res) => {
        res.end(`
        <script>
        const usp = new URLSearchParams(window.location.search);
        const code = usp.get("code");
        const state = usp.get("state");
       
        const origin = atob("${btoa(process.env.WEB_ORIGIN)}");
        window.opener.postMessage({"ah_discord_auth_code": code, "ah_discord_auth_state": state}, origin);
        window.opener.postMessage({"ah_discord_auth_code": code, "ah_discord_auth_state": state}, "https://verify.autoho.st");
        </script>
        `);
    });

    app.post("/code", auth, disallowBlocked, json(), async (req, res) => {
        if (!req.body.code) {
            return res.status(401).json({error: "No code provided"});
        }

        const tokens = await tokenExchange(req.body.code);

        if (tokens.access_token) {
            req.user.discord_tokens = tokens;

            const user = await getDiscordUser(tokens.access_token);

            const existingUser = await DBUser.findOne({discord_id: user.id});

            if (existingUser) {
                logMessage(LOG_LEVELS.INFO, "Discord OAuth", `Refusing to link ${user.username}#${user.discriminator} (${user.id})`);
                return res.status(403).json({error: "That account is already in use by another user."});
            }

            req.user.discord_id = user.id;
            req.user.discord_tag = user.username + "#" + user.discriminator;

            await req.user.save();
            await ipc.sendToAll("discord.applyUserRoles", req.user.tetrio_id);
            res.json({success: "Discord account linked successfully!"});
        } else {
            res.status(500).json({error: "Failed to link account, try again."});
        }
    });

    app.delete("/link", auth, disallowBlocked, async (req, res) => {
        req.user.discord_tokens = undefined;
        req.user.discord_id = undefined;
        req.user.discord_tag = undefined;
        req.user.save();
        res.json({success: "Unlinked your Discord account."});
    });

    app.post("/refresh", auth, disallowBlocked, async (req, res) => {
        try {
            if (!req.user.discord_tokens?.access_token) {
                return res.status(401).json({error: "You need to link your Discord account first."});
            }

            await ipc.sendToAll("discord.applyUserRoles", req.user.tetrio_id);

            res.json({success: "Refreshed your roles."});
        } catch (e) {
            console.warn(e);
            res.status(500).json({error: "Couldn't refresh. Try again in a little while."});
        }
    });

    app.get("/guilds", auth, async (req, res) => {
        try {
            if (!req.user.discord_id) return res.status(400).json({error: "No linked Discord account."});

            const guilds = (await ipc.sendToAll("discord.getGuildsWithMember", req.user.discord_id)).flat().filter(g => g.manageable);

            const rawRoles = (await ipc.sendToAll("discord.getGuildRoles", guilds.map(g => g.id)));

            const roles = {};

            for (const shardRoles of rawRoles) {
                for (const guild in shardRoles) {
                    if (shardRoles.hasOwnProperty(guild) && !roles.hasOwnProperty(guild)) {
                        roles[guild] = shardRoles[guild]
                    }
                }
            }

            for (const guild in roles) {
                roles[guild] = roles[guild].filter(r => r.editable);
                roles[guild].sort((a, b) => {
                    return b.position - a.position;
                });
            }

            const configs = (await DBDiscordGuild.find({guild_id: {$in: guilds.map(g => g.id)}}));

            res.json({
                guilds: guilds.map(g => {
                    let config = configs.find(c => c.guild_id === g.id);
                    if (!config) {
                        config = {user_role: undefined};
                    }
                    return {
                        id: g.id,
                        name: g.name,
                        present: true,
                        config,
                        roles: roles[g.id]
                    }
                })
            });
        } catch (e) {
            console.warn(e);
            res.status(500).json({error: "Could not load your list of servers. Try again in a few minutes."});
        }
    });

    app.post("/config/:guild", json(), auth, disallowBlocked, async (req, res) => {
        const user = req.user.discord_id;
        const guild = req.params.guild;
        const config = {user_role: req.body.user_role || undefined};

        const validated = (await ipc.sendToAll("discord.validateConfigChanges", [guild, config, user])).filter(r => !!r).length > 0;

        if (!validated) {
            return res.status(401).json({error: "Configuration couldn't validate, did your permissions change?"});
        }

        const dbGuild = await DBDiscordGuild.findOne({guild_id: guild});

        if (dbGuild) {
            dbGuild.user_role = config.user_role;
            await dbGuild.save();
        } else {
            await DBDiscordGuild.create({
                guild_id: req.params.guild,
                user_role: config.user_role
            });
        }


        res.json({success: "Server configuration saved."});
    });

    app.post("/assignable", json(), auth, disallowBlocked, async (req, res) => {
        const {tournaments, announcements} = req.body;

        req.user.discord_assignable_roles.tournaments = !!tournaments;
        req.user.discord_assignable_roles.announcements = !!announcements;

        await req.user.save();

        await ipc.sendToAll("discord.applyUserRoles", req.user.tetrio_id);

        res.json({success: "Roles selected."});
    });

    return app;
}

const Discord = require("discord.js");
const {logMessage, LOG_LEVELS} = require("../log");
const {DBDiscordGuild, DBUser, DBTournament, DBParticipant} = require("../db/models");
const {getBan} = require("../data/globalbans");
const {TOURNAMENT_STATES} = require("../data/enums");

class DiscordBot {

    constructor(token, shard, totalShards) {
        this.client = new Discord.Client({
            shards: shard,
            shardCount: totalShards,
            intents: ["GUILD_MEMBERS", "GUILDS"],
            ws: {properties: {$browser: "Discord iOS"}}
        });

        this.client.on("ready", () => {
            const version = require("../../package.json").version;
            this.client.user.setPresence({
                statusCode: "online",
                activities: [
                    {
                        type: "PLAYING",
                        name: `v${version} [${workerName}]`
                    }
                ]
            })
            logMessage(LOG_LEVELS.INFO, "Discord", "Connected to Discord as shard " + shard + ". User: " + this.client.user.tag);
        });

        this.client.on("guildCreate", guild => {
            logMessage(LOG_LEVELS.FINE, "Discord", "Joined guild " + guild.name + "!");
        });

        this.client.login(token);

        this.client.on("guildMemberAdd", async member => {
            const user = await DBUser.findOne({discord_id: member.user.id});
            if (user) {
                setTimeout(() => {
                    this.applyUserRoles(user.tetrio_id);
                }, 10000);
            }
        });
    }

    async applyUserRoles(tetrioUser) {
        const user = await DBUser.findOne({tetrio_id: tetrioUser});

        const ban = await getBan(user.tetrio_id);

        if (ban) {
            logMessage(LOG_LEVELS.FINE, "Discord", "Not updating AH user roles for platform blocked user " + member.user.tag);
            return;
        }

        for (const guild of this.client.guilds.cache.values()) {
            try {
                const member = await guild.members.fetch(user.discord_id);

                const tournaments = await DBTournament.find({
                    "discord.guild": guild.id,
                    "discord.role": {$ne: null},
                    state: TOURNAMENT_STATES.REGISTRATION
                });

                for (const tournament of tournaments) {
                    const participant = await DBParticipant.findOne({"user": tetrioUser, "tournament": tournament._id});

                    if (participant) {
                        await member.roles.add(tournament.discord.role);
                    } else {
                        await member.roles.remove(tournament.discord.role);
                    }
                }

                const dbGuild = await DBDiscordGuild.findOne({guild_id: guild.id});

                if (!dbGuild) return;

                if (dbGuild.user_role) {
                    if (dbGuild.user_role_invert_behaviour) {
                        await member.roles.remove(dbGuild.user_role);
                    } else {
                        await member.roles.add(dbGuild.user_role);
                    }

                }

                for (const role in dbGuild.global_assignable_roles) {
                    if (!dbGuild.global_assignable_roles.hasOwnProperty(role)) break;
                    if (user.discord_assignable_roles[role]) {
                        await member.roles.add(dbGuild.global_assignable_roles[role]);
                    } else {
                        await member.roles.remove(dbGuild.global_assignable_roles[role]);
                    }
                }
            } catch {
                // discordjs is busted af
            }
        }
    }

    async getGuildsWithMember(user) {
        const guilds = [];
        for (const guild of this.client.guilds.cache.values()) {
            const apiGuild = await guild.fetch();
            if ((await apiGuild.members.fetch()).has(user)) {
                const member = await apiGuild.members.fetch(user);
                guilds.push({
                    name: guild.name,
                    id: guild.id,
                    manageable: member.permissions.has("MANAGE_GUILD")
                });
            }
        }

        return guilds;
    }

    async getGuildRoles(guilds) {
        const guildRoles = {};

        for (const guild of guilds) {
            try {
                let apiGuild = this.client.guilds.cache.get(guild);

                if (apiGuild) {
                    apiGuild = await apiGuild.fetch();

                    const apiMember = await apiGuild.members.fetch(this.client.user.id);
                    const apiHighestRole = apiMember.roles.highest;

                    const apiRoles = await apiGuild.roles.fetch();

                    const roles = [];

                    for (const role of apiRoles.values()) {
                        roles.push({
                            id: role.id,
                            name: role.name,
                            editable: !role.managed && role.id !== apiGuild.roles.everyone.id && apiHighestRole.comparePositionTo(role) > 0,
                            position: role.position
                        });
                    }
                    guildRoles[guild] = roles;
                }
            } catch {
                // ignore
            }
        }

        return guildRoles;
    }

    async isMemberPresent(guild, member) {
        try {
            let apiGuild = this.client.guilds.cache.get(guild);

            if (apiGuild) {
                const apiMember = await apiGuild.members.fetch(member);
                return !!apiMember;
            }
        } catch {
            // nothing
        }

        return false;
    }

    async createInvite(guild) {
        try {
            let apiGuild = this.client.guilds.cache.get(guild);

            if (apiGuild) {
                if (apiGuild.vanityURLCode) {
                    return apiGuild.vanityURLCode;
                }

                let channel = apiGuild.rulesChannelId;

                if (!channel) {
                    channel = (await apiGuild.channels.fetch()).find(c => c.isText() && c.viewable)?.id;
                }

                if (!channel) return;

                const invite = await apiGuild.invites.create(channel, {
                    maxUses: 1,
                    unique: false,
                    maxAge: 86400,
                    reason: "Automatically generated invite for an Autohost user."
                });

                return invite.code;
            }
        } catch {
            // nothing
        }
    }

    async validateConfigChanges(guild, config, user) {
        try {
            const apiGuild = this.client.guilds.cache.get(guild);

            if (!apiGuild) {
                // don't change guilds we're not present in
                return false;
            }

            const apiMember = await apiGuild.members.fetch(user);

            if (!apiMember || !(apiMember.permissions.has("MANAGE_GUILD") || apiMember.permissions.has("ADMINISTRATOR"))) {
                // disallow unauthorised changes
                return false;
            }

            const apiBotMember = await apiGuild.members.fetch(this.client.user.id);
            const apiHighestRole = apiBotMember.roles.highest;

            if (config.user_role) {
                const newUserRole = await apiGuild.roles.fetch(config.user_role);

                return (!newUserRole.managed && newUserRole.id !== apiGuild.roles.everyone.id && apiHighestRole.comparePositionTo(newUserRole) > 0);
            }

            return true;
        } catch (e) {
            console.log(e);
            return false;
        }
    }
}

module.exports = DiscordBot;

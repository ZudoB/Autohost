const {DBPunishment} = require("../db/models");
const {PUNISHMENT_TYPES} = require("../data/enums");
const {getUser} = require("../gameapi/api");

async function getBans(user) {
    const punishments = await DBPunishment.find({
        user: user,
        revoked_by: null,
        $or: [
            {expiry: null},
            {expiry: {$gt: new Date()}}
        ]
    });

    const profile = await getUser(user);

    if (profile.role === "banned") {
        punishments.push({
            _id: "vblock",
            user: user,
            type: PUNISHMENT_TYPES.PLATFORM_BLOCK,
            reason: "Your account is banned from TETR.IO. Please log in to the game to review the reason for your ban.",
            staff: botUserID,
            expiry: null,
            note: "Virtual block, how are you seeing this?",
            revoked_by: null
        });
    }

    // if (profile.badstanding) {
    //     punishments.push({
    //         _id: "vblock",
    //         user: user,
    //         type: PUNISHMENT_TYPES.HOST_BLOCK,
    //         reason: "Your TETR.IO account is in bad standing. Once your account reverts to good standing, this block will be automatically lifted.",
    //         staff: botUserID,
    //         expiry: null,
    //         note: "Virtual block, how are you seeing this?",
    //         revoked_by: null
    //     });
    // }

    return punishments;
}

async function getBan(user, type) {
    let types = [PUNISHMENT_TYPES.PLATFORM_BLOCK];

    if (type instanceof Array) {
        types = types.concat(type);
    } else if (type) {
        types.push(type);
    }

    return (await getBans(user)).find(ban => types.indexOf(ban.type) !== -1);
}

module.exports = {getBans, getBan};

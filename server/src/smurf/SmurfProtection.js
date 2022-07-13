const {getUser, getTLStream} = require("../gameapi/api");

const SCORE_BASE = 100;
const SCORE_CUTOFF = 0;

const SCORE_CONSTANTS = {
    // buffs
    SUPPORTER: 50,
    LOW_RD: 500,
    LOSS: 5,


    // debuffs
    BRAND_NEW_ACCOUNT: -50,
    FORFEIT: -10,
    SWEEP: -5,
    UNRANKED: -20,
    DIFFICULT_BADGE: -20,
    WIN: -10
};

const NEW_ACCOUNT_CUTOFF = 604800000;

const DIFFICULT_BADGES = ["secretgrade", "allclear", "20tsd"];

class SmurfProtection {

    constructor() {
        this.scoreModifiers = new Map();

        setInterval(() => {
            for (const [user, score] of this.scoreModifiers.entries()) {
                if (score < 0) {
                    this.scoreModifiers.set(user, score + 1);
                }
            }
        }, 60000);
    }

    async _getBaseScore(id) {
        if (!this.scoreModifiers.has(id)) {
            this.scoreModifiers.set(id, 0);
        }

        const profile = await getUser(id);
        const stream = await getTLStream(id);

        let baseScore = SCORE_BASE;

        if (profile.supporter) baseScore += SCORE_CONSTANTS.SUPPORTER;
        if (profile.league.rating === -1) baseScore += SCORE_CONSTANTS.UNRANKED;
        if (profile.league.rd < 90) baseScore += SCORE_CONSTANTS.LOW_RD;


        if (Date.now() - new Date(profile.ts).getTime() <= NEW_ACCOUNT_CUTOFF) {
            baseScore += SCORE_CONSTANTS.BRAND_NEW_ACCOUNT;
        }

        if (profile.badges.find(b => DIFFICULT_BADGES.includes(b.id))) baseScore += SCORE_CONSTANTS.DIFFICULT_BADGE;

        for (const record of stream) {
            const ec = record.endcontext;

            if (ec[0].user._id !== id) {
                ec.reverse();
            }

            const context = ec[0];
            const opponentContext = ec[1];

            if (!context.active) {
                baseScore += SCORE_CONSTANTS.FORFEIT;
            } else if (opponentContext.active && opponentContext.wins === 0) {
                baseScore += SCORE_CONSTANTS.SWEEP;
            }
        }

        return baseScore;
    }

    _addModifier(id, value) {
        let modifier = 0;
        if (this.scoreModifiers.has(id)) {
            modifier = this.scoreModifiers.get(id);
        }

        modifier += value;

        this.scoreModifiers.set(id, modifier);
    }

    recordWin(id) {
        this._addModifier(id, SCORE_CONSTANTS.WIN);
    }

    recordLoss(id) {
        this._addModifier(id, SCORE_CONSTANTS.LOSS);
    }

    async getUserScore(id) {
        return (await this._getBaseScore(id)) + this.scoreModifiers.get(id);
    }

    async isSuspectedSmurf(id) {
        return await this.getUserScore(id) < SCORE_CUTOFF;
    }
}

module.exports = SmurfProtection;

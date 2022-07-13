const {APM_LIMIT_EXEMPTIONS} = require("../data/enums");

module.exports = [
    {
        id: "rank_cap_ss",
        name: "SS AND BELOW ONLY [AUTOHOST]",
        code: process.env.NODE_ENV === "production" ? "AUTOHOSTSS" : "AHDEVSS",
        config: [{
            index: "meta.bgm",
            value: "RANDOMbattle"
        }],
        options: {
            rules: {
                anons_allowed: false,
                unrated_allowed: true,
                rankless_allowed: true,
                max_rank: "ss"
            },
            smurfProtection: true,
            motdID: "persist",
            apmLimitExemption: APM_LIMIT_EXEMPTIONS.RANKED,
            autostart: 10
        }
    },
    {
        id: "rank_cap_s",
        name: "S AND BELOW ONLY [AUTOHOST]",
        code: process.env.NODE_ENV === "production" ? "AUTOHOSTS" : "AHDEVS",
        config: [{
            index: "meta.bgm",
            value: "RANDOMbattle"
        }],
        options: {
            rules: {
                anons_allowed: false,
                unrated_allowed: true,
                rankless_allowed: true,
                max_rank: "s",
            },
            smurfProtection: true,
            motdID: "persist",
            apmLimitExemption: APM_LIMIT_EXEMPTIONS.RANKED,
            autostart: 10
        }
    },
    {
        id: "rank_cap_bplus",
        name: "B+ AND BELOW ONLY [AUTOHOST]",
        code: process.env.NODE_ENV === "production" ? "AUTOHOSTBPLUS" : "AHDEVBPLUS",
        config: [{
            index: "meta.bgm",
            value: "RANDOMbattle"
        }],
        options: {
            rules: {
                anons_allowed: false,
                unrated_allowed: true,
                rankless_allowed: true,
                max_rank: "b+",
            },
            smurfProtection: true,
            motdID: "persist",
            apmLimitExemption: APM_LIMIT_EXEMPTIONS.RANKED,
            autostart: 10
        }
    }
];

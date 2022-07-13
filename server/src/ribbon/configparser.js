/*
retrieve CONFIG_TYPES with:

document.querySelectorAll("#room_content_container .room_config_item").forEach(el => {
    CONFIG_TYPES[el.dataset.index] = el.getAttribute("type");
});
 */

const CONFIG_TYPES = {
    "meta.name": null,
    "meta.userlimit": "number",
    "meta.allowAnonymous": "checkbox",
    "meta.bgm": null,
    "meta.match.type": null,
    "meta.match.ft": "number",
    "meta.match.wb": "number",
    "game.options.stock": "number",
    "game.options.bagtype": null,
    "game.options.spinbonuses": null,
    "game.options.allow180": "checkbox",
    "game.options.kickset": null,
    "game.options.allow_harddrop": "checkbox",
    "game.options.display_next": "checkbox",
    "game.options.display_hold": "checkbox",
    "game.options.nextcount": "number",
    "game.options.display_shadow": "checkbox",
    "game.options.are": "number",
    "game.options.lineclear_are": "number",
    "game.options.room_handling": "checkbox",
    "game.options.room_handling_arr": "number",
    "game.options.room_handling_das": "number",
    "game.options.room_handling_sdf": "number",
    "game.options.g": "number",
    "game.options.gincrease": "number",
    "game.options.gmargin": "number",
    "game.options.garbagemultiplier": "number",
    "game.options.garbagemargin": "number",
    "game.options.garbageincrease": "number",
    "game.options.locktime": "number",
    "game.options.garbagespeed": "number",
    "game.options.garbagecap": "number",
    "game.options.garbagecapincrease": "number",
    "game.options.garbagecapmax": "number",
    "game.options.manual_allowed": "checkbox",
    "game.options.b2bchaining": "checkbox",
    "game.options.clutch": "checkbox",
    "game.options.passthrough": "checkbox"
};

// don't allow changes to allowAnonymous since that also blocks bots from (re)joining
// also don't allow room name changes since we want to do that with !name
const BLACKLISTED_CONFIGS = ["meta.allowAnonymous", "meta.name"];

function parseSet(setString) {
    const settings = [];

    const s = setString?.trim();

    if (!s || s === "") {
        return [];
    }

    const props = s.split(";");

    props.forEach(prop => {
        let [index, value] = prop.trim().split("=");

        if (!CONFIG_TYPES.hasOwnProperty(index) || BLACKLISTED_CONFIGS.indexOf(index) !== -1) {
            throw new Error(`Invalid config option ${index}.`);
        }

        if (CONFIG_TYPES[index] === "checkbox") {
            value = !(value === "false" || value === "0");
        } else if (CONFIG_TYPES[index] === "number") {
            if (isNaN(parseFloat(value))) {
                throw new Error("Invalid numeric value for " + index + ".");
            }

            value = parseFloat(value).toString(); // be sneaky and unfuck any weirdness that parseFloat allows
        }

        settings.push({
            index, value
        });
    });

    return settings;
}

function gmupdateToUpdateconfig(config) {
    const settings = [];

    for (const index of Object.keys(CONFIG_TYPES)) {
        if (BLACKLISTED_CONFIGS.indexOf(index) !== -1) continue;

        const value = index.split(".").reduce((obj, i) => obj[i], config);
        settings.push({index, value});
    }

    return settings;
}

module.exports = {parseSet, gmupdateToUpdateconfig};

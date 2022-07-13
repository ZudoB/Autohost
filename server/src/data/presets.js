const {parseSet} = require("../ribbon/configparser");

const DEFAULTS = "meta.userlimit=0;meta.bgm=RANDOM;meta.match.type=versus;meta.match.ft=1;meta.match.wb=1;game.options.stock=0;game.options.bagtype=7-bag;game.options.spinbonuses=T-spins;game.options.allow180=1;game.options.kickset=SRS+;game.options.allow_harddrop=1;game.options.display_next=1;game.options.display_hold=1;game.options.nextcount=5;game.options.display_shadow=1;game.options.are=0;game.options.lineclear_are=0;game.options.room_handling=0;game.options.room_handling_arr=2;game.options.room_handling_das=10;game.options.room_handling_sdf=6;game.options.g=0.02;game.options.gincrease=0.0025;game.options.gmargin=3600;game.options.garbagemultiplier=1;game.options.garbagemargin=10800;game.options.garbageincrease=0.008;game.options.locktime=30;game.options.garbagespeed=20;game.options.garbagecap=8;game.options.garbagecapincrease=0;game.options.garbagecapmax=40;game.options.manual_allowed=0;game.options.b2bchaining=1;game.options.clutch=1";

const PRESET_STRINGS = {
    "classic": "game.options.bagtype=classic;game.options.spinbonuses=none;game.options.allow180=0;game.options.kickset=NRS;game.options.allow_harddrop=0;game.options.display_hold=0;game.options.nextcount=1;game.options.display_shadow=0;game.options.are=8;game.options.lineclear_are=18;game.options.room_handling=1;game.options.room_handling_arr=5;game.options.room_handling_das=16;game.options.room_handling_sdf=6;game.options.gincrease=0.0005;game.options.locktime=8;game.options.clutch=0",
    "nestrio": "game.options.bagtype=classic;game.options.display_hold=0;game.options.nextcount=1",
    "ppt": "game.options.allow180=0;game.options.kickset=SRS;game.options.are=7;game.options.lineclear_are=35;game.options.room_handling=1;game.options.room_handling_arr=2;game.options.room_handling_das=9;game.options.room_handling_sdf=6;game.options.garbagespeed=1;game.options.garbagecap=40;game.options.b2bchaining=0;game.options.clutch=0",
    "axis": "game.options.spinbonuses=all;game.options.allow180=0;game.options.room_handling=1;game.options.room_handling_arr=1.5;game.options.room_handling_das=10;game.options.room_handling_sdf=15;game.options.g=0.04;game.options.manual_allowed=1;game.options.garbagespeed=1;game.options.garbagecap=40"
};

const presets = {};

presets.default = parseSet(DEFAULTS);

Object.keys(PRESET_STRINGS).forEach(preset => {
    let settings = parseSet(PRESET_STRINGS[preset]);

    const filteredDefaults = presets.default.filter(setting => {
        return !settings.find(s => s.index === setting.index);
    });

    settings = settings.concat(filteredDefaults);
    presets[preset] = settings;
});

module.exports = presets;

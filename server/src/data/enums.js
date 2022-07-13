const SERIALISE_TYPES = {
    "AUTOHOST": 0,
    "TOURNAMENT": 1,
    "STREAM": 2
}

const TWO_PLAYER_MODES = {
    "STATIC_HOTSEAT": 0,
    "DYNAMIC_HOTSEAT": 1
};

const APM_LIMIT_EXEMPTIONS = {
    "NONE": 0,
    "RANKED": 1
};

const TOURNAMENT_TYPES = {
    "SINGLE_ELIMINATION": "single elimination",
    "DOUBLE_ELIMINATION": "double elimination",
    "ROUND_ROBIN": "round robin"
};

const TOURNAMENT_STATES = {
    "REGISTRATION": "registration", // pending check in, registration open
    "PENDING_CHECK_IN": "pending_check_in", // pending check in, registration closed
    "CHECK_IN": "check_in", // check in, pending start
    "SEEDING": "seeding", // seeding in progress
    "PENDING_START": "pending_start", // check in closed, pending start
    "STARTING": "starting", // start in progress
    "IN_PROGRESS": "in_progress", // self explanatory
    "MATCHES_COMPLETE": "matches_complete", // matches complete, awaiting finalisation
    "TOURNAMENT_COMPLETE": "tournament_complete", // all done!
    "ROLLBACK": "rollback" // rollback in progress
};

const PUNISHMENT_TYPES = {
    "PLATFORM_BLOCK": "platform_block", // ALL autohost functionality disabled (i.e. all of the below)
    "TOURNAMENT_BLOCK": "tournament_block", // no tournament participation or hosting allowed
    "PERSIST_BLOCK": "persist_block", // no participation in persist lobbies
    "HOST_BLOCK": "host_block" // no hosting tournaments or lobbies
};

const NOTIFICATION_CATEGORIES = {
    "PROMOTIONAL": "promotional", // tourney promos - optional
    "ANNOUNCEMENT": "announcement", // dev announcements - optional
    "SYSTEM": "system" // tournament and account notifications - required
};

const TOURNEY_LOG_TYPES = {
    "CREATE": "create", // [actor] created tournament
    "DELETE": "delete", // [actor] deleted tournament,
    "ROLLBACK": "rollback", // [actor] rolled the tournament back
    "REGISTER_SELF": "register_self", // [actor] registered for the tournament
    "REGISTER_OTHER": "register_other", // [actor] registered [target] for the tournament
    "UNREGISTER_SELF": "unregister_self", // [actor] unregistered from the tournament
    "UNREGISTER_OTHER": "unregister_other", // [actor] unregistered [target] from the tournament
    "DISQUALIFY": "disqualify", // [actor] disqualified [target] from the tournament
    "CHECK_IN_SELF": "check_in_self", // you get the gist
    "CHECK_IN_OTHER": "check_in_other",
    "CHECK_OUT_SELF": "check_out_self",
    "CHECK_OUT_OTHER": "check_out_other",
    "CLOSE_REGISTRATION": "close_registration",
    "OPEN_CHECK_IN": "open_check_in",
    "CLOSE_CHECK_IN": "close_check_in",
    "START_TOURNAMENT": "start_tournament",
    "FINALISE_SCORES": "finalise_scores",
    "REPORT_SCORES": "report_scores", // [actor] reported scores for [target] as [7-0]
    "REOPEN_MATCH": "reopen_match",
    "ADD_STAFF": "add_staff", // [actor] added [target] to staff as [moderator]
    "REMOVE_STAFF": "remove_staff",
    "MARK_STREAMED": "mark_streamed",
    "UNMARK_STREAMED": "unmark_streamed",
    "EDIT": "edit"
};

const MATCH_STATES = {
    "PENDING": "pending", // waiting for a dependent match
    "OPEN": "open", // waiting for start
    "COMPLETE": "complete" // match complete, scores reported
};

module.exports = {
    SERIALISE_TYPES,
    TWO_PLAYER_MODES,
    APM_LIMIT_EXEMPTIONS,
    TOURNAMENT_TYPES,
    TOURNAMENT_STATES,
    PUNISHMENT_TYPES,
    NOTIFICATION_CATEGORIES,
    TOURNEY_LOG_TYPES,
    MATCH_STATES
};

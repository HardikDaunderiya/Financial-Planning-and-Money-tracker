package in.gullak.common.log;

/** The only business event names that may appear in INFO logs. Log ids and counts only. */
public final class Events {
    public static final String AUTH_OTP_REQUESTED = "auth.otp.requested";
    public static final String AUTH_OTP_VERIFIED = "auth.otp.verified";
    public static final String AUTH_SESSION_REVOKED = "auth.session.revoked";
    public static final String PROFILE_UPDATED = "profile.updated";
    public static final String FIXED_COST_CHANGED = "profile.fixed_cost.changed";
    public static final String CYCLE_OPENED = "cycle.opened";
    public static final String CYCLE_CLOSED = "cycle.closed";
    public static final String CYCLE_POOL_SET = "cycle.pool_set";
    public static final String SPEND_CREATED = "spend.created";
    public static final String SPEND_UPDATED = "spend.updated";
    public static final String SPEND_DELETED = "spend.deleted";
    public static final String SPEND_LINKED = "spend.linked";
    public static final String SPEND_UNLINKED = "spend.unlinked";
    public static final String IMPORT_RECEIVED = "import.received";
    public static final String IMPORT_PREVIEWED = "import.previewed";
    public static final String IMPORT_COMMITTED = "import.committed";
    public static final String IMPORT_DISCARDED = "import.discarded";
    public static final String GOAL_CREATED = "goal.created";
    public static final String GOAL_UPDATED = "goal.updated";
    public static final String GOAL_PAUSED = "goal.paused";
    public static final String GOAL_DELETED = "goal.deleted";
    public static final String GOAL_CATCHUP = "goal.catchup";
    public static final String GOAL_MILESTONE = "goal.milestone";
    public static final String XP_AWARDED = "xp.awarded";
    public static final String XP_REVERSED = "xp.reversed";
    public static final String STREAK_UPDATED = "streak.updated";
    public static final String BADGE_EARNED = "badge.earned";
    public static final String PUSH_SENT = "push.sent";
    public static final String EXPORT_REQUESTED = "export.requested";
    public static final String ACCOUNT_DELETION_REQUESTED = "account.deletion.requested";
    public static final String ACCOUNT_RESTORED = "account.restored";
    public static final String JOB_STARTED = "job.started";
    public static final String JOB_FINISHED = "job.finished";
    public static final String JOB_FAILED = "job.failed";

    private Events() {}
}

package in.gullak.content;

import in.gullak.common.money.RupeeFormat;
import in.gullak.profile.Personality;
import java.util.EnumMap;
import java.util.Map;

/**
 * The Gullak's Home line for each personality and mood. Plan 6 moves these into the database so new
 * lines ship without a release; the strings and placeholders stay the same.
 */
public final class GullakLines {
    private static final Map<Personality, Map<Mood, String>> LINES = new EnumMap<>(Personality.class);

    static {
        put(Personality.CHILL,
            "{left} left for today. Nice and steady.",
            "{left} left. Easy does it.",
            "Only {left} left today. Maybe skip the extra chai.",
            "Over by {over}. Happens. Tomorrow’s a fresh start.");
        put(Personality.SAVAGE,
            "{left} left. Hide it before Swiggy smells it.",
            "{left} left. Don’t get ideas.",
            "{left} left. Put the phone down.",
            "Over by {over}. Swiggy again? I’m going to lie down.");
        put(Personality.MOM,
            "{left} left, beta. Ghar ka khana tonight, okay?",
            "{left} left. Eat something proper, beta.",
            "Only {left} left? Beta, what did you buy?",
            "Over by {over}? Beta, ghar pe khana nahi hai kya?");
        put(Personality.HYPE,
            "{left} to play with today. Look at you go.",
            "{left} left and you’re cruising",
            "{left} left. You’ve got this, finish strong.",
            "Over by {over}, but you logged it all. That’s growth.");
    }

    private GullakLines() {}

    /**
     * @param leftPaise what is left of today's budget
     * @param overPaise the full overspend to show: today's plus any pool deficit
     */
    public static String line(Personality personality, Mood mood, long leftPaise, long overPaise) {
        return LINES.get(personality).get(mood)
            .replace("{left}", RupeeFormat.format(leftPaise))
            .replace("{over}", RupeeFormat.format(overPaise));
    }

    private static void put(Personality p, String happy, String calm, String nervous, String fainted) {
        Map<Mood, String> byMood = new EnumMap<>(Mood.class);
        byMood.put(Mood.HAPPY, happy);
        byMood.put(Mood.CALM, calm);
        byMood.put(Mood.NERVOUS, nervous);
        byMood.put(Mood.FAINTED, fainted);
        LINES.put(p, byMood);
    }
}

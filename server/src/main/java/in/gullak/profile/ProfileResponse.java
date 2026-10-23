package in.gullak.profile;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.LocalTime;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ProfileResponse(
    long incomePaise,
    long savingsPaise,
    PaydayRule paydayRule,
    Integer paydayDay,
    Personality personality,
    LocalTime morningTime,
    LocalTime nightTime,
    String timezone) {

    static ProfileResponse from(Profile p) {
        return new ProfileResponse(p.incomePaise(), p.savingsPaise(), p.paydayRule(), p.paydayDay(),
            p.personality(), p.morningTime(), p.nightTime(), p.timezone());
    }
}

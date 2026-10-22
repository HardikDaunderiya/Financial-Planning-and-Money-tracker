package in.gullak.profile;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import in.gullak.support.ApiTest;
import in.gullak.support.TestUser;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.Test;

class ProfileApiTest extends ApiTest {

    @Test
    void getReturnsTheSavedProfile() throws Exception { // API-PRO-01, API-PRO-02
        TestUser u = exampleUser();
        mvc.perform(get("/api/v1/me/profile").with(auth(u)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.incomePaise").value(5_000_000))
            .andExpect(jsonPath("$.savingsPaise").value(2_000_000))
            .andExpect(jsonPath("$.paydayRule").value("FIXED_DAY"))
            .andExpect(jsonPath("$.paydayDay").value(1))
            .andExpect(jsonPath("$.personality").value("CHILL"))
            .andExpect(jsonPath("$.timezone").value("Asia/Kolkata"));
    }

    @Test
    void getBeforeSetupIsSetupIncomplete() throws Exception {
        TestUser u = signIn();
        mvc.perform(get("/api/v1/me/profile").with(auth(u)))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.code").value("SETUP_INCOMPLETE"));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "\"incomePaise\":0",            // API-PRO-03
        "\"incomePaise\":-1",           // API-PRO-03
        "\"paydayDay\":0",              // API-PRO-04
        "\"paydayDay\":29",             // API-PRO-04
        "\"paydayRule\":\"WHENEVER\"",  // API-PRO-05
        "\"personality\":\"PIRATE\"",   // API-PRO-06
        "\"morningTime\":\"25:00\"",    // API-PRO-07
        "\"timezone\":\"Europe/London\"", // API-PRO-08
        "\"savingsPaise\":-1",
        "\"incomePaise\":1.5"           // API-X-09
    })
    void badValuesAreValidation(String override) throws Exception {
        TestUser u = signIn();
        putProfile(u, withField(override))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    @Test
    void fixedDayNeedsADay() throws Exception {
        TestUser u = signIn();
        putProfile(u, EXAMPLE_PROFILE.replace("\"paydayDay\":1,", ""))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("VALIDATION"));
    }

    @Test
    void lastWorkingDayNeedsNoDay() throws Exception {
        TestUser u = signIn();
        putProfile(u, EXAMPLE_PROFILE.replace("\"FIXED_DAY\",\"paydayDay\":1", "\"LAST_WORKING_DAY\""))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.paydayRule").value("LAST_WORKING_DAY"))
            .andExpect(jsonPath("$.paydayDay").doesNotExist());
    }

    @Test
    void savingsCannotLeaveNothingToSpend() throws Exception { // API-PRO-09
        TestUser u = signIn();
        addFixedCost(u, "Rent", 1_500_000);
        putProfile(u, EXAMPLE_PROFILE.replace("\"savingsPaise\":2000000", "\"savingsPaise\":3600000"))
            .andExpect(status().isUnprocessableEntity())
            .andExpect(jsonPath("$.code").value("NOT_POSSIBLE"))
            .andExpect(jsonPath("$.message").value("Savings and fixed costs leave nothing to spend. Save ₹34,999 or less."));
    }

    private static String withField(String override) {
        String key = override.substring(0, override.indexOf(':'));
        return EXAMPLE_PROFILE.replaceFirst(java.util.regex.Pattern.quote(key) + ":(\"[^\"]*\"|[0-9.-]+)", override);
    }
}

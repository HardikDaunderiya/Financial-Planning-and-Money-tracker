package in.gullak.budget;

import in.gullak.common.web.CurrentUser;
import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/budget")
class BudgetController {
    private final BudgetService budget;

    BudgetController(BudgetService budget) {
        this.budget = budget;
    }

    @GetMapping("/today")
    TodayResponse today(@AuthenticationPrincipal Jwt jwt) {
        return budget.today(CurrentUser.id(jwt));
    }

    @PutMapping("/first-cycle")
    TodayResponse firstCycle(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody FirstCycleRequest body) {
        return budget.setFirstCyclePool(CurrentUser.id(jwt), body.moneyLeftPaise());
    }
}

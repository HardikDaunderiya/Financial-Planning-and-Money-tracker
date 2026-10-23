package in.gullak.profile;

import in.gullak.common.web.CurrentUser;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/me/fixed-costs")
class FixedCostController {
    private final FixedCostService costs;

    FixedCostController(FixedCostService costs) {
        this.costs = costs;
    }

    @GetMapping
    List<FixedCost> list(@AuthenticationPrincipal Jwt jwt) {
        return costs.list(CurrentUser.id(jwt));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    FixedCost add(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody FixedCostRequest body) {
        return costs.add(CurrentUser.id(jwt), body);
    }

    @PatchMapping("/{id}")
    FixedCost edit(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id, @Valid @RequestBody FixedCostPatch body) {
        return costs.edit(CurrentUser.id(jwt), id, body);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void remove(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID id) {
        costs.remove(CurrentUser.id(jwt), id);
    }
}

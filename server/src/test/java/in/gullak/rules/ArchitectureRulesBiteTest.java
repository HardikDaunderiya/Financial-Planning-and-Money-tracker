package in.gullak.rules;

import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;

/** Proves the rules that allow an empty selection still fail on real violations. */
class ArchitectureRulesBiteTest {
    static final JavaClasses FIXTURES = new ClassFileImporter().importPackages("archfixture");

    @Test
    void repositoryUsedFromAnotherFeatureViolates() {
        assertBites(ArchitectureTest.repositoriesStayInTheirFeature);
    }

    @Test
    void controllerDependingOnRepositoryViolates() {
        assertBites(ArchitectureTest.controllersDoNotTouchRepositoriesOrEntities);
    }

    @Test
    void publicEntityViolates() {
        assertBites(ArchitectureTest.entitiesStayInsideTheirFeature);
    }

    private static void assertBites(ArchRule rule) {
        assertThat(rule.evaluate(FIXTURES).hasViolation()).isTrue();
    }
}

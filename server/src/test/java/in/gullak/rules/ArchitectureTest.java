package in.gullak.rules;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noFields;

import com.tngtech.archunit.core.domain.JavaAccess;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;

@AnalyzeClasses(packages = "in.gullak", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

    @ArchTest
    static final ArchRule repositoriesStayInTheirFeature = classes()
        .that().haveSimpleNameEndingWith("Repository")
        .should(new ArchCondition<JavaClass>("only be used inside their own package") {
            @Override
            public void check(JavaClass repository, ConditionEvents events) {
                for (JavaAccess<?> access : repository.getAccessesToSelf()) {
                    String from = access.getOriginOwner().getPackageName();
                    if (!from.equals(repository.getPackageName())) {
                        events.add(SimpleConditionEvent.violated(access, access.getDescription()));
                    }
                }
            }
        })
        .allowEmptyShould(true);

    @ArchTest
    static final ArchRule noFieldInjection = noFields().should().beAnnotatedWith(Autowired.class);

    @ArchTest
    static final ArchRule controllersDoNotQueryTheDatabase = noClasses()
        .that().haveSimpleNameEndingWith("Controller")
        .should().dependOnClassesThat().areAssignableTo(JdbcClient.class)
        .allowEmptyShould(true);

    @ArchTest
    static final ArchRule controllersDoNotTouchRepositoriesOrEntities = noClasses()
        .that().haveSimpleNameEndingWith("Controller")
        .should().dependOnClassesThat().haveSimpleNameEndingWith("Repository")
        .orShould().dependOnClassesThat().areAnnotatedWith(jakarta.persistence.Entity.class)
        .allowEmptyShould(true);

    @ArchTest
    static final ArchRule entitiesStayInsideTheirFeature = classes()
        .that().areAnnotatedWith(jakarta.persistence.Entity.class)
        .should().notBePublic()
        .allowEmptyShould(true);

    @ArchTest
    static final ArchRule commonDoesNotDependOnFeatures = noClasses()
        .that().resideInAPackage("in.gullak.common..")
        .should().dependOnClassesThat()
        .resideInAnyPackage("in.gullak.auth..", "in.gullak.profile..", "in.gullak.budget..", "in.gullak.content..");
}

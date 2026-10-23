package archfixture.a;

import org.springframework.data.jpa.repository.JpaRepository;

public interface FooRepository extends JpaRepository<FooEntity, Long> {}

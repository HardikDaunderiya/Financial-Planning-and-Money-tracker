package archfixture.a;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
public class FooEntity {
    @Id
    Long id;
}

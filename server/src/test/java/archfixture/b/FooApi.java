package archfixture.b;

import archfixture.a.FooRepository;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class FooApi {
    private final FooRepository repository;

    public FooApi(FooRepository repository) {
        this.repository = repository;
    }
}

package archfixture.b;

import archfixture.a.FooEntity;
import archfixture.a.FooRepository;

public class FooService {
    private final FooRepository repository;

    public FooService(FooRepository repository) {
        this.repository = repository;
    }

    void run() {
        repository.save(new FooEntity());
    }
}

package in.gullak;

import org.springframework.boot.SpringApplication;

public class TestGullakApplication {

	public static void main(String[] args) {
		SpringApplication.from(GullakApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}

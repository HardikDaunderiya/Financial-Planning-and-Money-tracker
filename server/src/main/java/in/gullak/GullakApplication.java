package in.gullak;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class GullakApplication {
    public static void main(String[] args) {
        SpringApplication.run(GullakApplication.class, args);
    }
}

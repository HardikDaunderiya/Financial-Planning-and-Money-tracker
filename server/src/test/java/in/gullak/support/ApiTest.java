package in.gullak.support;

import in.gullak.TestcontainersConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Import({TestcontainersConfiguration.class, TestClockConfig.class})
public abstract class ApiTest {
    @Autowired protected MockMvc mvc;
    @Autowired protected MutableClock clock;
    @Autowired protected JdbcClient jdbc;

    @BeforeEach
    void resetClock() {
        clock.reset();
    }
}

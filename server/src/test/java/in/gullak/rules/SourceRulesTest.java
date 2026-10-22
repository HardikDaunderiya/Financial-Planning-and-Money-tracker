package in.gullak.rules;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/** Rules that need the source text, not the bytecode. */
class SourceRulesTest {
    static final Path MAIN = Path.of("src/main/java");

    static final Pattern EMPTY_CATCH = Pattern.compile("catch\\s*\\([^)]*\\)\\s*\\{\\s*}");
    static final Pattern BROAD_CATCH =
        Pattern.compile("catch\\s*\\(\\s*(final\\s+)?(Exception|RuntimeException|Throwable)\\s+\\w+\\s*\\)");
    static final Pattern CONCAT_IN_LOG =
        Pattern.compile("log\\.(trace|debug|info|warn|error)\\([^;]*(\"\\s*\\+|\\+\\s*\")");
    static final Pattern SYSTEM_OUT = Pattern.compile("System\\.(out|err)\\.");

    @Test
    void patternsCatchWhatTheyShould() {
        assertThat(EMPTY_CATCH.matcher("catch (IOException e) { }").find()).isTrue();
        assertThat(BROAD_CATCH.matcher("catch (Exception e)").find()).isTrue();
        assertThat(BROAD_CATCH.matcher("catch (final Throwable t)").find()).isTrue();
        assertThat(BROAD_CATCH.matcher("catch (IOException e)").find()).isFalse();
        assertThat(CONCAT_IN_LOG.matcher("log.info(\"user \" + id);").find()).isTrue();
        assertThat(CONCAT_IN_LOG.matcher("log.info(\"user={}\", id);").find()).isFalse();
    }

    @Test
    void noEmptyCatchBlocks() throws IOException { // ERR-05
        assertThat(violations(EMPTY_CATCH, false)).isEmpty();
    }

    @Test
    void noBroadCatchOutsideErrorHandling() throws IOException { // ERR-06
        assertThat(violations(BROAD_CATCH, true)).isEmpty();
    }

    @Test
    void loggingIsParameterised() throws IOException { // LOG-06
        assertThat(violations(CONCAT_IN_LOG, false)).isEmpty();
    }

    @Test
    void noSystemOut() throws IOException {
        assertThat(violations(SYSTEM_OUT, false)).isEmpty();
    }

    private static List<String> violations(Pattern pattern, boolean allowErrorPackage) throws IOException {
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(MAIN)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String path = file.toString().replace('\\', '/');
                if (allowErrorPackage && path.contains("/common/error/")) {
                    continue;
                }
                String text = Files.readString(file);
                if (pattern.matcher(text).find()) {
                    found.add(path);
                }
            }
        }
        return found;
    }
}

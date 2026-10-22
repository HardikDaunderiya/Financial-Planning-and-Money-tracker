package in.gullak.common.money;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class RupeeFormatTest {
    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
        "0|₹0", "99|₹0", "100|₹1", "59333|₹593", "100000|₹1,000",
        "10000000|₹1,00,000", "123456789|₹12,34,567", "12345678900|₹12,34,56,789", "-40000|−₹400"
    })
    void indianGrouping(long paise, String expected) { // APP-01 (server side)
        assertThat(RupeeFormat.format(paise)).isEqualTo(expected);
    }
}

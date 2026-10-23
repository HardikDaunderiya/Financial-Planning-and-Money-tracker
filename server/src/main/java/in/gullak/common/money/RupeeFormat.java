package in.gullak.common.money;

/** Whole rupees with Indian digit grouping: 10000000 paise → "₹1,00,000". */
public final class RupeeFormat {
    private RupeeFormat() {}

    public static String format(long paise) {
        long rupees = Math.floorDiv(paise, 100);
        boolean negative = rupees < 0;
        String digits = Long.toString(Math.abs(rupees));
        if (digits.length() > 3) {
            String last3 = digits.substring(digits.length() - 3);
            String rest = digits.substring(0, digits.length() - 3);
            StringBuilder groups = new StringBuilder();
            while (rest.length() > 2) {
                groups.insert(0, "," + rest.substring(rest.length() - 2));
                rest = rest.substring(0, rest.length() - 2);
            }
            digits = rest + groups + "," + last3;
        }
        return (negative ? "−" : "") + "₹" + digits;
    }
}

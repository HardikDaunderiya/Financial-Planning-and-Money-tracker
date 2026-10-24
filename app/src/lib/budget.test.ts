import {
  TIGHT_PER_DAY_PAISE,
  firstCyclePreview,
  perDayPreview,
  realityCheck,
  suggestedSavings,
} from "./budget";

describe("first-cycle preview (BUD-32)", () => {
  it("pro-rates the pool by the days left and rounds down to whole rupees", () => {
    const p = firstCyclePreview({
      monthlySpendablePaise: 1500000,
      today: "2026-10-23",
      payday: { rule: "FIXED_DAY", day: 1 },
    });
    expect(p).toEqual({
      cycleStart: "2026-10-01",
      cycleEnd: "2026-10-31",
      daysLeft: 9,
      poolPaise: 435400,
      dayBudgetPaise: 48300,
      proRated: true,
    });
  });

  it("a stated money-left amount replaces the pool", () => {
    const p = firstCyclePreview({
      monthlySpendablePaise: 1500000,
      today: "2026-10-23",
      payday: { rule: "FIXED_DAY", day: 1 },
      moneyLeftPaise: 600000,
    });
    expect(p.poolPaise).toBe(600000);
    expect(p.dayBudgetPaise).toBe(66600);
  });

  it("signing up on payday is not pro-rated", () => {
    const p = firstCyclePreview({
      monthlySpendablePaise: 1500000,
      today: "2026-11-01",
      payday: { rule: "FIXED_DAY", day: 1 },
    });
    expect(p.proRated).toBe(false);
    expect(p.poolPaise).toBe(1500000);
    expect(p.dayBudgetPaise).toBe(50000);
  });
});

describe("setup previews", () => {
  it("per day in the next full cycle", () => {
    expect(
      perDayPreview({ freePaise: 1500000, today: "2026-10-23", payday: { rule: "FIXED_DAY", day: 1 } }),
    ).toEqual({ perDayPaise: 50000, cycleName: "November", cycleDays: 30 });
  });

  it("APP-20 verdict thresholds", () => {
    expect(
      realityCheck({ incomePaise: 5000000, fixedPaise: 1500000, savingsPaise: 2000000, cycleDays: 30 })
        .verdict,
    ).toBe("doable");
    expect(
      realityCheck({ incomePaise: 5000000, fixedPaise: 1500000, savingsPaise: 2800000, cycleDays: 30 })
        .verdict,
    ).toBe("tight"); // ₹233 a day
    expect(
      realityCheck({ incomePaise: 5000000, fixedPaise: 1500000, savingsPaise: 3500000, cycleDays: 30 })
        .verdict,
    ).toBe("notPossible");
    expect(
      realityCheck({ incomePaise: 5000000, fixedPaise: 1500000, savingsPaise: 3600000, cycleDays: 30 })
        .verdict,
    ).toBe("notPossible");
  });
});

describe("suggested savings and the tight line (fix round)", () => {
  it("the example user gets ₹27,000", () => {
    expect(suggestedSavings({ incomePaise: 5000000, fixedPaise: 1500000, cycleDays: 30 })).toBe(2700000);
  });

  it("essentials left under ₹7,500 suggest 0", () => {
    expect(suggestedSavings({ incomePaise: 1000000, fixedPaise: 300000 + 1, cycleDays: 30 })).toBe(0);
    expect(suggestedSavings({ incomePaise: 1000000, fixedPaise: 1000000, cycleDays: 30 })).toBe(0);
    expect(suggestedSavings({ incomePaise: 1000000, fixedPaise: 2000000, cycleDays: 30 })).toBe(0);
  });

  it("the tight line is ₹250 a day", () => {
    expect(TIGHT_PER_DAY_PAISE).toBe(25000);
  });
});

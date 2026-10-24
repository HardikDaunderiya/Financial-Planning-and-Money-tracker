import { render, screen } from "@testing-library/react-native";
import React from "react";
import { FixedCostRow } from "./fixed-cost-list";

describe("remove label casing", () => {
  it.each([
    ["Rent", "Remove rent"],
    ["Monthly groceries", "Remove monthly groceries"],
    ["EMI", "Remove EMI"],
    ["Wi-Fi", "Remove Wi-Fi"],
  ])("%s reads %s", async (name, label) => {
    await render(
      <FixedCostRow
        cost={{ id: "x", name, amountPaise: 100 }}
        onEdit={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  });
});

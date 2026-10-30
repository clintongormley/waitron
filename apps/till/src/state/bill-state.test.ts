import { afterEach, describe, expect, it } from "vitest";
import type { PartyBill } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { billName, shownBills } from "./bill-state.js";

afterEach(() => setLocale("en"));

function bill(over: Partial<PartyBill>): PartyBill {
  return {
    workingOrderId: "wo-1",
    revision: 0,
    invoiceType: "F2",
    recipient: null,
    partyId: "v1",
    label: null,
    billNumber: 1,
    billName: null,
    status: "open",
    total: "10.00",
    outstanding: "10.00",
    hasPayments: false,
    receiptAvailable: false,
    ...over,
  };
}

describe("A803 bill names", () => {
  it("an unnamed bill reads «{party} · Bill {n}» with its stored number", () => {
    expect(billName("Ana", bill({ billNumber: 3 }))).toBe("Ana · Bill 3");
  });

  it("a named one adds « · {name}»", () => {
    expect(billName("Ana", bill({ billNumber: 2, billName: "Clint" }))).toBe(
      "Ana · Bill 2 · Clint",
    );
  });

  it("an unnumbered bill, a fault in Waitron, reads «{party} · Bill» and never prints null", () => {
    expect(billName("Ana", bill({ billNumber: null }))).toBe("Ana · Bill");
    expect(billName("Ana", bill({ billNumber: null, billName: "Clint" }))).toBe(
      "Ana · Bill · Clint",
    );
    setLocale("es");
    expect(billName("Ana", bill({ billNumber: null }))).not.toContain("null");
    expect(billName("Ana", bill({ billNumber: null }))).not.toContain("{n}");
  });

  it.each([
    "table.bill_of",
    "table.bill_of_named",
    "table.bill_of_unnumbered",
    "table.bill_of_unnumbered_named",
    "floor.unsent_bill_unnumbered",
  ] as const)("%s has its own Spanish words and the same slots as the English", (key) => {
    const slots = (text: string) => [...text.matchAll(/\{\w+\}/g)].map(([slot]) => slot).sort();
    expect(t(key, "es")).not.toBe(t(key, "en"));
    expect(slots(t(key, "es"))).toEqual(slots(t(key, "en")));
  });

  it("shownBills leaves out abandoned bills and sorts the rest by number", () => {
    const shown = shownBills([
      bill({ workingOrderId: "wo-c", billNumber: 3 }),
      bill({ workingOrderId: "wo-gone", billNumber: null, status: "abandoned" }),
      bill({ workingOrderId: "wo-fault", billNumber: null }),
      bill({ workingOrderId: "wo-a", billNumber: 1, status: "settled" }),
      bill({ workingOrderId: "wo-b", billNumber: 2 }),
    ]);
    expect(shown.map((row) => row.workingOrderId)).toEqual(["wo-a", "wo-b", "wo-c", "wo-fault"]);
  });

  it("shownBills breaks a tie of numbers by bill id", () => {
    const shown = shownBills([
      bill({ workingOrderId: "wo-z", billNumber: 2 }),
      bill({ workingOrderId: "wo-y", billNumber: 2 }),
    ]);
    expect(shown.map((row) => row.workingOrderId)).toEqual(["wo-y", "wo-z"]);
  });
});

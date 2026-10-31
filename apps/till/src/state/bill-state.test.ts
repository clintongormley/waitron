import { afterEach, describe, expect, it } from "vitest";
import type { PartyBill } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";
import { billLabel, billName, billToShow, shownBills } from "./bill-state.js";

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
    ["en", "Bill"],
    ["es", "Cuenta"],
  ])("in %s, a slot's spelling inside a party or bill name is printed as typed", (locale, word) => {
    setLocale(locale);
    expect(billName("Team {name}", bill({ billNumber: 2, billName: "Clint" }))).toBe(
      `Team {name} · ${word} 2 · Clint`,
    );
    expect(billName("Ana", bill({ billNumber: 2, billName: "{party} {n} {name}" }))).toBe(
      `Ana · ${word} 2 · {party} {n} {name}`,
    );
    expect(billName("{n}", bill({ billNumber: null, billName: "{party}" }))).toBe(
      `{n} · ${word} · {party}`,
    );
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

describe("A803 billLabel", () => {
  it.each([
    ["en", "Bill 2", "Bill 2 · Clint", "Bill", "Bill · Clint"],
    ["es", "Cuenta 2", "Cuenta 2 · Clint", "Cuenta", "Cuenta · Clint"],
  ])(
    "in %s, names a bill by its number, then its name, or by the word alone with no number",
    (locale, numbered, named, unnumbered, unnumberedNamed) => {
      setLocale(locale);
      expect(billLabel(bill({ billNumber: 2 }))).toBe(numbered);
      expect(billLabel(bill({ billNumber: 2, billName: "Clint" }))).toBe(named);
      expect(billLabel(bill({ billNumber: null }))).toBe(unnumbered);
      expect(billLabel(bill({ billNumber: null, billName: "Clint" }))).toBe(unnumberedNamed);
    },
  );
});

describe("billToShow", () => {
  const one = bill({
    workingOrderId: "wo-1",
    billNumber: 1,
    status: "settled",
    outstanding: "0.00",
  });
  const two = bill({ workingOrderId: "wo-2", billNumber: 2, status: "placed" });
  const three = bill({ workingOrderId: "wo-3", billNumber: 3 });
  const dropped = bill({ workingOrderId: "wo-0", billNumber: null, status: "abandoned" });
  // Read in an order that is not the number order, so a pick by position would differ.
  const read = [three, dropped, two, one];

  it("keeps the bill on screen while the read still holds it, paid or not", () => {
    expect(billToShow("wo-3", read)).toBe("wo-3");
    expect(billToShow("wo-1", read)).toBe("wo-1");
  });

  it("else takes the lowest-numbered bill still owing, skipping a paid Bill 1", () => {
    expect(billToShow("wo-9", read)).toBe("wo-2");
    expect(billToShow(undefined, read)).toBe("wo-2");
  });

  it("else the lowest-numbered shown bill, never an abandoned one", () => {
    const paidTwo = { ...two, status: "settled" as const, outstanding: "0.00" };
    const paidThree = { ...three, status: "settled" as const, outstanding: "0.00" };
    expect(billToShow(undefined, [paidThree, dropped, paidTwo, one])).toBe("wo-1");
    expect(billToShow("wo-0", [paidThree, dropped, paidTwo])).toBe("wo-2");
  });

  it("none when no bill is shown", () => {
    expect(billToShow("wo-1", [])).toBeUndefined();
    expect(billToShow("wo-0", [dropped])).toBeUndefined();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./unpaid-departures.js";
import type { TillUnpaidDepartures } from "./unpaid-departures.js";
import type { UnpaidDeparture } from "../api/client.js";

const departures: UnpaidDeparture[] = [
  {
    id: "ud-1",
    workingOrderId: "wo-1",
    billLabel: "Ana",
    tableLabels: ["4", "5"],
    saleId: "s-1",
    invoiceNumber: "F-0007",
    amount: "30.00",
    reason: "Left while we cleared the terrace",
    recordedByName: "Marta",
    authorizedByName: "Luis",
    recordedAt: "2026-10-01T21:30:00.000Z",
  },
  {
    id: "ud-2",
    workingOrderId: "wo-2",
    billLabel: null,
    tableLabels: ["9"],
    saleId: "s-2",
    invoiceNumber: "F-0008",
    amount: "12.50",
    reason: "Ran off",
    recordedByName: null,
    authorizedByName: null,
    recordedAt: "2026-10-01T21:40:00.000Z",
  },
];

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-unpaid-departures a11y (%s theme)", (theme) => {
  it("a list with an approved and an unnamed departure has no violations", async () => {
    const { el, host } = await mountWidget<TillUnpaidDepartures>(
      "till-unpaid-departures",
      { departures },
      theme,
    );
    expect(el.shadowRoot!.querySelectorAll("[data-departure]")).toHaveLength(2);
    await expectNoA11yViolations(host);
  });
});

import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import "./unpaid-departure-dialog.js";
import type { DialogRefusal } from "../state/bill-payment.js";
import type { DepartingBill, TillUnpaidDepartureDialog } from "./unpaid-departure-dialog.js";

const bills: DepartingBill[] = [
  { workingOrderId: "wo-4", name: "4 · Bill 1", outstanding: "14.00" },
  { workingOrderId: "wo-check", name: "4 · Bill 2", outstanding: "30.00" },
];

afterEach(cleanupWidgets);

const states: [string, { refusal: DialogRefusal | null; busy: boolean; pressed: boolean }][] = [
  ["empty", { refusal: null, busy: false, pressed: false }],
  ["with the reason missing", { refusal: null, busy: false, pressed: true }],
  [
    "refused",
    { refusal: { code: "unpaid_departure.unfired_dishes" }, busy: false, pressed: false },
  ],
  ["sending", { refusal: null, busy: true, pressed: false }],
];

describe.each(["light", "dark"] as const)(
  "till-unpaid-departure-dialog a11y (%s theme)",
  (theme) => {
    it.each(states)("%s has no violations", async (_, state) => {
      const { el, host } = await mountWidget<TillUnpaidDepartureDialog>(
        "till-unpaid-departure-dialog",
        { bills, refusal: state.refusal, busy: state.busy },
        theme,
      );
      if (state.pressed) {
        el.shadowRoot!.querySelector<HTMLElement>("[data-departure-confirm]")!.click();
        await el.updateComplete;
      }
      await expectNoA11yViolations(host);
    });
  },
);

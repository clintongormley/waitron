import { afterEach, describe, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { BillLookupRow } from "../api/client.js";
import "./find-bill-dialog.js";
import type { TillFindBillDialog } from "./find-bill-dialog.js";

const debt: BillLookupRow = {
  workingOrderId: "wo-1",
  orderNumber: 12,
  label: "Birthday",
  partyName: "Familia Ruiz",
  tables: ["Mesa 4"],
  invoiceNumber: "A/12",
  openedAt: "2026-10-01T18:00:00.000Z",
  departedAt: "2026-10-01T21:30:00.000Z",
  status: "left_without_paying",
  stillOwed: "30.00",
};

afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("Selected bill collection a11y (%s theme)", (theme) => {
  it.each(["cash", "card", "loading", "refusal", "unconfirmed-cash", "unconfirmed-card"] as const)(
    "%s has no violations",
    async (stage) => {
      const { el, host } = await mountWidget<TillFindBillDialog>(
        "till-find-bill-dialog",
        { bill: debt },
        theme,
      );
      if (stage === "card") el.shadowRoot!.querySelector<HTMLElement>("[data-card]")!.click();
      if (stage === "unconfirmed-cash" || stage === "unconfirmed-card") {
        el.unconfirmed = true;
        el.confirmationTender =
          stage === "unconfirmed-cash"
            ? { method: "cash", amount: "40.00" }
            : { method: "card", amount: "30.00", externalRef: "original" };
        el.error = "sale.unconfirmed";
      }
      if (stage === "loading") el.busy = true;
      if (stage === "refusal") el.error = "sale.unconfirmed";
      await el.updateComplete;
      await expectNoA11yViolations(host);
    },
  );
});

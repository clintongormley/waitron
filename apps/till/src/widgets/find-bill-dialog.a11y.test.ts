import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import type { BillLookupRow, TillApi } from "../api/client.js";
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
const api = { lookUpBills: vi.fn(async () => ({ bills: [debt] })) } as unknown as TillApi;

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("Find a bill a11y (%s theme)", (theme) => {
  it.each(["search", "results", "payment"] as const)("%s has no violations", async (stage) => {
    const { el, host } = await mountWidget<TillFindBillDialog>(
      "till-find-bill-dialog",
      { api },
      theme,
    );
    if (stage !== "search") {
      const input = el.shadowRoot!.querySelector<HTMLElement>("[name=bill-search]")!;
      const native = input.shadowRoot!.querySelector<HTMLInputElement>("input")!;
      native.value = "A/12";
      native.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await el.updateComplete;
      el.shadowRoot!.querySelector<HTMLElement>("[data-search]")!.click();
      await vi.waitFor(
        () => el.shadowRoot!.querySelector("[data-bill]") ?? Promise.reject(new Error("No result")),
      );
    }
    if (stage === "payment") {
      el.shadowRoot!.querySelector<HTMLElement>("[data-bill]")!.click();
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});

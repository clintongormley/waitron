import { LitElement, html } from "lit";
import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LeaveController } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import type { PartyBill } from "../api/client.js";
import "./till-table-order-screen.js";

const bill = (workingOrderId: string, billNumber: number, billName: string | null): PartyBill => ({
  workingOrderId,
  revision: 0,
  invoiceType: "F2",
  recipient: null,
  partyId: "v1",
  label: null,
  billNumber,
  billName,
  status: "open",
  total: "14.00",
  outstanding: "14.00",
  hasPayments: false,
  receiptAvailable: false,
});

class BillNameHost extends LitElement {
  readonly leave = new LeaveController(this);
  override render() {
    return html`<till-table-order-screen
        orderId="wo-4"
        .bills=${[bill("wo-4", 1, "Clint"), bill("wo-check", 2, null)]}
        .party=${{
          kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 3 },
          id: "v1",
          revision: 3,
          guestCount: 3,
          state: "open",
          name: "Ana",
          displayName: "Ana",
          openingBillId: "wo-4",
          outstanding: "0.00",
          billCount: 2,
          tableIds: [],
          unsentDrafts: [],
          reminder: null,
        }}
      ></till-table-order-screen
      >${this.leave.render({ heading: t("unsaved.heading"), message: t("unsaved.message"), keepLabel: t("unsaved.keep"), discardLabel: t("unsaved.discard") })}`;
  }
}
customElements.define("bill-name-screen-test-host", BillNameHost);
const originalLocale = currentLocale();
afterEach(cleanupWidgets);
afterEach(() => setLocale(originalLocale));
beforeEach(() => setLocale("en"));
it("the table screen protects a refused bill name against the bill's stored name and discards without submitting", async () => {
  const { el: app } = await mountWidget<BillNameHost>("bill-name-screen-test-host", {});
  const screen = app.shadowRoot!.querySelector("till-table-order-screen")!;
  await screen.updateComplete;
  const names: unknown[] = [];
  screen.addEventListener("name-bill", (event) => names.push((event as CustomEvent).detail));
  screen.billNameRefusal = { billId: "wo-4", name: "Luis", message: "Name refused" };
  await screen.updateComplete;
  const form = screen.shadowRoot!.querySelector("till-bill-name-dialog")!;
  await form.updateComplete;
  await form.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
  expect(form.bill).toBe("Ana · Bill 1 · Clint");
  const field = form.shadowRoot!.querySelector("wt-input")!;
  await field.updateComplete;
  const input = field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
  expect(input.value).toBe("Luis");
  expect(field.error).toBe("Name refused");
  await userEvent.click(
    page.elementLocator(form.shadowRoot!.querySelector<HTMLElement>("[data-name-cancel]")!),
  );
  await app.updateComplete;
  const question = app.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await question.updateComplete;
  expect(question.open).toBe(true);
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
  await expect.poll(() => question.open).toBe(false);
  expect(input.value).toBe("Luis");
  expect(screen.shadowRoot!.querySelector("till-bill-name-dialog")).toBe(form);
  form.shadowRoot!.querySelector<HTMLElement>("[data-name-cancel]")!.click();
  await app.updateComplete;
  await question.updateComplete;
  question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("till-bill-name-dialog")).toBeNull();
  expect(names).toEqual([]);
});

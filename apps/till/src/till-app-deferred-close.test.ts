import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TillApp } from "./till-app.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { billUnsentText } from "./state/bill-unsent.js";
import {
  billOf,
  flush,
  floor,
  invoiceOf,
  money,
  openDialog,
  openTable,
  press,
  resetBillPayDrafts,
  stubApi,
  tableOrder,
  text,
  till,
} from "../test/bill-pay-app.js";
import type { CurrentOrders, PartyBill } from "./api/client.js";
import type { CloseDeferredResult } from "./api/deferred-close-types.js";
import type { CapabilityFlag } from "./layout.js";
import type { TillDeferredCloseDialog } from "./widgets/deferred-close-dialog.js";

const originalLocale = currentLocale();
beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(originalLocale);
});

const noOrders: CurrentOrders = {
  revision: 3,
  hasGroups: false,
  nextDisplayNumber: 1,
  retainedCourses: [],
  reminder: null,
  groups: [],
  ungrouped: [],
};

function closedAs(party: CloseDeferredResult["party"]["state"]): CloseDeferredResult {
  return {
    submissionId: "s",
    workingOrderId: "wo-4",
    saleId: "sale-1",
    invoiceNumber: "F-0007",
    classification: "deferred_payment",
    closedAt: "2026-11-12T20:30:00.000Z",
    businessDay: "2026-11-12",
    total: "120.00",
    currency: "EUR",
    party: { state: party, blockers: party === "open" ? ["other_bills"] : [] },
  };
}

function deferredApi(over: Record<string, unknown> = {}) {
  return stubApi({
    getTill: vi.fn().mockResolvedValue({
      ...till,
      receiptLanguages: ["es", "en"],
      capabilities: [...till.capabilities, "close-deferred"] as CapabilityFlag[],
    }),
    readCurrentOrders: vi.fn().mockResolvedValue(noOrders),
    closeDeferred: vi.fn().mockResolvedValue(closedAs("open")),
    getFiledTicket: vi.fn().mockResolvedValue(invoiceOf("120.00")),
    getReceiptPrintStatus: vi.fn().mockResolvedValue({ status: "not_queued" }),
    ...over,
  });
}

const closing = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillDeferredCloseDialog>("till-deferred-close-dialog");

async function openClosing(el: TillApp): Promise<TillDeferredCloseDialog> {
  await openTable(el);
  await openDialog(el, "rest");
  await press(el, "[data-pay-deferred]");
  const window = closing(el);
  expect(window?.open).toBe(true);
  return window!;
}

async function confirm(el: TillApp): Promise<void> {
  closing(el)!.shadowRoot!.querySelector<HTMLElement>("[data-deferred-close-confirm]")!.click();
  await flush(el, 8);
}

const documents = (el: TillApp) => el.shadowRoot!.querySelector("till-settlement-document-dialog");

const unedited = { billId: "wo-4", editorVersion: 0, draftId: null, draftRevision: null };

it("closes the bill and opens the documents window for its receipt", async () => {
  const api = deferredApi();
  const { el } = await mountWidget<TillApp>("till-app", { api });
  const window = await openClosing(el);
  expect(el.shadowRoot!.querySelector("till-bill-pay-dialog")).toBeNull();
  expect(window.bill).toEqual({
    label: "4 · Bill 1",
    total: "120.00",
    customer: null,
    issued: false,
  });
  await confirm(el);
  expect(api.closeDeferred).toHaveBeenCalledExactlyOnceWith("wo-4", {
    submissionId: expect.any(String),
    expectedRevision: 0,
    expectedEdit: unedited,
    expectedTotal: "120.00",
    invoiceType: "F2",
    recipient: null,
    receiptLanguage: "es",
    delivery: null,
    partyFinish: {
      partyId: "v1",
      expectedPartyRevision: 3,
      expectedEdits: [unedited],
    },
  });
  expect(api.getFiledTicket).toHaveBeenCalledExactlyOnceWith("wo-4");
  expect(closing(el)).toBeNull();
  expect(documents(el)).not.toBeNull();
});

it("refuses unsent dishes before sending anything", async () => {
  const api = deferredApi();
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  tableOrder(el).draftStore!.addProduct(
    {
      id: "water",
      catalogueId: "cat-default",
      menuItemId: "menu-item-water",
      name: "Water",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
      category: null,
      allergens: null,
    },
    "1",
  );
  await flush(el);
  await confirm(el);
  expect(api.closeDeferred).not.toHaveBeenCalled();
  expect(closing(el)!.refusal).toBe(billUnsentText("4 · Bill 1"));
});

it("after a refusal, the next confirm carries a new id and the re-read revision and total", async () => {
  const api = deferredApi({
    closeDeferred: vi
      .fn()
      .mockRejectedValueOnce({ code: "deferred_close.conflict", status: 409 })
      .mockResolvedValueOnce(closedAs("open")),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  vi.mocked(api.getPartyBills).mockResolvedValue([
    billOf({ revision: 1, total: "130.00", outstanding: "130.00" }),
  ]);
  await confirm(el);
  const window = closing(el)!;
  expect(window.open).toBe(true);
  expect(window.busy).toBe(false);
  expect(window.refusal).toBe(codeMessage("deferred_close.conflict"));
  expect(window.bill?.total).toBe("130.00");
  expect(text(window.shadowRoot!.querySelector("[data-deferred-close-total]"))).toBe(
    money("130.00"),
  );
  await confirm(el);
  const [first, second] = vi.mocked(api.closeDeferred).mock.calls.map(([, body]) => body);
  expect(second!.submissionId).not.toBe(first!.submissionId);
  expect(first).toMatchObject({ expectedRevision: 0, expectedTotal: "120.00" });
  expect(second).toMatchObject({ expectedRevision: 1, expectedTotal: "130.00" });
  expect(documents(el)).not.toBeNull();
});

it("closes the window and shows the refusal when the re-read bill can no longer be closed this way", async () => {
  const api = deferredApi({
    closeDeferred: vi.fn().mockRejectedValue({
      code: "deferred_close.ineligible",
      reason: "prior_payment",
      workingOrderId: "wo-4",
      status: 409,
    }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  const paid: PartyBill = billOf({ hasPayments: true, outstanding: "0.00", status: "settled" });
  vi.mocked(api.getPartyBills).mockResolvedValue([paid]);
  await confirm(el);
  expect(closing(el)).toBeNull();
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(text(el.shadowRoot!.querySelector(".error"))).toContain(
    codeMessage("deferred_close.ineligible", "en", { reason: "prior_payment" }),
  );
});

it("a failed receipt read after the close is a load failure; nothing is sent again", async () => {
  const api = deferredApi({
    getFiledTicket: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openClosing(el);
  await confirm(el);
  await flush(el, 8);
  expect(api.closeDeferred).toHaveBeenCalledOnce();
  expect(closing(el)).toBeNull();
  expect(documents(el)).toBeNull();
  expect(text(el.shadowRoot!.querySelector(".error"))).toContain(t("deferred_close.ticket_unread"));
});

it("returns to the floor when the close finished the party; stays on the table when it did not", async () => {
  const finished = deferredApi({ closeDeferred: vi.fn().mockResolvedValue(closedAs("closed")) });
  const { el } = await mountWidget<TillApp>("till-app", { api: finished });
  await openClosing(el);
  await confirm(el);
  expect(floor(el)).not.toBeNull();
  expect(tableOrder(el)).toBeNull();
  cleanupWidgets();
  resetBillPayDrafts();

  const open = deferredApi({ closeDeferred: vi.fn().mockResolvedValue(closedAs("open")) });
  const { el: other } = await mountWidget<TillApp>("till-app", { api: open });
  await openClosing(other);
  await confirm(other);
  expect(tableOrder(other)).not.toBeNull();
});

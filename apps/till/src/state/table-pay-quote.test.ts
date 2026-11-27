import { expect, it, vi } from "vitest";
import { billRow } from "../../test/find-bill-fixtures.js";
import { TillApi } from "../api/client.js";
import { readTablePayQuote, type TablePayQuoteRequest } from "./table-pay-quote.js";

const billId = "counter-bill";
const whole: TablePayQuoteRequest = {
  context: "open",
  asked: { choice: { kind: "whole" }, pay: { method: "card" } },
  card: true,
  cash: true,
};
const items: TablePayQuoteRequest = {
  ...whole,
  asked: {
    choice: { kind: "items", picks: [{ lineNo: 1, lineId: "dish" }] },
    pay: { method: "card", addedTip: "2.00" },
  },
};
const allocated = {
  kind: "allocated",
  applied: "12.00",
  tip: "0.00",
  change: null,
  charged: "12.00",
} as const;

it("checks an ordinary Counter order without a bill edit", async () => {
  const api = new TillApi();
  const read = vi.spyOn(api, "previewBillPayment").mockResolvedValue(allocated);
  const quote = await readTablePayQuote(api, billId, whole, null, {}, "counter");

  expect(quote).toMatchObject({ preview: allocated, cash: allocated, refusal: null });
  expect(read).toHaveBeenCalledWith(
    billId,
    { kind: "share", shareOf: 1, method: "card", expectedEdit: null },
    { signal: expect.any(AbortSignal) },
  );
});

it("refuses a Table quote with no bill edit before checking either tender", async () => {
  const api = new TillApi();
  const read = vi.spyOn(api, "previewBillPayment").mockResolvedValue(allocated);
  const quote = await readTablePayQuote(api, billId, whole, null, {}, "table");

  expect(quote).toMatchObject({
    preview: null,
    cash: null,
    refusal: { code: "draft.out_of_date" },
  });
  expect(read).not.toHaveBeenCalled();
});

it("looks up the Counter Items bill edit once even when Cash needs its own preview", async () => {
  const api = new TillApi();
  const lookup = vi.spyOn(api, "getFindBill").mockResolvedValue({
    ...billRow({ workingOrderId: billId }),
    edit: {
      billId,
      editorId: null,
      editorName: null,
      editorVersion: 2,
      draftId: null,
      draftRevision: null,
    },
  });
  const read = vi
    .spyOn(api, "previewItemPayment")
    .mockRejectedValueOnce({ code: "bill.tip_not_allowed" })
    .mockResolvedValue({ total: "12.00", applied: "12.00", tip: "0.00", change: null });
  const quote = await readTablePayQuote(api, billId, items, null, {}, "counter");

  expect(lookup.mock.calls.map(([id]) => id)).toEqual([billId]);
  expect(read.mock.calls.map(([id, ask]) => [id, ask])).toEqual([
    [billId, { method: "card", picks: [{ lineId: "dish" }], addedTip: "2.00" }],
    [billId, { method: "card", picks: [{ lineId: "dish" }] }],
  ]);
  expect(quote).toMatchObject({ preview: null, cash: { total: "12.00" }, revisions: {} });
});

it("shows a failed Counter Items edit lookup as unread without making a tender preview", async () => {
  const api = new TillApi();
  vi.spyOn(api, "getFindBill").mockRejectedValue(new TypeError("Fetch failed"));
  const read = vi.spyOn(api, "previewItemPayment");
  const quote = await readTablePayQuote(api, billId, items, null, {}, "counter");

  expect(quote).toMatchObject({ preview: null, cash: null, refusal: { code: "unread" } });
  expect(read).not.toHaveBeenCalled();
});

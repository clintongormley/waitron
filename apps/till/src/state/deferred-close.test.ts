import { describe, expect, it } from "vitest";
import { billOf } from "../../test/bill-pay-app.js";
import {
  type DeferredDishRow,
  type DeferredOfferInput,
  deferredCloseRequest,
  deferredOffered,
} from "./deferred-close.js";

const dish = (over: Partial<DeferredDishRow> = {}): DeferredDishRow => ({
  workingOrderId: "wo-4",
  quantity: "2",
  servedQuantity: "2",
  servedAt: "2026-11-12T13:00:00.000Z",
  ...over,
});

function input(over: Partial<DeferredOfferInput> = {}): DeferredOfferInput {
  return {
    capabilities: ["take-orders", "close-deferred"],
    bill: billOf({ outstanding: "120.00", total: "120.00" }),
    paymentUnconfirmed: false,
    currentOrders: { groups: [{ rows: [dish()] }], ungrouped: [dish({ quantity: "1" })] },
    ...over,
  };
}

describe("deferredOffered", () => {
  it("offers the close only when every condition holds", () => {
    const cases: [string, Partial<DeferredOfferInput>, ReturnType<typeof deferredOffered>][] = [
      ["every condition holds", {}, { state: "offered" }],
      ["a presented bill", { bill: billOf({ status: "placed" }) }, { state: "offered" }],
      [
        "a part served and the rest cancelled",
        {
          currentOrders: {
            groups: [],
            ungrouped: [
              dish({ quantity: "3", servedQuantity: "1", cancelledQuantity: "2", servedAt: null }),
            ],
          },
        },
        { state: "offered" },
      ],
      [
        "another bill's dish unserved",
        {
          currentOrders: {
            groups: [{ rows: [dish(), dish({ workingOrderId: "wo-9", servedAt: null })] }],
            ungrouped: [],
          },
        },
        { state: "offered" },
      ],
      ["the profile lacks close-deferred", { capabilities: ["take-orders"] }, { state: "hidden" }],
      ["the bill has payments", { bill: billOf({ hasPayments: true }) }, { state: "hidden" }],
      ["the bill owes nothing", { bill: billOf({ outstanding: "0.00" }) }, { state: "hidden" }],
      ["the bill is settled", { bill: billOf({ status: "settled" }) }, { state: "hidden" }],
      ["the bill is abandoned", { bill: billOf({ status: "abandoned" }) }, { state: "hidden" }],
      [
        "a payment's outcome is unknown",
        { paymentUnconfirmed: true },
        { state: "off", reason: "deferred_close.payment_unconfirmed" },
      ],
      [
        "a dish of the bill is not served",
        {
          currentOrders: {
            groups: [{ rows: [dish({ servedQuantity: "1", servedAt: null })] }],
            ungrouped: [],
          },
        },
        { state: "off", reason: "deferred_close.unserved" },
      ],
      [
        "an ungrouped dish of the bill is not served",
        {
          currentOrders: {
            groups: [],
            ungrouped: [dish({ servedQuantity: "0", servedAt: null })],
          },
        },
        { state: "off", reason: "deferred_close.unserved" },
      ],
      [
        "Current orders were not read",
        { currentOrders: null },
        { state: "off", reason: "deferred_close.unserved" },
      ],
    ];
    for (const [name, over, expected] of cases)
      expect([name, deferredOffered(input(over))]).toEqual([name, expected]);
  });
});

describe("deferredCloseRequest", () => {
  const party = {
    id: "v1",
    revision: 7,
    expectedEdits: [{ billId: "wo-4", editorVersion: 3, draftId: null, draftRevision: null }],
  };
  const expectedEdit = party.expectedEdits[0]!;
  const recipient = {
    taxId: "B12345678",
    legalName: "Talleres Mar SL",
    address: "Carrer Major 1, Valencia",
    countryCode: "ES",
  };

  it("builds the request from the bill, sending an issued invoice's language as stored", () => {
    const bill = billOf({
      revision: 5,
      total: "120.00",
      outstanding: "120.00",
      invoiceType: "F1",
      recipient,
      invoiceDelivery: { medium: "email", recipient: "cuentas@talleresmar.es" },
      invoiceNumber: "A/12",
      receiptLanguage: "ca",
    });
    const { submissionId, ...body } = deferredCloseRequest({
      bill,
      offeredLanguages: ["es", "en"],
      expectedEdit,
      party,
    });

    expect(submissionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toEqual({
      expectedRevision: 5,
      expectedEdit,
      expectedTotal: "120.00",
      invoiceType: "F1",
      recipient,
      receiptLanguage: "ca",
      delivery: { medium: "email", recipient: "cuentas@talleresmar.es" },
      partyFinish: { partyId: "v1", expectedPartyRevision: 7, expectedEdits: party.expectedEdits },
    });
  });

  it("sends the shown receipt language for a bill with no invoice yet", () => {
    const request = (receiptLanguage: string | undefined) =>
      deferredCloseRequest({
        bill: billOf({ receiptLanguage }),
        offeredLanguages: ["es", "en"],
        expectedEdit: null,
        party: null,
      });

    expect(request("ca")).toMatchObject({
      receiptLanguage: "es",
      expectedEdit: null,
      delivery: null,
      invoiceType: "F2",
      recipient: null,
      partyFinish: null,
    });
    expect(request("en").receiptLanguage).toBe("en");
  });

  it("gives every request a new submission id", () => {
    const args = { bill: billOf(), offeredLanguages: ["es"], expectedEdit: null, party: null };
    expect(deferredCloseRequest(args).submissionId).not.toBe(
      deferredCloseRequest(args).submissionId,
    );
  });
});

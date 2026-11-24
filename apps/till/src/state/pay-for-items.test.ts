import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AllocationPreview,
  BillEditExpected,
  BillPaymentResult,
  TillApi,
} from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import type { PayLine, PayRequest } from "../widgets/bill-pay-dialog.js";
import { refusalText } from "../widgets/pay-refusal.js";
import { confirmationOf, paymentAsk, type Confirmation } from "./bill-payment.js";
import {
  itemsAllocated,
  itemsAllocatedFrom,
  itemsAsk,
  itemsChoiceOf,
  itemsRefusal,
  itemsRequestOf,
  previewPayment,
  takePayment,
  withItems,
  type ItemsPart,
} from "./pay-for-items.js";

afterEach(() => setLocale("en"));

const paella: PayLine = {
  lineNo: 1,
  lineId: "line-1",
  name: "Paella",
  quantity: "1",
  total: "35.00",
  unitTotal: null,
};
const beers: PayLine = {
  lineNo: 2,
  lineId: "line-2",
  name: "Beer",
  quantity: "3",
  total: "9.00",
  unitTotal: "3.00",
};
const flan: PayLine = {
  lineNo: 3,
  lineId: "line-3",
  name: "Flan",
  quantity: "1",
  total: "6.00",
  unitTotal: null,
};
const lines = [paella, beers, flan];

const edit: BillEditExpected = {
  billId: "wo-4",
  editorVersion: 2,
  draftId: null,
  draftRevision: null,
};
const revisions = { expectedPartyRevision: 3, partyId: "v1" };

describe("itemsChoiceOf", () => {
  it("every dish picked whole is the whole bill", () => {
    const picks = new Map([
      [1, 1],
      [2, 3],
      [3, 1],
    ]);

    expect(itemsChoiceOf(lines, picks, lines)).toEqual({ kind: "whole" });
  });

  it("one of three beers is a part pick by line id", () => {
    const choice = itemsChoiceOf(lines, new Map([[2, 1]]), lines);

    expect(choice).toEqual({ kind: "items", picks: [{ lineNo: 2, lineId: "line-2", units: 1 }] });
    expect(itemsAsk({ choice, pay: { method: "cash", tendered: "5" } })).toEqual({
      picks: [{ lineId: "line-2", quantity: "1" }],
      method: "cash",
      tendered: "5",
    });
  });

  it("a dish picked whole beside a part of another names the whole one with no quantity", () => {
    const choice = itemsChoiceOf(
      lines,
      new Map([
        [1, 1],
        [2, 2],
      ]),
      lines,
    );

    expect(itemsAsk({ choice, pay: { method: "card", addedTip: "1.00" } })).toEqual({
      picks: [{ lineId: "line-1" }, { lineId: "line-2", quantity: "2" }],
      method: "card",
      addedTip: "1.00",
    });
  });

  it("a dish not offered any more keeps the rest an items payment", () => {
    const picks = new Map([
      [2, 3],
      [3, 1],
    ]);

    expect(itemsChoiceOf(lines, picks, [beers, flan])).toEqual({
      kind: "items",
      picks: [
        { lineNo: 2, lineId: "line-2" },
        { lineNo: 3, lineId: "line-3" },
      ],
    });
  });
});

describe("itemsAllocated", () => {
  it("a card preview is allocated with its charge and the items' own total", () => {
    expect(
      itemsAllocated({ total: "17.50", applied: "17.50", tip: "2.50", change: null }, "card"),
    ).toEqual({
      kind: "allocated",
      choice: null,
      applied: "17.50",
      tip: "2.50",
      change: null,
      charged: "20.00",
      total: "17.50",
    });
  });

  it("a cash preview keeps its change and charges no card", () => {
    expect(
      itemsAllocated({ total: "17.50", applied: "17.50", tip: "0.00", change: "2.50" }, "cash"),
    ).toEqual({
      kind: "allocated",
      choice: null,
      applied: "17.50",
      tip: "0.00",
      change: "2.50",
      charged: null,
      total: "17.50",
    });
  });

  it("a changed allocation keeps the items' total", () => {
    const fresh: AllocationPreview = {
      kind: "allocated",
      choice: null,
      applied: "16.00",
      tip: "0.00",
      change: "4.00",
      charged: null,
    };

    expect(itemsAllocatedFrom(fresh)).toEqual({ ...fresh, total: "16.00" });
  });
});

describe("itemsRefusal", () => {
  it("a set-menu dish chosen alone is refused in the Pay window's words", () => {
    const refusal = itemsRefusal({ code: "set_menu.no_place_on_target", dishName: "Flan" });

    expect(refusalText(refusal)).toBe(
      "Flan is part of a set menu. Choose its set menu too, or leave it on this bill.",
    );
    setLocale("es");
    expect(
      refusalText(itemsRefusal({ code: "set_menu.no_place_on_target", dishName: "Flan" })),
    ).toBe("Flan forma parte de un menú. Elige también su menú o deja el plato en esta cuenta.");
  });

  it("leaves any other refusal as it is", () => {
    const other = { code: "bill.all_items_chosen" };

    expect(itemsRefusal(other)).toBe(other);
  });
});

const itemsAsked: PayRequest = {
  choice: { kind: "items", picks: [{ lineNo: 2, lineId: "line-2", units: 1 }] },
  pay: { method: "card" },
  card: { entry: "manual", externalRef: "OP-9", externalProvider: "other", externalMachine: "T2" },
};

function itemsConfirmation(asked: PayRequest): Confirmation {
  return confirmationOf(
    paymentAsk(asked.choice, asked.pay, asked.allocation, edit),
    {
      kind: "allocated",
      choice: null,
      applied: "3.00",
      tip: "0.00",
      change: null,
      charged: "3.00",
    },
    asked.card,
  );
}

describe("withItems", () => {
  it("freezes the picks, the bill's edit state and the party's revision for an items choice", () => {
    expect(withItems(itemsConfirmation(itemsAsked), itemsAsked, edit, revisions, false)).toEqual({
      ...itemsConfirmation(itemsAsked),
      items: {
        picks: [{ lineId: "line-2", quantity: "1" }],
        expectedEdits: [edit],
        expectedPartyRevision: 3,
        partyId: "v1",
      },
    });
  });

  it("adds nothing for a whole-bill choice or a printed bill", () => {
    const whole: PayRequest = { choice: { kind: "whole" }, pay: { method: "card" } };
    const confirmation = itemsConfirmation(whole);

    expect(withItems(confirmation, whole, edit, revisions, false)).toBe(confirmation);
    const printed = itemsConfirmation(itemsAsked);
    expect(withItems(printed, itemsAsked, edit, revisions, true)).toBe(printed);
  });
});

describe("itemsRequestOf", () => {
  const items: ItemsPart = {
    picks: [{ lineId: "line-2", quantity: "1" }],
    expectedEdits: [edit],
    expectedPartyRevision: 3,
    partyId: "v1",
  };

  it("the items request carries only what the route reads", () => {
    const confirmation: Confirmation = {
      ...itemsConfirmation(itemsAsked),
      guestCount: 4,
      receiptLanguage: "es",
      ownReceipt: true,
    };

    expect(itemsRequestOf({ ...confirmation, submissionId: "sub-1", items })).toEqual({
      submissionId: "sub-1",
      picks: [{ lineId: "line-2", quantity: "1" }],
      expectedEdits: [edit],
      expectedPartyRevision: 3,
      partyId: "v1",
      method: "card",
      applied: "3.00",
      tip: "0.00",
      externalRef: "OP-9",
      externalProvider: "other",
      externalMachine: "T2",
    });
  });

  it("a cash request carries what was handed over and the tip left", () => {
    const cash: PayRequest = {
      choice: itemsAsked.choice,
      pay: { method: "cash", tendered: "10", addedTip: "1.00" },
    };

    expect(
      itemsRequestOf({
        ...itemsConfirmation(cash),
        submissionId: "sub-1",
        items: { picks: items.picks, expectedEdits: [edit] },
      }),
    ).toEqual({
      submissionId: "sub-1",
      picks: [{ lineId: "line-2", quantity: "1" }],
      expectedEdits: [edit],
      method: "cash",
      applied: "3.00",
      tip: "0.00",
      tendered: "10",
      addedTip: "1.00",
    });
  });

  it("a reader request names the reader and the practice outcome", () => {
    const reader: PayRequest = {
      ...itemsAsked,
      card: { entry: "reader", readerId: "rdr-1", simulationOutcome: "declined" },
    };

    expect(itemsRequestOf({ ...itemsConfirmation(reader), submissionId: "sub-1", items })).toEqual({
      submissionId: "sub-1",
      picks: [{ lineId: "line-2", quantity: "1" }],
      expectedEdits: [edit],
      expectedPartyRevision: 3,
      partyId: "v1",
      method: "card",
      applied: "3.00",
      tip: "0.00",
      entry: "reader",
      readerId: "rdr-1",
      simulationOutcome: "declined",
    });
  });
});

const paid = { outcome: "received" } as unknown as BillPaymentResult;

function apiStub() {
  return {
    previewBillPayment: vi.fn().mockResolvedValue({
      kind: "allocated",
      choice: null,
      applied: "50.00",
      tip: "0.00",
      change: null,
      charged: "50.00",
    }),
    takeBillPayment: vi.fn().mockResolvedValue(paid),
    previewItemPayment: vi
      .fn()
      .mockResolvedValue({ total: "3.00", applied: "3.00", tip: "0.00", change: null }),
    payForItems: vi.fn().mockResolvedValue({ billId: "wo-9", payment: paid }),
  };
}

describe("previewPayment and takePayment", () => {
  const signal = new AbortController().signal;

  it("previewPayment and takePayment send a whole-bill choice down today's routes", async () => {
    const api = apiStub();
    const whole: PayRequest = { choice: { kind: "whole" }, pay: { method: "card" } };

    await previewPayment(api as unknown as TillApi, "wo-4", whole, edit, false);
    expect(api.previewBillPayment).toHaveBeenCalledWith(
      "wo-4",
      paymentAsk(whole.choice, whole.pay, undefined, edit),
    );
    const confirmation = withItems(itemsConfirmation(whole), whole, edit, revisions, false);
    await expect(
      takePayment(
        api as unknown as TillApi,
        "wo-4",
        { ...confirmation, submissionId: "s" },
        {
          signal,
        },
      ),
    ).resolves.toEqual(paid);
    expect(api.takeBillPayment).toHaveBeenCalledWith(
      "wo-4",
      { ...confirmation, submissionId: "s" },
      { signal },
    );
    expect(api.previewItemPayment).not.toHaveBeenCalled();
    expect(api.payForItems).not.toHaveBeenCalled();
  });

  it("previewPayment and takePayment send an items choice down the new ones", async () => {
    const api = apiStub();

    await expect(
      previewPayment(api as unknown as TillApi, "wo-4", itemsAsked, edit, false),
    ).resolves.toEqual({
      kind: "allocated",
      choice: null,
      applied: "3.00",
      tip: "0.00",
      change: null,
      charged: "3.00",
      total: "3.00",
    });
    expect(api.previewItemPayment).toHaveBeenCalledWith("wo-4", {
      picks: [{ lineId: "line-2", quantity: "1" }],
      method: "card",
    });
    const confirmation = withItems(
      itemsConfirmation(itemsAsked),
      itemsAsked,
      edit,
      revisions,
      false,
    );
    const request = { ...confirmation, submissionId: "s" } as Confirmation & {
      submissionId: string;
      items: ItemsPart;
    };
    await expect(
      takePayment(api as unknown as TillApi, "wo-4", request, { signal }),
    ).resolves.toEqual({ ...paid, paidOn: "wo-9" });
    expect(api.payForItems).toHaveBeenCalledWith("wo-4", itemsRequestOf(request), { signal });
    expect(api.previewBillPayment).not.toHaveBeenCalled();
    expect(api.takeBillPayment).not.toHaveBeenCalled();
  });

  it("previewPayment and takePayment send a printed bill's items choice down today's route with kind items", async () => {
    const api = apiStub();

    await previewPayment(api as unknown as TillApi, "wo-4", itemsAsked, edit, true);
    expect(api.previewBillPayment).toHaveBeenCalledWith(
      "wo-4",
      expect.objectContaining({ kind: "items", lines: [{ lineNo: 2, quantity: "1" }] }),
    );
    const confirmation = withItems(
      itemsConfirmation(itemsAsked),
      itemsAsked,
      edit,
      revisions,
      true,
    );
    await takePayment(
      api as unknown as TillApi,
      "wo-4",
      { ...confirmation, submissionId: "s" },
      {
        signal,
      },
    );
    expect(api.takeBillPayment).toHaveBeenCalledWith(
      "wo-4",
      expect.objectContaining({ kind: "items", submissionId: "s" }),
      { signal },
    );
    expect(api.previewItemPayment).not.toHaveBeenCalled();
    expect(api.payForItems).not.toHaveBeenCalled();
  });
});

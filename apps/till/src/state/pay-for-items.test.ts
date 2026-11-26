import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { TillApi } from "../api/client.js";
import type { AllocationPreview, BillBalance, BillPaymentResult } from "../api/payments-api.js";
import type { BillEditExpected } from "../api/order-types.js";
import type { ReadOptions } from "../api/till-request.js";
import { formatMoney } from "@waitron/shared";
import { fill, setLocale, t } from "../i18n/t.js";
import type { PayLine, PayRequest } from "../widgets/bill-pay-dialog.js";
import { refusalText } from "../widgets/pay-refusal.js";
import { confirmationOf, paymentAsk, refusalOf, type Confirmation } from "./bill-payment.js";
import { TABLE_REQUEST_LIMIT_MS } from "./draft-sync.js";
import {
  billPaymentsBannerOutstanding,
  counterItemsEdit,
  counterItemsEditFor,
  itemsAllocated,
  itemsAllocatedFrom,
  itemsAsk,
  itemsChoiceOf,
  itemsRefusal,
  itemsBarredReason,
  itemsRequestOf,
  previewEdit,
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

describe("itemsBarredReason", () => {
  const at = {
    found: false,
    counter: false,
    printed: false,
    paysAfterSending: false,
    status: "open" as const,
  };
  const sent = { ...at, counter: true, paysAfterSending: true, status: "placed" as const };

  it("offers Items on a Counter order sent to the kitchen with no receipt, in a zone that takes payment after sending", () => {
    expect(itemsBarredReason(sent)).toBeNull();
    expect(itemsBarredReason({ ...at, counter: true })).toBeNull();
    expect(itemsBarredReason({ ...at, counter: true, paysAfterSending: true })).toBeNull();
  });

  it("bars Items on a Counter order whose receipt is issued, with its own reason", () => {
    expect(itemsBarredReason({ ...sent, printed: true })).toBe(
      "bill_pay.items_barred_counter_receipt",
    );
    expect(itemsBarredReason({ ...sent, printed: true, paysAfterSending: false })).toBe(
      "bill_pay.items_barred_counter_receipt",
    );
  });

  it("bars Items on a sent Counter order with no receipt whose own mode takes payment first", () => {
    expect(itemsBarredReason({ ...sent, paysAfterSending: false })).toBe(
      "bill_pay.items_barred_counter_prepay",
    );
  });

  it("bars Items on a table bill placed with no receipt, but not on a printed one or an open one", () => {
    expect(itemsBarredReason({ ...at, status: "placed" })).toBe(
      "bill_pay.items_barred_moved_to_table",
    );
    expect(itemsBarredReason({ ...at, paysAfterSending: true, status: "placed" })).toBe(
      "bill_pay.items_barred_moved_to_table",
    );
    expect(itemsBarredReason({ ...at, printed: true, status: "placed" })).toBeNull();
    expect(itemsBarredReason(at)).toBeNull();
  });

  it("bars Items from Find a bill with its own reason", () => {
    expect(itemsBarredReason({ ...at, found: true, printed: true, status: "placed" })).toBe(
      "bill_pay.items_barred_found",
    );
  });
});

describe("itemsChoiceOf", () => {
  it("every dish picked whole is the whole bill", () => {
    const picks = new Map([
      [1, 1],
      [2, 3],
      [3, 1],
    ]);

    expect(itemsChoiceOf(lines, picks)).toEqual({ kind: "whole" });
  });

  it("one of three beers is a part pick by line id", () => {
    const choice = itemsChoiceOf(lines, new Map([[2, 1]]));

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
    );

    expect(itemsAsk({ choice, pay: { method: "card", addedTip: "1.00" } })).toEqual({
      picks: [{ lineId: "line-1" }, { lineId: "line-2", quantity: "2" }],
      method: "card",
      addedTip: "1.00",
    });
  });
});

describe("itemsAllocated", () => {
  it("a card preview is allocated with its charge and the items' own total", () => {
    expect(
      itemsAllocated({ total: "17.50", applied: "17.50", tip: "2.50", change: null }, "card"),
    ).toEqual({
      kind: "allocated",
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
      applied: "16.00",
      tip: "0.00",
      change: "4.00",
      charged: null,
    };

    expect(itemsAllocatedFrom(fresh)).toEqual({ ...fresh, total: "16.00" });
  });
});

describe("itemsRefusal", () => {
  it("a cancelled set-menu dish still charged, chosen alone, is refused in the Pay window's words", () => {
    const refusal = itemsRefusal({ code: "set_menu.moves_with_set_menu", dishName: "Flan" });

    expect(refusalText(refusal)).toBe(
      "Flan was cancelled but is still charged, so it can only be paid for with its set menu. Choose the set menu too, or leave Flan on this bill.",
    );
    setLocale("es");
    expect(
      refusalText(itemsRefusal({ code: "set_menu.moves_with_set_menu", dishName: "Flan" })),
    ).toBe(fill(t("bill_pay.items_set_menu_dish"), { dishName: "Flan" }));
  });

  it("a comped or discounted set-menu dish chosen alone is refused in the Pay window's words", () => {
    const refusal = refusalOf({
      code: "set_menu.move_adjusted",
      dishNames: ["Sirloin", 3, "Soup", "Hake"],
    });

    expect(refusalText(itemsRefusal(refusal))).toBe(
      "Because of a comp or discount, Sirloin, Soup and Hake can only be paid for with the set menu. Choose the set menu too, or leave Sirloin, Soup and Hake on this bill.",
    );
    setLocale("es");
    expect(refusalText(itemsRefusal(refusal))).toBe(
      fill(t("bill_pay.items_set_menu_adjusted"), { dishNames: "Sirloin, Soup y Hake" }),
    );
  });

  it("keeps the general words for a comped or discounted dish the refusal does not name", () => {
    const refusal = refusalOf({ code: "set_menu.move_adjusted", dishNames: [] });

    expect(itemsRefusal(refusal)).toBe(refusal);
  });

  it("the advances refusal names its amount in the Pay window", () => {
    const refusal = refusalOf({ code: "bill.below_advances", advances: "15.00" });

    expect(refusalText(refusal)).toContain(`(${formatMoney("15.00", "en")})`);
    setLocale("es");
    expect(refusalText(refusal)).toContain(`(${formatMoney("15.00", "es")})`);
    expect(refusalText(refusal)).toContain("su propio ticket");
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
    paymentAsk(asked.choice, asked.pay, edit),
    {
      kind: "allocated",
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
    expect(withItems(itemsConfirmation(itemsAsked), itemsAsked, edit, revisions)).toEqual({
      ...itemsConfirmation(itemsAsked),
      items: {
        picks: [{ lineId: "line-2", quantity: "1" }],
        expectedEdits: [edit],
        expectedPartyRevision: 3,
        partyId: "v1",
      },
    });
  });

  it("refuses an items choice with no edit state rather than send one the route refuses", () => {
    expect(() => withItems(itemsConfirmation(itemsAsked), itemsAsked, null, revisions)).toThrow(
      "edit state",
    );
  });

  it("adds nothing for a whole-bill choice", () => {
    const whole: PayRequest = { choice: { kind: "whole" }, pay: { method: "card" } };
    const confirmation = itemsConfirmation(whole);

    expect(withItems(confirmation, whole, edit, revisions)).toBe(confirmation);
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

    await previewPayment(api as unknown as TillApi, "wo-4", whole, edit);
    expect(api.previewBillPayment).toHaveBeenCalledWith(
      "wo-4",
      paymentAsk(whole.choice, whole.pay, edit),
      { signal: expect.any(AbortSignal) },
    );
    const confirmation = withItems(itemsConfirmation(whole), whole, edit, revisions);
    await expect(
      takePayment(
        api as unknown as TillApi,
        "wo-4",
        whole.choice,
        { ...confirmation, submissionId: "s" },
        { signal },
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
      previewPayment(api as unknown as TillApi, "wo-4", itemsAsked, edit),
    ).resolves.toEqual({
      kind: "allocated",
      applied: "3.00",
      tip: "0.00",
      change: null,
      charged: "3.00",
      total: "3.00",
    });
    expect(api.previewItemPayment).toHaveBeenCalledWith(
      "wo-4",
      { picks: [{ lineId: "line-2", quantity: "1" }], method: "card" },
      { signal: expect.any(AbortSignal) },
    );
    const confirmation = withItems(itemsConfirmation(itemsAsked), itemsAsked, edit, revisions);
    const request = { ...confirmation, submissionId: "s" } as Confirmation & {
      submissionId: string;
      items: ItemsPart;
    };
    await expect(
      takePayment(api as unknown as TillApi, "wo-4", itemsAsked.choice, request, { signal }),
    ).resolves.toEqual({ ...paid, paidOn: "wo-9" });
    expect(api.payForItems).toHaveBeenCalledWith("wo-4", itemsRequestOf(request), { signal });
    expect(api.previewBillPayment).not.toHaveBeenCalled();
    expect(api.takeBillPayment).not.toHaveBeenCalled();
  });

  it.each(["whole", "items"] as const)(
    "previewPayment gives up at the till's time limit when the preview never answers (%s)",
    async (kind) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      onTestFinished(() => {
        vi.useRealTimers();
      });
      const never = (_billId: string, _ask: unknown, options?: ReadOptions) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () => reject(options.signal!.reason)),
        );
      const api = apiStub();
      api.previewBillPayment.mockImplementation(never);
      api.previewItemPayment.mockImplementation(never);
      const asked: PayRequest =
        kind === "items" ? itemsAsked : { choice: { kind: "whole" }, pay: { method: "card" } };
      const settled = vi.fn();
      const preview = previewPayment(api as unknown as TillApi, "wo-4", asked, edit);
      preview.catch(settled);

      await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(preview).rejects.toMatchObject({ name: "AbortError" });
    },
  );

  it("takePayment refuses an items choice with no items part", async () => {
    const api = apiStub();
    const request = { ...itemsConfirmation(itemsAsked), submissionId: "s" };

    await expect(
      takePayment(api as unknown as TillApi, "wo-4", itemsAsked.choice, request, { signal }),
    ).rejects.toThrow("Pay for items needs its items part");
    expect(api.takeBillPayment).not.toHaveBeenCalled();
    expect(api.payForItems).not.toHaveBeenCalled();
  });

  it("takePayment passes on the table's bill an items answer carries", async () => {
    const api = apiStub();
    const sourceBalance = { workingOrderId: "wo-4", total: "21.00" } as unknown as BillBalance;
    api.payForItems.mockResolvedValue({ billId: "wo-9", payment: paid, sourceBalance });
    const request = {
      ...withItems(itemsConfirmation(itemsAsked), itemsAsked, edit, revisions),
      submissionId: "s",
    } as Confirmation & { submissionId: string; items: ItemsPart };

    await expect(
      takePayment(api as unknown as TillApi, "wo-4", itemsAsked.choice, request, { signal }),
    ).resolves.toEqual({ ...paid, paidOn: "wo-9", sourceBalance });
  });
});

describe("counterItemsEdit", () => {
  const found = (bill: Record<string, unknown>) =>
    ({ getFindBill: vi.fn().mockResolvedValue(bill) }) as unknown as TillApi;
  const stored = {
    billId: "wo-1",
    editorId: null,
    editorName: null,
    editorVersion: 4,
    draftId: null,
    draftRevision: null,
  };

  it("answers the bill read's edit state for an order with no party, as the route parses it", async () => {
    const api = found({ workingOrderId: "wo-1", partyId: null, edit: stored });
    const { signal } = new AbortController();

    await expect(counterItemsEdit(api, "wo-1", { signal })).resolves.toEqual({
      billId: "wo-1",
      editorVersion: 4,
      draftId: null,
      draftRevision: null,
    });
    expect(api.getFindBill).toHaveBeenCalledExactlyOnceWith("wo-1", { signal });
  });

  it.each([
    ["names a party", { workingOrderId: "wo-1", partyId: "v1", edit: stored }],
    ["has no edit state", { workingOrderId: "wo-1", partyId: null, edit: null }],
    [
      "gives another bill's edit state",
      { workingOrderId: "wo-1", partyId: null, edit: { ...stored, billId: "wo-2" } },
    ],
    ["is of another order", { workingOrderId: "wo-2", partyId: null, edit: stored }],
  ])("is out of date when the bill read %s", async (_, bill) => {
    await expect(counterItemsEdit(found(bill), "wo-1", {})).rejects.toEqual({
      code: "draft.out_of_date",
    });
  });
});

describe("previewEdit", () => {
  const items: PayRequest["choice"] = { kind: "items", picks: [] };
  const whole: PayRequest["choice"] = { kind: "whole" };
  const counter = { surface: "counter" as const };
  const table = { surface: "table" as const };
  const found = { surface: "counter" as const, found: { expectedEdit: null } };

  it.each([
    ["a held edit state on a table bill", edit, table, items, edit, false],
    ["no edit state for a Counter order's whole payment", null, counter, whole, null, false],
    ["no edit state for a found Counter order's whole payment", null, found, whole, null, false],
    ["no edit state for Pay for items on a Counter order", null, counter, items, null, true],
    ["a held edit state for Pay for items on a Counter order", edit, counter, items, edit, false],
  ] as const)("keeps %s", (_, held, open, choice, expectedEdit, readCounterEdit) => {
    expect(previewEdit(held, open, choice)).toEqual({ expectedEdit, readCounterEdit });
  });

  it.each([
    ["an unknown edit state", undefined, counter, whole],
    ["no edit state on a table bill", null, table, whole],
    ["no edit state for Pay for items on a table bill", null, table, items],
    ["no edit state for Pay for items on a Counter order from Find a bill", null, found, items],
  ] as const)("refuses %s as out of date", (_, held, open, choice) => {
    expect(() => previewEdit(held, open, choice)).toThrow(
      expect.objectContaining({ code: "draft.out_of_date" }),
    );
  });
});

describe("counterItemsEditFor", () => {
  const stored = { ...edit, editorId: null, editorName: null, editorVersion: 5 };
  const reading = () =>
    ({
      getFindBill: vi
        .fn()
        .mockResolvedValue({ workingOrderId: "wo-4", partyId: null, edit: stored }),
    }) as unknown as TillApi & { getFindBill: ReturnType<typeof vi.fn> };
  const preview = { kind: "allocated" } as AllocationPreview;

  it("sends again the edit state a confirmation's preview was asked with, reading nothing", async () => {
    const api = reading();

    await expect(
      counterItemsEditFor(api, { billId: "wo-4", preview, expectedEdit: edit }),
    ).resolves.toBe(edit);
    expect(api.getFindBill).not.toHaveBeenCalled();
  });

  it.each([
    ["before a preview", { billId: "wo-4", preview: null, expectedEdit: edit }],
    [
      "when the held one is another bill's",
      { billId: "wo-4", preview, expectedEdit: { ...edit, billId: "wo-2" } },
    ],
  ])("reads the bill's edit state %s", async (_, open) => {
    const api = reading();

    await expect(counterItemsEditFor(api, open)).resolves.toEqual({ ...edit, editorVersion: 5 });
    expect(api.getFindBill).toHaveBeenCalledOnce();
  });

  it("gives up the read at the till's request time limit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const api = {
      getFindBill: (_billId: string, options?: ReadOptions) =>
        new Promise((_resolve, reject) =>
          options?.signal?.addEventListener("abort", () => reject(options.signal!.reason)),
        ),
    } as unknown as TillApi;
    const settled = vi.fn();
    const read = counterItemsEditFor(api, { billId: "wo-4", preview: null, expectedEdit: null });
    read.catch(settled);

    await vi.advanceTimersByTimeAsync(TABLE_REQUEST_LIMIT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("billPaymentsBannerOutstanding", () => {
  const banner = { billPayments: "€10.00" };
  const balance = { workingOrderId: "wo-4", outstanding: "4.50" } as BillBalance;

  it("gives the order's new outstanding while its take-the-rest banner is up", () => {
    expect(billPaymentsBannerOutstanding(banner, balance, "wo-4")).toBe("4.50");
  });

  it.each([
    ["another banner", "sale.error", balance],
    ["a refusal's banner", { code: "bill.paid" }, balance],
    ["no banner", undefined, balance],
    ["another order's balance", banner, { ...balance, workingOrderId: "wo-2" }],
    ["no balance read", banner, undefined],
  ])("leaves the banner alone for %s", (_, said, read) => {
    expect(billPaymentsBannerOutstanding(said, read, "wo-4")).toBeUndefined();
  });
});

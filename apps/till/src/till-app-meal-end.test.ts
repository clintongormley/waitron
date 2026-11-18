import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { EndedMeal, PartyBill, TillApi } from "./api/client.js";
import type { CapabilityFlag } from "./layout.js";
import {
  billOf,
  emit,
  floor,
  flush,
  heldTable,
  openTable,
  resetBillPayDrafts,
  shell,
  stubApi,
  tableOrder,
  text,
  till,
} from "../test/bill-pay-app.js";

/** How long a send that gets no answer is given to be sent again. The resends wait real time. */
const GIVE_UP_MS = 10_000;

const printedBill: PartyBill = billOf({
  status: "placed",
  receiptAvailable: true,
  invoiceNumber: "F-0042",
});
const ended: EndedMeal = {
  revision: 4,
  workingOrderId: "wo-4",
  saleId: "s-4",
  invoiceNumber: "F-0042",
  total: "120.00",
  owed: "120.00",
};
const unservedRefusal = {
  code: "meal_end.unserved_dishes",
  status: 409,
  workingOrderId: "wo-4",
  dishes: [
    { lineId: "line-1", dishName: "Paella", quantity: "1.000", released: true },
    { lineId: "line-2", dishName: "Chuletón", quantity: "1.000", released: false },
  ],
};

let api: TillApi;

/** Opens table 4, whose one bill `wo-4` is read open until `endMeal` answers, and printed after. */
async function openBill(
  overrides: Record<string, unknown> = {},
  capabilities: CapabilityFlag[] = ["print-receipt", "take-cash", "hand-over-orders"],
) {
  let printed = false;
  const endMeal = vi.fn(
    (overrides.endMeal as ((...args: unknown[]) => Promise<unknown>) | undefined) ??
      (async () => ended),
  );
  api = stubApi({
    getTill: vi.fn().mockResolvedValue({ ...till, capabilities }),
    getPartyBills: vi.fn(async () => [printed ? printedBill : billOf()]),
    markServed: vi.fn().mockResolvedValue({ revision: 4 }),
    ...overrides,
    endMeal: vi.fn(async (...args: unknown[]) => {
      const answer = (await endMeal(...args)) as EndedMeal;
      printed = true;
      return answer;
    }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el);
  return { el, endMeal };
}

const shadow = (el: TillApp) => tableOrder(el).shadowRoot!;
const printedNotice = (el: TillApp) => shadow(el).querySelector("[data-bill-printed]");
const warning = (el: TillApp) => shadow(el).querySelector<HTMLElement>("[data-meal-end-unserved]");
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const sentBodies = (endMeal: ReturnType<typeof vi.fn>) =>
  endMeal.mock.calls.map((call) => call[1] as Record<string, unknown>);

async function printBill(el: TillApp): Promise<void> {
  emit(tableOrder(el), "end-meal", { workingOrderId: "wo-4" });
  await flush(el, 6);
}

beforeEach(() => {
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(cleanupWidgets);
afterEach(() => {
  vi.useRealTimers();
  setLocale("en");
});

describe("till-app: Print the bill", () => {
  it("sends the bill with the revision it read and one submission id, rereads the bills and says the bill is printed", async () => {
    const { el, endMeal } = await openBill();
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;

    await printBill(el);

    expect(endMeal).toHaveBeenCalledOnce();
    expect(endMeal.mock.calls[0]![0]).toBe("v1");
    const body = sentBodies(endMeal)[0]!;
    expect(body).toEqual({
      billId: "wo-4",
      expectedPartyRevision: 3,
      expectedEdits: [expect.objectContaining({ billId: "wo-4" })],
      submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
    expect(text(printedNotice(el))).toBe(t("bill.printed"));
    expect(tableOrder(el).bills[0]!.invoiceNumber).toBe("F-0042");
  });

  it("sends nothing for a bill that already has its receipt on screen", async () => {
    const { el, endMeal } = await openBill({
      getPartyBills: vi.fn().mockResolvedValue([printedBill]),
    });

    await printBill(el);

    expect(tableOrder(el).bills[0]!.invoiceNumber).toBe("F-0042");
    expect(endMeal).not.toHaveBeenCalled();
    expect(printedNotice(el)).toBeNull();
  });

  it("sends nothing for a bill no longer on the table", async () => {
    const { el, endMeal } = await openBill();

    emit(tableOrder(el), "end-meal", { workingOrderId: "wo-gone" });
    await flush(el, 6);

    expect(endMeal).not.toHaveBeenCalled();
  });

  it("sends one request while a press is still out", async () => {
    const endMeal = vi.fn(() => new Promise(() => {}));
    const { el } = await openBill({ endMeal });

    await printBill(el);
    await printBill(el);

    expect(endMeal).toHaveBeenCalledOnce();
  });

  it("sends the same request again when one gets no answer, and says the bill is printed once", async () => {
    const endMeal = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(ended);
    const { el } = await openBill({ endMeal });

    await printBill(el);
    await expect.poll(() => printedNotice(el), { timeout: GIVE_UP_MS }).not.toBeNull();

    expect(endMeal).toHaveBeenCalledTimes(2);
    expect(sentBodies(endMeal)[1]).toEqual(sentBodies(endMeal)[0]);
    expect(shadow(el).querySelectorAll("[data-bill-printed]")).toHaveLength(1);
    expect(banner(el)).toBeNull();
  });

  it("says a bill whose resends all got no answer may have been printed", async () => {
    const endMeal = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await openBill({ endMeal });

    await printBill(el);
    await expect
      .poll(() => banner(el)?.textContent ?? "", { timeout: GIVE_UP_MS })
      .toContain(t("meal_end.unconfirmed"));

    expect(endMeal).toHaveBeenCalledTimes(3);
    expect(printedNotice(el)).toBeNull();
  });

  it("shows Bill printed only under the bill printed, and not after switching bills or reopening the table", async () => {
    const { el } = await openBill({
      getPartyBills: vi.fn(async () => [
        billOf(),
        billOf({ workingOrderId: "wo-9", billNumber: 2 }),
      ]),
    });
    await printBill(el);
    expect(printedNotice(el)).not.toBeNull();

    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-9" });
    await flush(el, 6);
    expect(tableOrder(el).orderId).toBe("wo-9");
    expect(printedNotice(el)).toBeNull();

    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-4" });
    await flush(el, 6);
    expect(tableOrder(el).orderId).toBe("wo-4");
    expect(printedNotice(el)).toBeNull();

    await printBill(el);
    expect(printedNotice(el)).not.toBeNull();
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
    expect(tableOrder(el).orderId).toBe("wo-4");
    expect(printedNotice(el)).toBeNull();
  });

  it("does not say Bill printed under the bill the screen moves to when the printed bill leaves the party", async () => {
    let printed = false;
    const { el } = await openBill({
      getPartyBills: vi.fn(async () =>
        printed
          ? [billOf({ workingOrderId: "wo-9", billNumber: 2 })]
          : [billOf(), billOf({ workingOrderId: "wo-9", billNumber: 2 })],
      ),
      endMeal: vi.fn(async () => {
        printed = true;
        return ended;
      }),
    });

    await printBill(el);

    expect(tableOrder(el).orderId).toBe("wo-9");
    expect(printedNotice(el)).toBeNull();
  });

  it("sends nothing for a bill other than the one on screen", async () => {
    const { el, endMeal } = await openBill({
      getPartyBills: vi.fn(async () => [
        billOf(),
        billOf({ workingOrderId: "wo-9", billNumber: 2 }),
      ]),
    });

    emit(tableOrder(el), "end-meal", { workingOrderId: "wo-9" });
    await flush(el, 6);

    expect(tableOrder(el).orderId).toBe("wo-4");
    expect(endMeal).not.toHaveBeenCalled();
  });

  it.each([
    "meal_end.no_printer",
    "meal_end.delivery_unavailable",
    "meal_end.already_issued",
    "bill.unsent_dishes",
    "bill.nothing_outstanding",
    "draft.taken_over",
    "device.forbidden_action",
    "authorization.not_permitted",
  ])("shows %s's own sentence and reads the bills again", async (code) => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({ code, status: 409, workingOrderId: "wo-4" }),
    });
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;

    await printBill(el);

    expect(banner(el)!.textContent).toContain(codeMessage(code));
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
    expect(printedNotice(el)).toBeNull();
  });

  it("when another device changed the table first, reloads it, says what changed, and sends the new revision when pressed again", async () => {
    let moved = false;
    const endMeal = vi
      .fn()
      .mockRejectedValueOnce({ code: "party.out_of_date", partyId: "v1", revision: 5 })
      .mockResolvedValue(ended);
    const { el } = await openBill({
      endMeal,
      getTablesState: vi.fn(async () => [heldTable(moved ? { revision: 5 } : {})]),
    });
    moved = true;

    await printBill(el);

    expect(tableOrder(el).party!.revision).toBe(5);
    const said = banner(el)!.textContent!;
    expect(said).toContain(t("party.changed").replace("{table}", "4"));
    expect(said).toContain(t("party.try_again"));

    await printBill(el);
    expect(endMeal).toHaveBeenCalledTimes(2);
    expect(sentBodies(endMeal)[1]!.expectedPartyRevision).toBe(5);
  });
});

describe("till-app: Print the bill with dishes not served", () => {
  it("shows the dishes by name, and Mark served serves those the kitchen has; Print the bill then prints", async () => {
    const endMeal = vi.fn().mockRejectedValueOnce(unservedRefusal).mockResolvedValue(ended);
    const { el } = await openBill({ endMeal });

    await printBill(el);

    expect(text(warning(el))).toContain("Paella");
    expect(text(warning(el))).toContain("Chuletón");
    expect(text(warning(el))).toContain(codeMessage("meal_end.unserved_dishes"));
    expect(printedNotice(el)).toBeNull();
    warning(el)!.querySelector<HTMLElement>("[data-mark-served]")!.click();
    await flush(el, 6);

    expect(api.markServed).toHaveBeenCalledOnce();
    expect(vi.mocked(api.markServed).mock.calls[0]!.slice(0, 2)).toEqual([
      "v1",
      [{ lineId: "line-1", quantity: "1" }],
    ]);

    await printBill(el);

    expect(endMeal).toHaveBeenCalledTimes(2);
    const [first, second] = sentBodies(endMeal);
    expect(second!.printAnyway).toBeUndefined();
    expect(second!.submissionId).not.toBe(first!.submissionId);
    expect(text(printedNotice(el))).toBe(t("bill.printed"));
    expect(warning(el)).toBeNull();
  });

  it("keeps a dish in the list when an ordinary Serve marks only part of it served", async () => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({
        ...unservedRefusal,
        dishes: [{ lineId: "line-1", dishName: "Paella", quantity: "2.000", released: true }],
      }),
    });
    await printBill(el);

    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);

    expect(api.markServed).toHaveBeenCalledOnce();
    expect(text(warning(el))).toContain("Paella");
  });

  it("offers no Mark served on a device whose profile does not hand over orders", async () => {
    const { el } = await openBill({ endMeal: vi.fn().mockRejectedValue(unservedRefusal) }, [
      "print-receipt",
      "take-cash",
    ]);

    await printBill(el);

    expect(warning(el)).not.toBeNull();
    expect(warning(el)!.querySelector("[data-mark-served]")).toBeNull();
  });

  it("Print anyway sends the same bill with printAnyway under a new submission id, and prints", async () => {
    const endMeal = vi.fn().mockRejectedValueOnce(unservedRefusal).mockResolvedValue(ended);
    const { el } = await openBill({ endMeal });
    await printBill(el);

    warning(el)!.querySelector<HTMLElement>("[data-print-anyway]")!.click();
    await flush(el, 6);

    expect(endMeal).toHaveBeenCalledTimes(2);
    const [first, second] = sentBodies(endMeal);
    expect(second).toEqual({
      ...first,
      printAnyway: true,
      submissionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(second!.submissionId).not.toBe(first!.submissionId);
    expect(text(printedNotice(el))).toBe(t("bill.printed"));
    expect(warning(el)).toBeNull();
  });
});

describe("till-app: Print the bill from Finish table's refusal", () => {
  it("shows the bill the refusal names before printing it, and says it is printed under that bill", async () => {
    let printed = false;
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: vi.fn(async () => [
        billOf(),
        billOf(
          printed
            ? { workingOrderId: "wo-9", billNumber: 2, status: "placed", invoiceNumber: "F-0043" }
            : { workingOrderId: "wo-9", billNumber: 2 },
        ),
      ]),
      endMeal: vi.fn(async () => {
        printed = true;
        return { ...ended, workingOrderId: "wo-9" };
      }),
    });
    emit(tableOrder(el), "finish-table", {});
    await flush(el);

    shadow(el).querySelector<HTMLElement>("[data-finish-refusal] [data-print-bill]")!.click();
    await flush(el, 8);

    expect(endMeal).toHaveBeenCalledOnce();
    expect(sentBodies(endMeal)[0]!.billId).toBe("wo-9");
    expect(tableOrder(el).orderId).toBe("wo-9");
    expect(text(printedNotice(el))).toBe(t("bill.printed"));

    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-4" });
    await flush(el, 6);
    expect(printedNotice(el)).toBeNull();
  });

  it("prints the bill the refusal names", async () => {
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
    });
    emit(tableOrder(el), "finish-table", {});
    await flush(el);

    shadow(el).querySelector<HTMLElement>("[data-finish-refusal] [data-print-bill]")!.click();
    await flush(el, 6);

    expect(endMeal).toHaveBeenCalledOnce();
    expect(sentBodies(endMeal)[0]!.billId).toBe("wo-4");
    expect(text(printedNotice(el))).toBe(t("bill.printed"));
  });
});

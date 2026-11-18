import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { clockUnusableText, overLimitText, setLocale, t } from "./i18n/t.js";
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
    { lineId: "line-2", dishName: "Ribeye", quantity: "1.000", released: false },
  ],
};

let api: TillApi;

/** Opens table 4, whose one bill `wo-4` is read open until `endMeal` answers, and printed after. */
async function openBill(
  overrides: Record<string, unknown> = {},
  capabilities: CapabilityFlag[] = ["print-receipt", "take-cash", "hand-over-orders"],
  permissions: string[] = ["payment.take"],
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
    readCurrentOrders: vi.fn().mockResolvedValue({
      revision: 3,
      hasGroups: false,
      nextDisplayNumber: 1,
      retainedCourses: [],
      groups: [],
      ungrouped: [],
      reminder: null,
    }),
    ...overrides,
    endMeal: vi.fn(async (...args: unknown[]) => {
      const answer = (await endMeal(...args)) as EndedMeal;
      printed = true;
      return answer;
    }),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await openTable(el, permissions);
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
    expect(text(printedNotice(el))).toBe(t("bill.issued"));
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

  it("shows Bill issued only under the bill printed, and not after switching bills or reopening the table", async () => {
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

  it("does not say Bill issued under the bill the screen moves to when the printed bill leaves the party", async () => {
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

  it("offers no Print the bill to a person who may not take payment, and sends nothing if asked", async () => {
    const { el, endMeal } = await openBill({}, undefined, []);

    expect(tableOrder(el).takesPayment).toBe(false);
    await printBill(el);

    expect(endMeal).not.toHaveBeenCalled();
  });

  it("tells the screen a person who may take payment may print the bill", async () => {
    const { el } = await openBill();

    expect(tableOrder(el).takesPayment).toBe(true);
  });

  it("sends nothing while the bill's whole payment has no answer, even when asked directly", async () => {
    const recordSale = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el, endMeal } = await openBill({ recordSale });
    emit(tableOrder(el), "pay-tab", { method: "cash", amount: "120.00", guestCount: 4 });
    await flush(el, 6);
    expect(recordSale).toHaveBeenCalledOnce();

    await printBill(el);

    expect(endMeal).not.toHaveBeenCalled();
  });

  it("sends nothing for a new bill with no dishes", async () => {
    const { el, endMeal } = await openBill({
      getPartyBills: vi.fn(async () => [billOf({ total: "0.00", outstanding: "0.00" })]),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0 }),
    });

    await printBill(el);

    expect(endMeal).not.toHaveBeenCalled();
  });

  it("says a refused permission as the person's own, not as an approver's", async () => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({ code: "authorization.not_permitted", status: 403 }),
    });

    await printBill(el);

    expect(banner(el)!.textContent).toContain(t("take_payment.not_permitted"));
    expect(banner(el)!.textContent).not.toContain(codeMessage("authorization.not_permitted"));
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
    "device.forbidden_action",
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

  it.each([
    "clock.unconfirmed",
    "clock.unusable",
    "draft.out_of_date",
    "device.unauthorized",
    "service_zone.not_allowed",
    "handover.stepping_down",
    "fiscal.chain_handed_over",
    "storage.disk_full",
    "order.payment_in_flight",
    "bill.refund_in_progress",
    "working_order.not_open",
    "product.unavailable",
    "invoice.recipient_invalid",
    "fiscal.taxpayer_domicile_missing",
    "printer.not_found",
    "session.required",
    "till.origin_refused",
    "submission.id_reused",
  ])("says %s in its own words, not as a failed table change", async (code) => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({ code, status: 409, workingOrderId: "wo-4" }),
    });

    await printBill(el);

    expect(banner(el)!.textContent).toContain(codeMessage(code));
    expect(banner(el)!.textContent).not.toContain(t("table.error"));
  });

  it("says a table no longer open in its own words, as Finish does, and prints nothing", async () => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({ code: "party.not_open", status: 409, partyId: "v1" }),
    });

    await printBill(el);

    expect(banner(el)!.textContent).toContain(codeMessage("party.not_open"));
    expect(printedNotice(el)).toBeNull();
  });

  it("says a person the device's profile no longer admits cannot print the bill there", async () => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({ code: "device_profile.not_admitted", status: 403 }),
    });

    await printBill(el);

    expect(banner(el)!.textContent).toContain(t("meal_end.not_admitted"));
  });

  it("says a closed session as ended when the server finds it not open", async () => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({ code: "session.not_open", status: 401 }),
    });

    await printBill(el);

    expect(banner(el)!.textContent).toContain(codeMessage("session.required"));
  });

  it("dates a clock.unusable refusal by the server's reading, as a payment does", async () => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({
        code: "clock.unusable",
        status: 409,
        clockAt: "2024-01-05T10:00:00.000Z",
        offsetMinutes: 60,
      }),
    });

    await printBill(el);

    const said = banner(el)!.textContent!;
    expect(
      [false, true].some((checkTime) =>
        said.includes(clockUnusableText("2024-01-05T10:00:00.000Z", 60, checkTime)),
      ),
    ).toBe(true);
  });

  it("says the time zone refusal by its reason", async () => {
    const { el } = await openBill({
      endMeal: vi
        .fn()
        .mockRejectedValue({ code: "venue.time_zone_not_ready", status: 409, reason: "missing" }),
    });

    await printBill(el);

    expect(banner(el)!.textContent).toContain(
      codeMessage("venue.time_zone_not_ready", undefined, { reason: "missing" }),
    );
  });

  it("names the simplified-invoice limit a bill would pass", async () => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({
        code: "sale.total_exceeds_simplified_limit",
        status: 409,
        total: "3200.00",
        limit: "3000.00",
      }),
    });

    await printBill(el);

    expect(banner(el)!.textContent).toContain(overLimitText("3000.00"));
  });

  it.each(["fiscal.record_invalid", "fiscal.foreign_recipient_unsupported"])(
    "says %s cannot be filed and that trying again will not help, as placing an order does",
    async (code) => {
      const { el } = await openBill({
        endMeal: vi.fn().mockRejectedValue({ code, status: 409 }),
      });

      await printBill(el);

      expect(banner(el)!.textContent).toContain(t("place.refused"));
    },
  );

  it.each([
    ["Marta", t("table.draft_taken_over_unsent").replace("{name}", "Marta")],
    [null, t("table.draft_taken_over_unsent_unnamed")],
  ])(
    "names the person whose unsent order holds the bill (%s) and reads the bills again",
    async (ownerName, said) => {
      const { el } = await openBill({
        endMeal: vi.fn().mockRejectedValue({
          code: "draft.taken_over",
          status: 409,
          billId: "wo-4",
          ownerId: "p-9",
          ownerName,
        }),
      });
      const billReads = vi.mocked(api.getPartyBills).mock.calls.length;

      await printBill(el);

      expect(banner(el)!.textContent).toContain(said);
      expect(banner(el)!.textContent).not.toContain(codeMessage("draft.taken_over"));
      expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
      expect(printedNotice(el)).toBeNull();
    },
  );

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
    expect(text(warning(el))).toContain("Ribeye");
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
    expect(text(printedNotice(el))).toBe(t("bill.issued"));
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

  it("Mark served after an ordinary Serve took part of a dish serves only what is left of it", async () => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({
        ...unservedRefusal,
        dishes: [{ lineId: "line-1", dishName: "Paella", quantity: "1.500", released: true }],
      }),
    });
    await printBill(el);
    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);

    warning(el)!.querySelector<HTMLElement>("[data-mark-served]")!.click();
    await flush(el, 6);

    expect(vi.mocked(api.markServed).mock.calls.map((call) => call[1])).toEqual([
      [{ lineId: "line-1", quantity: "1" }],
      [{ lineId: "line-1", quantity: "0.5" }],
    ]);
  });

  it("takes the list down once the table changes after it, so Print anyway is never sent over dishes it did not list", async () => {
    let revision = 3;
    const endMeal = vi.fn().mockRejectedValueOnce(unservedRefusal).mockResolvedValue(ended);
    const { el } = await openBill({
      endMeal,
      getTablesState: vi.fn(async () => [heldTable({ revision })]),
      unmarkServed: vi.fn(async () => ({ revision: ++revision })),
    });
    await printBill(el);
    expect(warning(el)).not.toBeNull();

    emit(tableOrder(el), "unserve-lines", { items: [{ lineId: "line-3", quantity: "1" }] });
    await flush(el, 6);
    expect(tableOrder(el).party!.revision).toBe(4);
    warning(el)?.querySelector<HTMLElement>("[data-print-anyway]")?.click();
    await flush(el, 6);

    expect(warning(el)).toBeNull();
    expect(sentBodies(endMeal)).toHaveLength(1);
  });

  it("keeps the list down when this till serves a dish after unserving one, since the serve was sent from a revision the list never described", async () => {
    let revision = 3;
    const endMeal = vi.fn().mockRejectedValueOnce(unservedRefusal).mockResolvedValue(ended);
    const { el } = await openBill({
      endMeal,
      getTablesState: vi.fn(async () => [heldTable({ revision })]),
      unmarkServed: vi.fn(async () => ({ revision: ++revision })),
      markServed: vi.fn(async () => ({ revision: ++revision })),
    });
    await printBill(el);
    expect(warning(el)).not.toBeNull();
    emit(tableOrder(el), "unserve-lines", { items: [{ lineId: "line-3", quantity: "1" }] });
    await flush(el, 6);
    expect(warning(el)).toBeNull();

    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);

    expect(vi.mocked(api.markServed).mock.calls[0]![2]).toEqual(
      expect.objectContaining({ expectedPartyRevision: 4 }),
    );
    expect(tableOrder(el).party!.revision).toBe(5);
    expect(warning(el)).toBeNull();
  });

  it("Print anyway sends the revision the list describes when the screen has not learnt it", async () => {
    let answerServe: (answer: { revision: number }) => void = () => {};
    const tablet = "tablet-landscape" as const;
    const endMeal = vi.fn().mockRejectedValueOnce(unservedRefusal).mockResolvedValue(ended);
    const { el } = await openBill({
      endMeal,
      getTill: vi.fn().mockResolvedValue({
        ...till,
        formFactor: tablet,
        capabilities: ["print-receipt", "take-cash", "hand-over-orders"],
      }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "till-dev", name: "Till 1", formFactor: tablet }),
      markServed: vi.fn(
        () =>
          new Promise<{ revision: number }>((resolve) => {
            answerServe = resolve;
          }),
      ),
    });
    await printBill(el);
    expect(warning(el)).not.toBeNull();

    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);
    expect(api.markServed).toHaveBeenCalledOnce();
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el, 6);
    answerServe({ revision: 4 });
    await flush(el, 6);
    emit(shell(el), "screen-select", { screen: "order" });
    await flush(el, 6);
    expect(tableOrder(el).party!.revision).toBe(3);
    expect(text(warning(el))).toContain("Ribeye");
    expect(text(warning(el))).not.toContain("Paella");

    warning(el)!.querySelector<HTMLElement>("[data-print-anyway]")!.click();
    await flush(el, 6);

    expect(sentBodies(endMeal)[1]).toEqual(
      expect.objectContaining({ expectedPartyRevision: 4, printAnyway: true }),
    );
  });

  it("Print anyway after Mark served sends the revision Mark served moved the table to", async () => {
    const endMeal = vi.fn().mockRejectedValueOnce(unservedRefusal).mockResolvedValue(ended);
    const { el } = await openBill({ endMeal });
    await printBill(el);

    warning(el)!.querySelector<HTMLElement>("[data-mark-served]")!.click();
    await flush(el, 6);
    expect(text(warning(el))).toContain("Ribeye");
    expect(text(warning(el))).not.toContain("Paella");
    warning(el)!.querySelector<HTMLElement>("[data-print-anyway]")!.click();
    await flush(el, 6);

    expect(sentBodies(endMeal)[1]).toEqual(
      expect.objectContaining({ expectedPartyRevision: 4, printAnyway: true }),
    );
  });

  it("when the table changed elsewhere before Print anyway, takes the list down, says the table changed, and the next press asks again without printing anyway", async () => {
    let moved = false;
    const endMeal = vi
      .fn()
      .mockRejectedValueOnce(unservedRefusal)
      .mockRejectedValueOnce({ code: "party.out_of_date", partyId: "v1", revision: 5 })
      .mockRejectedValue(unservedRefusal);
    const { el } = await openBill({
      endMeal,
      getTablesState: vi.fn(async () => [heldTable(moved ? { revision: 5 } : {})]),
    });
    await printBill(el);
    moved = true;

    warning(el)!.querySelector<HTMLElement>("[data-print-anyway]")!.click();
    await flush(el, 6);

    expect(sentBodies(endMeal)[1]).toEqual(
      expect.objectContaining({ expectedPartyRevision: 3, printAnyway: true }),
    );
    expect(warning(el)).toBeNull();
    expect(banner(el)!.textContent).toContain(t("party.changed").replace("{table}", "4"));

    await printBill(el);
    expect(sentBodies(endMeal)[2]!.printAnyway).toBeUndefined();
    expect(sentBodies(endMeal)[2]!.expectedPartyRevision).toBe(5);
    expect(warning(el)).not.toBeNull();
  });

  it("does not bring back a list answered after the table was left and opened again", async () => {
    let refuse: (reason: unknown) => void = () => {};
    const { el, endMeal } = await openBill({
      endMeal: () =>
        new Promise<EndedMeal>((_resolve, reject) => {
          refuse = reject;
        }),
    });
    await printBill(el);
    expect(endMeal).toHaveBeenCalledOnce();

    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
    expect(tableOrder(el).orderId).toBe("wo-4");
    refuse(unservedRefusal);
    await flush(el, 6);

    expect(warning(el)).toBeNull();
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
    expect(text(printedNotice(el))).toBe(t("bill.issued"));
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
    expect(text(printedNotice(el))).toBe(t("bill.issued"));

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
    expect(text(printedNotice(el))).toBe(t("bill.issued"));
  });
});

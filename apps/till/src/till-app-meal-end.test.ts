import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { clockUnusableText, overLimitText, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { EndedMeal, PartyBill, TabLine, TillApi } from "./api/client.js";
import type { CapabilityFlag } from "./layout.js";
import { TABLE_REQUEST_LIMIT_MS } from "./state/draft-sync.js";
import {
  bill120,
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

/** The till's request deadlines stop running by themselves; `expire` ends those set so far. */
function deadlinesByHand() {
  const set = globalThis.setTimeout;
  const pending: (() => void)[] = [];
  const timers = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    run: () => void,
    ms?: number,
    ...rest: unknown[]
  ) => {
    if (ms !== TABLE_REQUEST_LIMIT_MS) return set(run, ms, ...(rest as []));
    pending.push(run);
    return 0;
  }) as typeof setTimeout);
  onTestFinished(() => timers.mockRestore());
  return { expire: () => pending.splice(0).forEach((run) => run()) };
}

/** A send that waits, with no answer, until its deadline cuts it off, as `fetch` does. */
const unansweredUntilDeadline = (_party: unknown, _request: unknown, options: unknown) =>
  new Promise<EndedMeal>((_resolve, reject) => {
    const { signal } = options as { signal: AbortSignal };
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });

/** A promise the test settles by hand, for an answer held back. */
function heldAnswer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const twoBills = () =>
  vi.fn(async () => [billOf(), billOf({ workingOrderId: "wo-9", billNumber: 2 })]);

/** Finish table is refused for the bill still owing, and its Print the bill is pressed. */
async function pressPrintFromFinishRefusal(el: TillApp): Promise<void> {
  emit(tableOrder(el), "finish-table", {});
  await flush(el);
  shadow(el).querySelector<HTMLElement>("[data-finish-refusal] [data-print-bill]")!.click();
  await flush(el, 6);
}

/** The first read of bill `wo-9`'s lines is held back; every other read answers at once. */
function holdingFirstBillTwoRead() {
  const read = heldAnswer<{ lines: TabLine[]; revision: number }>();
  let holding = true;
  const getTabLines = vi.fn((billId: string) => {
    if (billId === "wo-9" && holding) {
      holding = false;
      return read.promise;
    }
    return Promise.resolve({ lines: bill120, revision: 0 });
  });
  return { getTabLines, release: () => read.resolve({ lines: bill120, revision: 0 }) };
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

  it("says a bill whose only send used up the whole deadline may have been printed, and reads the bills again", async () => {
    const { el, endMeal } = await openBill({ endMeal: unansweredUntilDeadline });
    const deadlines = deadlinesByHand();
    await printBill(el);
    expect(endMeal).toHaveBeenCalledOnce();
    const billReads = vi.mocked(api.getPartyBills).mock.calls.length;

    deadlines.expire();
    await flush(el, 6);

    expect(endMeal).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toContain(t("meal_end.unconfirmed"));
    expect(banner(el)!.textContent).not.toContain(t("table.error"));
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
    expect(printedNotice(el)).toBeNull();
  });

  it("does not claim Bill issued when no send was answered and the bill now has an invoice number", async () => {
    const endMeal = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { el } = await openBill({
      endMeal,
      getPartyBills: vi.fn(async () => [endMeal.mock.calls.length < 3 ? billOf() : printedBill]),
    });

    await printBill(el);
    await expect
      .poll(() => banner(el)?.textContent ?? "", { timeout: GIVE_UP_MS })
      .toContain(t("meal_end.unconfirmed"));

    expect(endMeal).toHaveBeenCalledTimes(3);
    expect(tableOrder(el).bills[0]!.invoiceNumber).toBe("F-0042");
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

  it.each([
    "fiscal.record_invalid",
    "fiscal.foreign_recipient_unsupported",
    "sale.number_reused",
    "management.request_invalid",
    "some.refusal_the_till_has_no_words_for",
  ])("says %s printed nothing and issued no ticket, sending nobody elsewhere", async (code) => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({ code, status: 409 }),
    });

    await printBill(el);

    const said = banner(el)!.textContent!;
    expect(said).toContain(t("meal_end.refused"));
    expect(said).not.toContain(t("place.refused"));
    expect(said).not.toContain(t("table.error"));
  });

  it.each([
    ["an error carrying no code", new Error("unexpected")],
    ["a server failure", { code: "server.internal", status: 500 }],
    ["a gateway's answer with no Waitron error in it", { code: "server.internal", status: 502 }],
  ])(
    "says the bill may have been printed after %s, and reads the bills again",
    async (_case, error) => {
      const { el } = await openBill({ endMeal: vi.fn().mockRejectedValue(error) });
      const billReads = vi.mocked(api.getPartyBills).mock.calls.length;

      await printBill(el);

      const said = banner(el)!.textContent!;
      expect(said).toContain(t("meal_end.unconfirmed"));
      expect(said).not.toContain(t("meal_end.refused"));
      expect(said).not.toContain(t("table.error"));
      expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
    },
  );

  it("does not say no ticket was issued when a resend is refused after an earlier send got no answer", async () => {
    const endMeal = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue({ code: "session.person_not_signed_in", status: 401 });
    const { el } = await openBill({ endMeal });

    await printBill(el);
    await expect
      .poll(() => banner(el)?.textContent ?? "", { timeout: GIVE_UP_MS })
      .toContain(t("meal_end.unconfirmed"));

    expect(endMeal).toHaveBeenCalledTimes(2);
    expect(banner(el)!.textContent).not.toContain(t("meal_end.refused"));
  });

  it.each([
    ["Marta", "Marta has taken over this order, so the bill was not printed."],
    [null, "Someone else has taken over this order, so the bill was not printed."],
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

describe("till-app: one bill's print waiting for its answer", () => {
  const control = (el: TillApp, selector: string) =>
    shadow(el).querySelector<HTMLElement & { disabled: boolean }>(selector)!;

  const tablet = "tablet-landscape" as const;
  it.each([
    ["till", {}],
    [
      "tablet",
      {
        getTill: vi.fn().mockResolvedValue({
          ...till,
          formFactor: tablet,
          capabilities: ["print-receipt", "take-cash", "hand-over-orders"],
        }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "till-dev", name: "Till 1", formFactor: tablet }),
      },
    ],
  ])(
    "leaves Pay open on another bill on a %s, with Print the bill unavailable there, and keeps the printing bill busy",
    async (_device, device) => {
      const answer = heldAnswer<EndedMeal>();
      const { el, endMeal } = await openBill({
        ...device,
        endMeal: () => answer.promise,
        finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
        getPartyBills: twoBills(),
      });
      await printBill(el);
      expect(tableOrder(el).busy).toBe(true);
      expect(control(el, "[data-pay-sheet]").disabled).toBe(true);

      emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-9" });
      await flush(el, 6);

      expect(tableOrder(el).orderId).toBe("wo-9");
      expect(tableOrder(el).busy).toBe(false);
      expect(control(el, "[data-pay-sheet]").disabled).toBe(false);
      expect(control(el, '[data-table-menu] [data-action="print-bill"]').disabled).toBe(true);
      emit(tableOrder(el), "finish-table", {});
      await flush(el);
      expect(control(el, "[data-finish-refusal] [data-print-bill]").disabled).toBe(true);

      emit(tableOrder(el), "end-meal", { workingOrderId: "wo-9" });
      await flush(el, 6);
      expect(endMeal).toHaveBeenCalledOnce();

      emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-4" });
      await flush(el, 6);
      expect(tableOrder(el).busy).toBe(true);

      answer.resolve(ended);
      await flush(el, 6);
      expect(tableOrder(el).busy).toBe(false);
      expect(tableOrder(el).billPrintPending).toBe(false);
    },
  );
});

describe("till-app: a print's answer arriving after staff moved on", () => {
  async function pressThenSwitchToBillTwo(overrides: Record<string, unknown>) {
    const opened = await openBill({ getPartyBills: twoBills(), ...overrides });
    await printBill(opened.el);
    emit(tableOrder(opened.el), "switch-bill", { workingOrderId: "wo-9" });
    await flush(opened.el, 6);
    expect(tableOrder(opened.el).orderId).toBe("wo-9");
    return { ...opened, billReads: vi.mocked(api.getPartyBills).mock.calls.length };
  }

  async function pressThenReopen(overrides: Record<string, unknown>) {
    const opened = await openBill(overrides);
    await printBill(opened.el);
    emit(shell(opened.el), "screen-select", { screen: "floor" });
    await flush(opened.el);
    emit(floor(opened.el), "open-table", { tableId: "t4", seated: true });
    await flush(opened.el, 6);
    expect(tableOrder(opened.el).orderId).toBe("wo-4");
    return { ...opened, billReads: vi.mocked(api.getPartyBills).mock.calls.length };
  }

  it("shows a refusal of the first bill under neither bill once staff are on the second, and reads the bills again", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el, billReads } = await pressThenSwitchToBillTwo({ endMeal: () => answer.promise });

    answer.reject({ code: "meal_end.no_printer", status: 409, workingOrderId: "wo-4" });
    await flush(el, 6);

    expect(banner(el)).toBeNull();
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
  });

  it("shows no refusal once the table was left and opened again", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el, billReads } = await pressThenReopen({ endMeal: () => answer.promise });

    answer.reject({ code: "meal_end.no_printer", status: 409, workingOrderId: "wo-4" });
    await flush(el, 6);

    expect(banner(el)).toBeNull();
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
  });

  it("shows a print with no answer under neither bill once staff are on the second, and reads the bills again", async () => {
    const deadlines = deadlinesByHand();
    const { el, billReads } = await pressThenSwitchToBillTwo({
      endMeal: unansweredUntilDeadline,
    });

    deadlines.expire();
    await flush(el, 6);

    expect(banner(el)).toBeNull();
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
  });

  it("reloads a table that changed elsewhere without saying so under the second bill", async () => {
    let moved = false;
    const answer = heldAnswer<EndedMeal>();
    const { el } = await pressThenSwitchToBillTwo({
      endMeal: () => answer.promise,
      getTablesState: vi.fn(async () => [heldTable(moved ? { revision: 5 } : {})]),
    });
    moved = true;

    answer.reject({ code: "party.out_of_date", partyId: "v1", revision: 5 });
    await flush(el, 6);

    expect(tableOrder(el).party!.revision).toBe(5);
    expect(banner(el)).toBeNull();
  });

  it("does not say the table closed under the second bill", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el } = await pressThenSwitchToBillTwo({ endMeal: () => answer.promise });

    answer.reject({ code: "party.not_open", status: 409, partyId: "v1" });
    await flush(el, 6);

    expect(banner(el)).toBeNull();
  });
});

describe("till-app: unsent orders after a refused print", () => {
  /** The server's record of who is editing bill `wo-4`, at a version the test moves. */
  function billEdits() {
    const edits = { version: 0 };
    const listDrafts = vi.fn(async () => ({
      drafts: [],
      billEdits: ["wo-4", "wo-9"].map((billId) => ({
        billId,
        editorId: null,
        editorName: null,
        editorVersion: billId === "wo-4" ? edits.version : 0,
        draftId: null,
        draftRevision: null,
      })),
    }));
    return { edits, listDrafts };
  }
  const sentVersion = (body: Record<string, unknown> | undefined) =>
    (body!.expectedEdits as { billId: string; editorVersion: number }[]).find(
      (edit) => edit.billId === "wo-4",
    )!.editorVersion;

  it.each(["draft.out_of_date", "draft.taken_over"])(
    "reads them again after %s, so the next press sends what they are now",
    async (code) => {
      const { edits, listDrafts } = billEdits();
      const endMeal = vi
        .fn()
        .mockRejectedValueOnce({ code, status: 409, billId: "wo-4" })
        .mockResolvedValue(ended);
      const { el } = await openBill({ endMeal, listDrafts });
      const reads = listDrafts.mock.calls.length;
      edits.version = 1;

      await printBill(el);
      expect(listDrafts.mock.calls.length).toBeGreaterThan(reads);

      await printBill(el);
      expect(sentBodies(endMeal).map(sentVersion)).toEqual([0, 1]);
    },
  );

  it("does not read them for a refusal arriving after staff moved to another bill", async () => {
    const { listDrafts } = billEdits();
    const answer = heldAnswer<EndedMeal>();
    const { el } = await openBill({
      endMeal: () => answer.promise,
      getPartyBills: twoBills(),
      listDrafts,
    });
    await printBill(el);
    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-9" });
    await flush(el, 6);
    const reads = listDrafts.mock.calls.length;

    answer.reject({ code: "draft.out_of_date", status: 409, billId: "wo-4" });
    await flush(el, 6);

    expect(listDrafts.mock.calls.length).toBe(reads);
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
  it("sends nothing when the table was left, reopened and moved on while the pressed bill was read", async () => {
    let revision = 3;
    const { getTabLines, release } = holdingFirstBillTwoRead();
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: twoBills(),
      getTabLines,
      getTablesState: vi.fn(async () => [heldTable({ revision })]),
    });
    await pressPrintFromFinishRefusal(el);
    expect(tableOrder(el).orderId).toBe("wo-9");

    revision = 4;
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el, 6);
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-9" });
    await flush(el, 6);
    expect(tableOrder(el).orderId).toBe("wo-9");
    expect(tableOrder(el).party!.revision).toBe(4);

    release();
    await flush(el, 6);

    expect(endMeal).not.toHaveBeenCalled();
    expect(tableOrder(el).orderId).toBe("wo-9");
  });

  it("sends nothing when the table was left and reopened at the same revision while the pressed bill was read", async () => {
    const { getTabLines, release } = holdingFirstBillTwoRead();
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: twoBills(),
      getTabLines,
    });
    await pressPrintFromFinishRefusal(el);

    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el, 6);
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-9" });
    await flush(el, 6);
    expect(tableOrder(el).party!.revision).toBe(3);

    release();
    await flush(el, 6);

    expect(endMeal).not.toHaveBeenCalled();
  });

  it("sends nothing when another party takes the table while the pressed bill is read", async () => {
    let party = "v1";
    const { getTabLines, release } = holdingFirstBillTwoRead();
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: twoBills(),
      getTabLines,
      getTablesState: vi.fn(async () => [heldTable({ id: party })]),
      markServed: vi.fn().mockRejectedValue({ code: "party.out_of_date", partyId: "v1" }),
    });
    await pressPrintFromFinishRefusal(el);
    party = "v2";
    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);
    expect(tableOrder(el).party!.id).toBe("v2");
    expect(tableOrder(el).party!.revision).toBe(3);

    release();
    await flush(el, 6);

    expect(endMeal).not.toHaveBeenCalled();
  });

  it("sends nothing to a server the till was pointed at while the pressed bill was read", async () => {
    const { getTabLines, release } = holdingFirstBillTwoRead();
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: twoBills(),
      getTabLines,
    });
    await pressPrintFromFinishRefusal(el);
    const elsewhere = vi.fn(async () => ended);
    el.api = { ...api, endMeal: elsewhere } as unknown as TillApi;
    await flush(el);

    release();
    await flush(el, 6);

    expect(endMeal).not.toHaveBeenCalled();
    expect(elsewhere).not.toHaveBeenCalled();
  });

  it("sends nothing after the person signed out and back in while the pressed bill was read", async () => {
    const { getTabLines, release } = holdingFirstBillTwoRead();
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: twoBills(),
      getTabLines,
    });
    await pressPrintFromFinishRefusal(el);

    emit(shell(el), "logout");
    await flush(el, 6);
    await openTable(el, ["payment.take"]);
    await flush(el, 6);
    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-9" });
    await flush(el, 6);

    release();
    await flush(el, 6);

    expect(endMeal).not.toHaveBeenCalled();
  });

  it("sends nothing when the table's revision moves while the pressed bill is read, and the next press prints", async () => {
    const { getTabLines, release } = holdingFirstBillTwoRead();
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: twoBills(),
      getTabLines,
    });
    await pressPrintFromFinishRefusal(el);
    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);
    expect(tableOrder(el).party!.revision).toBe(4);

    release();
    await flush(el, 6);

    expect(endMeal).not.toHaveBeenCalled();
    expect(tableOrder(el).orderId).toBe("wo-9");

    emit(tableOrder(el), "end-meal", { workingOrderId: "wo-9" });
    await flush(el, 6);
    expect(endMeal).toHaveBeenCalledOnce();
    expect(sentBodies(endMeal)[0]).toEqual(
      expect.objectContaining({ billId: "wo-9", expectedPartyRevision: 4 }),
    );
  });

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

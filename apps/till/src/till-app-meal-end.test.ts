import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { TillApp } from "./till-app.js";
import { clockUnusableText, overLimitText, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { TillApi } from "./api/client.js";
import type { EndedMeal, EndMealRequest, PartyBill, TabLine } from "./api/client.js";
import type { CapabilityFlag } from "./layout.js";
import { TABLE_REQUEST_LIMIT_MS } from "./state/draft-sync.js";
import {
  bill120,
  billOf,
  emit,
  floor,
  flush,
  heldTable,
  openDialog,
  openTable,
  press,
  resetBillPayDrafts,
  shell,
  stubApi,
  tableOrder,
  text,
  till,
  type,
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

  it.each(["fiscal.record_invalid", "fiscal.foreign_recipient_unsupported", "sale.number_reused"])(
    "says %s cannot be filed, that nothing was issued and that trying again will not help",
    async (code) => {
      const { el } = await openBill({
        endMeal: vi.fn().mockRejectedValue({ code, status: 409 }),
      });

      await printBill(el);

      const said = banner(el)!.textContent!;
      expect(said).toContain(t("meal_end.cannot_file"));
      expect(said).not.toContain(t("meal_end.refused"));
      expect(said).not.toContain(t("place.refused"));
    },
  );

  it("words a bill that cannot be filed exactly, in English and Spanish", () => {
    expect(t("meal_end.cannot_file")).toBe(
      "This bill's ticket cannot be filed with the tax agency as it stands, so no ticket was issued and nothing was printed. Trying again will not help.",
    );
    setLocale("es");
    expect(t("meal_end.cannot_file")).toBe(
      "El ticket de esta cuenta no se puede registrar en Hacienda tal como está, así que no se ha emitido ningún ticket y no se ha impreso nada. Reintentar no servirá de nada.",
    );
  });

  it.each(["management.request_invalid", "some.refusal_the_till_has_no_words_for"])(
    "says %s printed nothing and issued no ticket, sending nobody elsewhere",
    async (code) => {
      const { el } = await openBill({
        endMeal: vi.fn().mockRejectedValue({ code, status: 409 }),
      });

      await printBill(el);

      const said = banner(el)!.textContent!;
      expect(said).toContain(t("meal_end.refused"));
      expect(said).not.toContain(t("place.refused"));
      expect(said).not.toContain(t("table.error"));
    },
  );

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

describe("till-app: a refusal after a send that got no answer", () => {
  /** The till's list of refusals the server gives before it looks for the earlier send. */
  const beforeTheLookup = [
    "handover.stepping_down",
    "till.origin_refused",
    "node.read_only",
    "server.waiting_for_clock",
    "storage.disk_full",
    "management.request_invalid",
    "venue.time_zone_not_ready",
    "session.required",
    "session.not_open",
    "session.person_not_signed_in",
    "device.unauthorized",
    "device.forbidden_action",
    "device_profile.not_admitted",
    "authorization.not_permitted",
    "service_zone.not_allowed",
  ];
  const refusal = (code: string, more: Record<string, unknown> = {}) => ({
    code,
    status: 409,
    ...more,
  });
  const expectWarned = (el: TillApp) => {
    const said = banner(el)!.textContent!;
    expect(said).toContain(t("meal_end.unconfirmed"));
    expect(said).not.toContain(t("meal_end.refused"));
  };

  /** A first press whose only send runs out of time, then whatever `next` answers. */
  async function pressLeftUnanswered(next: unknown, overrides: Record<string, unknown> = {}) {
    const deadlines = deadlinesByHand();
    const endMeal = vi.fn();
    endMeal.mockImplementationOnce(unansweredUntilDeadline);
    if (next instanceof Function) endMeal.mockImplementation(next as () => Promise<unknown>);
    else endMeal.mockRejectedValue(next);
    const opened = await openBill({ endMeal, ...overrides });
    await printBill(opened.el);
    deadlines.expire();
    await flush(opened.el, 6);
    expectWarned(opened.el);
    return { ...opened, deadlines };
  }

  it.each(beforeTheLookup)(
    "does not treat %s as final when a resend of the same press meets it",
    async (code) => {
      const endMeal = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockRejectedValue(refusal(code));
      const { el } = await openBill({ endMeal });

      await printBill(el);
      await expect
        .poll(() => banner(el)?.textContent ?? "", { timeout: GIVE_UP_MS })
        .toContain(t("meal_end.unconfirmed"));

      expect(endMeal).toHaveBeenCalledTimes(2);
      expectWarned(el);
    },
  );

  const submissionIds = (endMeal: ReturnType<typeof vi.fn>) =>
    sentBodies(endMeal).map((body) => body.submissionId);

  /** The person on the till signs out and `personId` signs in and opens the table again. */
  async function signInAs(el: TillApp, personId: string) {
    emit(shell(el), "logout");
    await flush(el, 6);
    await openTable(el, ["payment.take"], personId);
    await flush(el, 6);
  }

  it.each([...beforeTheLookup, "some.unknown_refusal"])(
    "does not treat %s as final on a later press, and keeps the press's id for the next one",
    async (code) => {
      const { el, endMeal } = await pressLeftUnanswered(refusal(code));

      await printBill(el);
      expectWarned(el);
      await printBill(el);

      expect(endMeal).toHaveBeenCalledTimes(3);
      expect(new Set(submissionIds(endMeal)).size).toBe(1);
      expectWarned(el);
    },
  );

  it("sends a lost press again under its id, and says Bill issued when the server replays its answer", async () => {
    const { el, endMeal } = await pressLeftUnanswered(async () => ended);

    await printBill(el);

    expect(endMeal).toHaveBeenCalledTimes(2);
    expect(new Set(submissionIds(endMeal)).size).toBe(1);
    expect(text(printedNotice(el))).toBe(t("bill.issued"));
    expect(banner(el)).toBeNull();
  });

  it("keeps the id and sends the table's newer revision when a lost press is pressed again", async () => {
    const { el, endMeal } = await pressLeftUnanswered(async () => ended);
    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);
    expect(tableOrder(el).party!.revision).toBe(4);

    await printBill(el);

    const [first, second] = sentBodies(endMeal);
    expect(second!.submissionId).toBe(first!.submissionId);
    expect(first!.expectedPartyRevision).toBe(3);
    expect(second!.expectedPartyRevision).toBe(4);
  });

  it("uses a new id for another person, and the bill stays uncertain", async () => {
    const { el, endMeal } = await pressLeftUnanswered(refusal("fiscal.record_invalid"));
    await signInAs(el, "p2");

    await printBill(el);

    const [first, second] = submissionIds(endMeal);
    expect(second).not.toBe(first);
    expectWarned(el);
    expect(banner(el)!.textContent).not.toContain(t("meal_end.cannot_file"));
  });

  it("resends under the same id when the same person signs back in", async () => {
    const { el, endMeal } = await pressLeftUnanswered(async () => ended);
    await signInAs(el, "p1");

    await printBill(el);

    expect(new Set(submissionIds(endMeal)).size).toBe(1);
    expect(text(printedNotice(el))).toBe(t("bill.issued"));
  });

  it("uses a new id for Print anyway after a lost ordinary press", async () => {
    const { el, endMeal } = await pressLeftUnanswered(unservedRefusal);
    await printBill(el);
    expect(warning(el)).not.toBeNull();

    warning(el)!.querySelector<HTMLElement>("[data-print-anyway]")!.click();
    await flush(el, 6);

    const [first, second, third] = sentBodies(endMeal);
    expect(second!.submissionId).toBe(first!.submissionId);
    expect(third!.printAnyway).toBe(true);
    expect(third!.submissionId).not.toBe(first!.submissionId);
  });

  /** An ordinary press lists the dishes, and its Print anyway gets no answer. */
  async function printAnywayLeftUnanswered(
    next: (body: EndMealRequest, options: unknown) => Promise<unknown>,
  ) {
    const deadlines = deadlinesByHand();
    const endMeal = vi.fn();
    endMeal.mockRejectedValueOnce(unservedRefusal);
    endMeal.mockImplementationOnce(unansweredUntilDeadline);
    endMeal.mockImplementation((_party: unknown, body: EndMealRequest, options: unknown) =>
      next(body, options),
    );
    const opened = await openBill({ endMeal });
    await printBill(opened.el);
    warning(opened.el)!.querySelector<HTMLElement>("[data-print-anyway]")!.click();
    await flush(opened.el, 6);
    deadlines.expire();
    await flush(opened.el, 6);
    expectWarned(opened.el);
    return { ...opened, deadlines };
  }

  it("uses a new id for an ordinary press after a lost Print anyway, and resends Print anyway under its own", async () => {
    const { el, endMeal } = await printAnywayLeftUnanswered((body) =>
      body.printAnyway === true ? Promise.resolve(ended) : Promise.reject(unservedRefusal),
    );

    await printBill(el);
    warning(el)!.querySelector<HTMLElement>("[data-print-anyway]")!.click();
    await flush(el, 6);

    const [, lost, ordinary, again] = sentBodies(endMeal);
    expect(ordinary!.printAnyway).toBeUndefined();
    expect(ordinary!.submissionId).not.toBe(lost!.submissionId);
    expect(again!.printAnyway).toBe(true);
    expect(again!.submissionId).toBe(lost!.submissionId);
    expect(text(printedNotice(el))).toBe(t("bill.issued"));
  });

  it("stays uncertain when one of two lost sends is proved never recorded", async () => {
    let answer = (options: unknown): Promise<unknown> =>
      unansweredUntilDeadline(undefined, undefined, options);
    const { el, endMeal, deadlines } = await printAnywayLeftUnanswered((_body, options) =>
      answer(options),
    );
    await printBill(el);
    deadlines.expire();
    await flush(el, 6);
    expectWarned(el);
    const ordinaryId = sentBodies(endMeal).at(-1)!.submissionId;

    answer = () => Promise.reject(refusal("meal_end.no_printer"));
    await printBill(el);
    expect(sentBodies(endMeal).at(-1)!.submissionId).toBe(ordinaryId);
    expect(banner(el)!.textContent).toContain(codeMessage("meal_end.no_printer"));

    answer = () => Promise.reject(refusal("fiscal.record_invalid"));
    await printBill(el);
    expect(sentBodies(endMeal).at(-1)!.submissionId).not.toBe(ordinaryId);
    expectWarned(el);
  });

  it("shows a refusal raised after the lookup in its own words, and the next press has a new id", async () => {
    const { el, endMeal } = await pressLeftUnanswered(refusal("meal_end.no_printer"));

    await printBill(el);

    expect(banner(el)!.textContent).toContain(codeMessage("meal_end.no_printer"));
    expect(banner(el)!.textContent).not.toContain(t("meal_end.unconfirmed"));
    await printBill(el);
    const [first, second, third] = submissionIds(endMeal);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  it.each([
    ["fiscal.record_invalid", "meal_end.cannot_file"],
    ["fiscal.foreign_recipient_unsupported", "meal_end.cannot_file"],
  ] as const)("says %s in its own words for a resent press", async (code, words) => {
    const { el } = await pressLeftUnanswered(refusal(code));

    await printBill(el);

    expect(banner(el)!.textContent).toContain(t(words));
    expect(banner(el)!.textContent).not.toContain(t("meal_end.unconfirmed"));
  });

  it("names who took the order over when a resent press meets that refusal", async () => {
    const { el } = await pressLeftUnanswered(refusal("draft.taken_over", { ownerName: "Marta" }));

    await printBill(el);

    expect(banner(el)!.textContent).toContain("Marta");
    expect(banner(el)!.textContent).not.toContain(t("meal_end.unconfirmed"));
  });

  it("does not say another person's takeover stopped a press with a new id on an uncertain bill", async () => {
    const { el } = await pressLeftUnanswered(refusal("draft.taken_over", { ownerName: "Marta" }));
    await signInAs(el, "p2");

    await printBill(el);

    expectWarned(el);
    expect(banner(el)!.textContent).not.toContain("Marta");
  });

  it.each(["some.unknown_refusal", "fiscal.record_invalid", "sale.number_reused"])(
    "warns when %s meets a press with a new id on an uncertain bill",
    async (code) => {
      const { el } = await pressLeftUnanswered(refusal(code));
      await signInAs(el, "p2");

      await printBill(el);

      expectWarned(el);
      expect(banner(el)!.textContent).not.toContain(t("meal_end.cannot_file"));
    },
  );

  it("forgets the id after meal_end.already_issued", async () => {
    const { el, endMeal } = await pressLeftUnanswered(refusal("meal_end.already_issued"));

    await printBill(el);
    expect(banner(el)!.textContent).toContain(codeMessage("meal_end.already_issued"));
    await printBill(el);

    const [first, second, third] = submissionIds(endMeal);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  it("warns on submission.id_reused, then uses a new id, and the bill stays uncertain", async () => {
    let answer: unknown = refusal("submission.id_reused", { submissionId: "taken" });
    const { el, endMeal } = await pressLeftUnanswered(() => Promise.reject(answer));

    await printBill(el);
    expectWarned(el);
    expect(banner(el)!.textContent).not.toContain(codeMessage("submission.id_reused"));

    answer = refusal("fiscal.record_invalid");
    await printBill(el);

    const [first, second, third] = submissionIds(endMeal);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
    expectWarned(el);
  });

  it("forgets a send a resend of the same press proves was never recorded", async () => {
    const endMeal = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValue(refusal("meal_end.no_printer"));
    const { el } = await openBill({ endMeal });

    await printBill(el);
    await expect
      .poll(() => banner(el)?.textContent ?? "", { timeout: GIVE_UP_MS })
      .toContain(codeMessage("meal_end.no_printer"));
    await printBill(el);

    const [first, second, third] = submissionIds(endMeal);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  it("says the table changed when a resent press is refused for it, and forgets the id", async () => {
    let moved = false;
    const { el, endMeal } = await pressLeftUnanswered(
      refusal("party.out_of_date", { partyId: "v1", revision: 5 }),
      { getTablesState: vi.fn(async () => [heldTable(moved ? { revision: 5 } : {})]) },
    );
    moved = true;

    await printBill(el);

    expect(banner(el)!.textContent).toContain(t("party.try_again"));
    expect(banner(el)!.textContent).not.toContain(t("meal_end.unconfirmed"));
    await printBill(el);
    const [first, , third] = submissionIds(endMeal);
    expect(third).not.toBe(first);
  });

  it("keeps the warning up through and after the reload when a new-id press finds the table changed", async () => {
    const read = heldAnswer<ReturnType<typeof heldTable>[]>();
    let holding = false;
    const { el } = await pressLeftUnanswered(
      refusal("party.out_of_date", { partyId: "v1", revision: 5 }),
      {
        getTablesState: vi.fn(() => (holding ? read.promise : Promise.resolve([heldTable()]))),
      },
    );
    await signInAs(el, "p2");
    holding = true;

    await printBill(el);
    expectWarned(el);
    expect(tableOrder(el).party!.revision).toBe(3);

    read.resolve([heldTable({ revision: 5 })]);
    await flush(el, 6);

    expect(tableOrder(el).party!.revision).toBe(5);
    expectWarned(el);
    expect(banner(el)!.textContent).not.toContain(t("party.try_again"));
  });

  it.each([
    ["meal_end.no_printer", {}],
    ["meal_end.delivery_unavailable", {}],
    ["meal_end.already_issued", {}],
    ["bill.unsent_dishes", {}],
    ["bill.nothing_outstanding", {}],
    ["device.forbidden_action", { action: "receipt" }],
  ])("keeps %s's own words on a later press: the command itself said it", async (code, more) => {
    const { el } = await pressLeftUnanswered(refusal(code, more));

    await printBill(el);

    expect(banner(el)!.textContent).toContain(codeMessage(code));
    expect(banner(el)!.textContent).not.toContain(t("meal_end.unconfirmed"));
  });

  it.each([["a failed response with no Waitron error", { code: "server.internal", status: 502 }]])(
    "remembers %s as no answer",
    async (_case, first) => {
      const endMeal = vi
        .fn()
        .mockRejectedValueOnce(first)
        .mockRejectedValue(refusal("authorization.not_permitted"));
      const { el } = await openBill({ endMeal });
      await printBill(el);
      expectWarned(el);

      await printBill(el);

      expect(endMeal).toHaveBeenCalledTimes(2);
      expectWarned(el);
    },
  );

  it("remembers an empty answer as no answer", async () => {
    const endMeal = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(refusal("authorization.not_permitted"));
    const { el } = await openBill({ endMeal, getPartyBills: vi.fn(async () => [billOf()]) });
    await printBill(el);
    expectWarned(el);

    await printBill(el);

    expect(endMeal).toHaveBeenCalledTimes(2);
    expectWarned(el);
  });

  it("remembers it per bill: another bill's refusal keeps its own words", async () => {
    const { el, endMeal } = await pressLeftUnanswered(refusal("authorization.not_permitted"), {
      getPartyBills: twoBills(),
    });
    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-9" });
    await flush(el, 6);

    emit(tableOrder(el), "end-meal", { workingOrderId: "wo-9" });
    await flush(el, 6);

    expect(sentBodies(endMeal)[1]!.billId).toBe("wo-9");
    expect(banner(el)!.textContent).toContain(t("take_payment.not_permitted"));
    expect(banner(el)!.textContent).not.toContain(t("meal_end.unconfirmed"));
  });

  it.each([
    ["a confirmed answer", async () => ended],
    [
      "meal_end.already_issued",
      async () => {
        throw refusal("meal_end.already_issued");
      },
    ],
  ])("forgets it after %s", async (_case, second) => {
    let presses = 0;
    const { el } = await pressLeftUnanswered(
      () => (++presses === 1 ? second() : Promise.reject(refusal("authorization.not_permitted"))),
      { getPartyBills: vi.fn(async () => [billOf()]) },
    );
    await printBill(el);
    expect(banner(el)?.textContent ?? "").not.toContain(t("meal_end.unconfirmed"));

    await printBill(el);

    expect(banner(el)!.textContent).toContain(t("take_payment.not_permitted"));
    expect(banner(el)!.textContent).not.toContain(t("meal_end.unconfirmed"));
  });
});

describe("till-app: what counts as the server's answer to Print the bill", () => {
  it.each([
    ["an empty answer", undefined],
    ["an answer for another bill", { ...ended, workingOrderId: "wo-9" }],
    ["an answer with no invoice number", { ...ended, invoiceNumber: undefined }],
    ["an answer with an empty invoice number", { ...ended, invoiceNumber: "" }],
  ])("does not say Bill issued after %s, and warns instead", async (_case, answer) => {
    const { el } = await openBill({ endMeal: async () => answer });

    await printBill(el);

    expect(printedNotice(el)).toBeNull();
    expect(banner(el)!.textContent).toContain(t("meal_end.unconfirmed"));
  });

  const throughRealClient = (response: () => Response) => {
    const real = new TillApi("", vi.fn(async () => response()) as unknown as typeof fetch);
    return (partyId: unknown, request: unknown, options: unknown) =>
      real.endMeal(
        partyId as string,
        request as EndMealRequest,
        options as { signal: AbortSignal },
      );
  };

  it("does not say Bill issued when the real client gets an empty success", async () => {
    const { el } = await openBill({
      endMeal: throughRealClient(() => new Response(null, { status: 204 })),
    });

    await printBill(el);

    expect(printedNotice(el)).toBeNull();
    expect(banner(el)!.textContent).toContain(t("meal_end.unconfirmed"));
  });

  it("says Bill issued when the real client gets the server's answer", async () => {
    const { el } = await openBill({
      endMeal: throughRealClient(() => Response.json(ended)),
    });

    await printBill(el);

    expect(text(printedNotice(el))).toBe(t("bill.issued"));
    expect(banner(el)).toBeNull();
  });
});

describe("till-app: the bills read after a print's answer", () => {
  const printInMenu = (el: TillApp) =>
    shadow(el).querySelector<HTMLElement & { disabled: boolean }>(
      '[data-table-menu] [data-action="print-bill"]',
    )!;

  /** Bills reads answer at once until `hold` is called; the next one then waits for the test. */
  function billsReadHeldOnDemand(bills: () => PartyBill[] = () => [billOf()]) {
    const read = heldAnswer<PartyBill[]>();
    let holding = false;
    const getPartyBills = vi.fn(() => (holding ? read.promise : Promise.resolve(bills())));
    return { getPartyBills, read, hold: () => (holding = true) };
  }

  it("warns and frees the print controls while the read after an unanswered print is held", async () => {
    const deadlines = deadlinesByHand();
    const { getPartyBills, read, hold } = billsReadHeldOnDemand();
    const { el } = await openBill({ endMeal: unansweredUntilDeadline, getPartyBills });
    await printBill(el);
    expect(tableOrder(el).billPrintPending).toBe(true);
    hold();
    const reads = getPartyBills.mock.calls.length;

    deadlines.expire();
    await flush(el, 6);

    expect(getPartyBills.mock.calls.length).toBeGreaterThan(reads);
    expect(banner(el)!.textContent).toContain(t("meal_end.unconfirmed"));
    expect(tableOrder(el).billPrintPending).toBe(false);
    expect(tableOrder(el).busy).toBe(false);
    expect(printInMenu(el).disabled).toBe(false);

    read.resolve([billOf()]);
    await flush(el, 6);
    expect(banner(el)!.textContent).toContain(t("meal_end.unconfirmed"));
  });

  it("keeps the warning and the bills when that read fails", async () => {
    const deadlines = deadlinesByHand();
    const { getPartyBills, read, hold } = billsReadHeldOnDemand();
    const { el } = await openBill({ endMeal: unansweredUntilDeadline, getPartyBills });
    await printBill(el);
    hold();

    deadlines.expire();
    await flush(el, 6);
    read.reject(new TypeError("Failed to fetch"));
    await flush(el, 6);

    expect(banner(el)!.textContent).toContain(t("meal_end.unconfirmed"));
    expect(tableOrder(el).bills.map((bill) => bill.workingOrderId)).toEqual(["wo-4"]);
  });

  it("frees the print controls while the read after a refusal is held", async () => {
    const { getPartyBills, hold } = billsReadHeldOnDemand();
    const { el } = await openBill({
      endMeal: vi.fn(async () => {
        hold();
        throw { code: "meal_end.no_printer", status: 409 };
      }),
      getPartyBills,
    });

    await printBill(el);

    expect(banner(el)!.textContent).toContain(codeMessage("meal_end.no_printer"));
    expect(tableOrder(el).billPrintPending).toBe(false);
    expect(printInMenu(el).disabled).toBe(false);
  });

  it("does not leave the warning under the bill the screen moves to when that read finds the bill gone", async () => {
    const deadlines = deadlinesByHand();
    let gone = false;
    const { el } = await openBill({
      endMeal: unansweredUntilDeadline,
      getPartyBills: vi.fn(async () =>
        gone
          ? [billOf({ workingOrderId: "wo-9", billNumber: 2 })]
          : [billOf(), billOf({ workingOrderId: "wo-9", billNumber: 2 })],
      ),
    });
    await printBill(el);
    gone = true;

    deadlines.expire();
    await flush(el, 6);

    expect(tableOrder(el).orderId).toBe("wo-9");
    expect(banner(el)).toBeNull();
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

  async function showBill(el: TillApp, workingOrderId: string) {
    emit(tableOrder(el), "switch-bill", { workingOrderId });
    await flush(el, 6);
    expect(tableOrder(el).orderId).toBe(workingOrderId);
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

  it("keeps a refusal of the first bill off the second, reads the bills again, and shows it once back on the first", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el, billReads } = await pressThenSwitchToBillTwo({ endMeal: () => answer.promise });

    answer.reject({ code: "meal_end.no_printer", status: 409, workingOrderId: "wo-4" });
    await flush(el, 6);

    expect(banner(el)).toBeNull();
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);

    await showBill(el, "wo-4");
    expect(banner(el)!.textContent).toContain(codeMessage("meal_end.no_printer"));

    await showBill(el, "wo-9");
    expect(banner(el)).toBeNull();
    await showBill(el, "wo-4");
    expect(banner(el)).toBeNull();
  });

  it("shows no refusal once the table was left and opened again", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el, billReads } = await pressThenReopen({ endMeal: () => answer.promise });

    answer.reject({ code: "meal_end.no_printer", status: 409, workingOrderId: "wo-4" });
    await flush(el, 6);

    expect(banner(el)).toBeNull();
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);
  });

  it("keeps a print with no answer off the second bill, reads the bills again, and warns once back on the first", async () => {
    const deadlines = deadlinesByHand();
    const { el, billReads } = await pressThenSwitchToBillTwo({
      endMeal: unansweredUntilDeadline,
    });

    deadlines.expire();
    await flush(el, 6);

    expect(banner(el)).toBeNull();
    expect(vi.mocked(api.getPartyBills).mock.calls.length).toBeGreaterThan(billReads);

    await showBill(el, "wo-4");
    expect(banner(el)!.textContent).toContain(t("meal_end.unconfirmed"));
  });

  it("shows a kept answer under no third bill", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el } = await pressThenSwitchToBillTwo({
      endMeal: () => answer.promise,
      getPartyBills: vi.fn(async () => [
        billOf(),
        billOf({ workingOrderId: "wo-9", billNumber: 2 }),
        billOf({ workingOrderId: "wo-check", billNumber: 3 }),
      ]),
    });
    answer.reject({ code: "meal_end.no_printer", status: 409 });
    await flush(el, 6);

    await showBill(el, "wo-check");

    expect(banner(el)).toBeNull();
    await showBill(el, "wo-4");
    expect(banner(el)!.textContent).toContain(codeMessage("meal_end.no_printer"));
  });

  it("keeps the dishes not served for the first bill, and lists them once back on it", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el } = await pressThenSwitchToBillTwo({ endMeal: () => answer.promise });

    answer.reject(unservedRefusal);
    await flush(el, 6);
    expect(warning(el)).toBeNull();

    await showBill(el, "wo-4");
    expect(text(warning(el))).toContain("Paella");

    await showBill(el, "wo-9");
    await showBill(el, "wo-4");
    expect(warning(el)).toBeNull();
  });

  it("says the table changed once back on the first bill", async () => {
    let moved = false;
    const answer = heldAnswer<EndedMeal>();
    const { el } = await pressThenSwitchToBillTwo({
      endMeal: () => answer.promise,
      getTablesState: vi.fn(async () => [heldTable(moved ? { revision: 5 } : {})]),
    });
    moved = true;
    answer.reject({ code: "party.out_of_date", partyId: "v1", revision: 5 });
    await flush(el, 6);

    await showBill(el, "wo-4");

    expect(banner(el)!.textContent).toContain(t("party.try_again"));
  });

  it("carries a kept answer to no later visit", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el } = await openBill({ endMeal: () => answer.promise, getPartyBills: twoBills() });
    await showBill(el, "wo-9");
    emit(tableOrder(el), "end-meal", { workingOrderId: "wo-9" });
    await flush(el, 6);
    await showBill(el, "wo-4");
    answer.reject({ code: "meal_end.no_printer", status: 409 });
    await flush(el, 6);

    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    emit(floor(el), "open-table", { tableId: "t4", seated: true });
    await flush(el, 6);
    expect(tableOrder(el).orderId).toBe("wo-4");
    await showBill(el, "wo-9");

    expect(banner(el)).toBeNull();
  });

  it("leaves a Finish table refusal on the second bill when the first bill's print succeeds late", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el } = await pressThenSwitchToBillTwo({
      endMeal: () => answer.promise,
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
    });
    emit(tableOrder(el), "finish-table", {});
    await flush(el);
    expect(shadow(el).querySelector("[data-finish-refusal]")).not.toBeNull();

    answer.resolve(ended);
    await flush(el, 6);

    expect(shadow(el).querySelector("[data-finish-refusal]")).not.toBeNull();
    expect(printedNotice(el)).toBeNull();
  });

  it("takes a Finish table refusal down when the bill on screen is the one printed", async () => {
    const { el } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
    });
    emit(tableOrder(el), "finish-table", {});
    await flush(el);
    expect(shadow(el).querySelector("[data-finish-refusal]")).not.toBeNull();

    await printBill(el);

    expect(shadow(el).querySelector("[data-finish-refusal]")).toBeNull();
    expect(text(printedNotice(el))).toBe(t("bill.issued"));
  });

  const answersByBill = (first: Promise<EndedMeal>, second: () => Promise<EndedMeal>) =>
    vi.fn((_party: string, request: EndMealRequest) =>
      request.billId === "wo-4" ? first : second(),
    );
  const billTwoEnded = { ...ended, workingOrderId: "wo-9", invoiceNumber: "F-0043" };

  it("shows no Bill issued in a later visit when the answer arrives after the table was reopened", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el } = await pressThenReopen({ endMeal: () => answer.promise });

    answer.resolve(ended);
    await flush(el, 6);

    expect(printedNotice(el)).toBeNull();
  });

  it("keeps the first bill's waiting Bill issued when the second bill is printed, and shows each under its own bill", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el } = await pressThenSwitchToBillTwo({
      endMeal: answersByBill(answer.promise, async () => billTwoEnded),
    });
    answer.resolve(ended);
    await flush(el, 6);
    expect(printedNotice(el)).toBeNull();

    emit(tableOrder(el), "end-meal", { workingOrderId: "wo-9" });
    await flush(el, 6);
    expect(text(printedNotice(el))).toBe(t("bill.issued"));

    await showBill(el, "wo-4");
    expect(text(printedNotice(el))).toBe(t("bill.issued"));
  });

  it("shows a waiting Bill issued once: it is gone after staff leave the bill and come back", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el } = await pressThenSwitchToBillTwo({ endMeal: () => answer.promise });
    answer.resolve(ended);
    await flush(el, 6);

    await showBill(el, "wo-4");
    expect(printedNotice(el)).not.toBeNull();
    await showBill(el, "wo-9");
    expect(printedNotice(el)).toBeNull();
    await showBill(el, "wo-4");
    expect(printedNotice(el)).toBeNull();
  });

  it("leaves the not-served list on the second bill when the first bill's print succeeds late", async () => {
    const answer = heldAnswer<EndedMeal>();
    const list = heldAnswer<EndedMeal>();
    const { el } = await openBill({
      getPartyBills: twoBills(),
      endMeal: answersByBill(answer.promise, () => list.promise),
    });
    await showBill(el, "wo-9");
    emit(tableOrder(el), "end-meal", { workingOrderId: "wo-9" });
    await flush(el, 6);
    await showBill(el, "wo-4");
    list.reject({ ...unservedRefusal, workingOrderId: "wo-9" });
    await flush(el, 6);
    await printBill(el);
    await showBill(el, "wo-9");
    expect(text(warning(el))).toContain("Paella");

    answer.resolve(ended);
    await flush(el, 6);

    expect(text(warning(el))).toContain("Paella");
    expect(printedNotice(el)).toBeNull();
    await showBill(el, "wo-4");
    expect(warning(el)).toBeNull();
    expect(printedNotice(el)).not.toBeNull();
  });

  it("keeps a refusal waiting for the first bill while the second bill is printed", async () => {
    const answer = heldAnswer<EndedMeal>();
    const { el } = await pressThenSwitchToBillTwo({
      endMeal: answersByBill(answer.promise, async () => billTwoEnded),
    });
    answer.reject({ code: "meal_end.no_printer", status: 409 });
    await flush(el, 6);

    emit(tableOrder(el), "end-meal", { workingOrderId: "wo-9" });
    await flush(el, 6);
    expect(banner(el)).toBeNull();

    await showBill(el, "wo-4");
    expect(banner(el)!.textContent).toContain(codeMessage("meal_end.no_printer"));
  });

  it("keeps the warning off the bill the screen moves to while that bill's lines are still being read", async () => {
    const deadlines = deadlinesByHand();
    const { getTabLines, release } = holdingFirstBillTwoRead();
    let gone = false;
    const { el } = await openBill({
      endMeal: unansweredUntilDeadline,
      getTabLines,
      getPartyBills: vi.fn(async () =>
        gone
          ? [billOf({ workingOrderId: "wo-9", billNumber: 2 })]
          : [billOf(), billOf({ workingOrderId: "wo-9", billNumber: 2 })],
      ),
    });
    await printBill(el);
    gone = true;

    deadlines.expire();
    await flush(el, 6);

    expect(tableOrder(el).orderId).toBe("wo-9");
    expect(banner(el)).toBeNull();
    release();
    await flush(el, 6);
    expect(banner(el)).toBeNull();
  });

  it("shows an answer that arrived on the floor once staff come back to the bill, and not on the floor", async () => {
    const answer = heldAnswer<EndedMeal>();
    const tablet = "tablet-landscape" as const;
    const { el } = await openBill({
      endMeal: () => answer.promise,
      getTill: vi.fn().mockResolvedValue({
        ...till,
        formFactor: tablet,
        capabilities: ["print-receipt", "take-cash", "hand-over-orders"],
      }),
      getDeviceIdentity: vi
        .fn()
        .mockResolvedValue({ deviceId: "till-dev", name: "Till 1", formFactor: tablet }),
    });
    await printBill(el);
    emit(shell(el), "screen-select", { screen: "floor" });
    await flush(el, 6);

    answer.reject({ code: "meal_end.no_printer", status: 409 });
    await flush(el, 6);
    expect(banner(el)).toBeNull();

    emit(shell(el), "screen-select", { screen: "order" });
    await flush(el, 6);
    expect(banner(el)!.textContent).toContain(codeMessage("meal_end.no_printer"));
  });

  it("keeps a refusal up while staff carry on working on the bill", async () => {
    const { el } = await openBill({
      endMeal: vi.fn().mockRejectedValue({ code: "meal_end.no_printer", status: 409 }),
    });
    await printBill(el);

    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);

    expect(api.markServed).toHaveBeenCalledOnce();
    expect(banner(el)!.textContent).toContain(codeMessage("meal_end.no_printer"));
  });

  it("takes a bill's own earlier answer down at the next press of that bill", async () => {
    const answer = heldAnswer<EndedMeal>();
    const endMeal = vi
      .fn()
      .mockRejectedValueOnce({ code: "meal_end.no_printer", status: 409 })
      .mockReturnValue(answer.promise);
    const { el } = await openBill({ endMeal });
    await printBill(el);
    expect(banner(el)).not.toBeNull();

    await printBill(el);

    expect(endMeal).toHaveBeenCalledTimes(2);
    expect(banner(el)).toBeNull();
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

  const namingCustomer = billOf({
    invoiceType: "F1",
    recipient: { taxId: "B12345678", legalName: "Acme SL", address: "Calle 1", countryCode: "ES" },
  });
  const canServe: CapabilityFlag[] = ["print-receipt", "take-cash", "hand-over-orders"];
  const cannotServe: CapabilityFlag[] = ["print-receipt", "take-cash"];

  it.each([
    ["with Mark served", canServe, true],
    ["without Mark served", cannotServe, false],
  ])(
    "tells staff a full invoice naming a customer cannot be corrected later, %s, and still offers Print anyway",
    async (_case, capabilities, marksServed) => {
      const { el } = await openBill(
        {
          endMeal: vi.fn().mockRejectedValue(unservedRefusal),
          getPartyBills: vi.fn(async () => [namingCustomer]),
        },
        capabilities,
      );

      await printBill(el);

      const said = text(warning(el));
      expect(said).toContain(t("meal_end.unserved_full_invoice"));
      expect(said).not.toContain(codeMessage("meal_end.unserved_dishes"));
      expect(said).not.toContain(t("meal_end.unserved_no_mark"));
      expect(warning(el)!.querySelector("[data-print-anyway]")).not.toBeNull();
      expect(warning(el)!.querySelector("[data-mark-served]") !== null).toBe(marksServed);
    },
  );

  it.each([
    ["with Mark served", canServe, codeMessage("meal_end.unserved_dishes")],
    ["without Mark served", cannotServe, t("meal_end.unserved_no_mark")],
  ])(
    "keeps today's sentence for a simplified bill, %s, even when another bill names a customer",
    async (_case, capabilities, sentence) => {
      const { el } = await openBill(
        {
          endMeal: vi.fn().mockRejectedValue(unservedRefusal),
          getPartyBills: vi.fn(async () => [
            billOf(),
            { ...namingCustomer, workingOrderId: "wo-9", billNumber: 2 },
          ]),
        },
        capabilities,
      );

      await printBill(el);

      expect(text(warning(el))).toContain(sentence);
      expect(text(warning(el))).not.toContain(t("meal_end.unserved_full_invoice"));
    },
  );

  it("words the notice for a full invoice naming a customer exactly, in English and Spanish", () => {
    expect(t("meal_end.unserved_full_invoice")).toBe(
      "Some dishes on this bill are not marked served. This is a full invoice naming a customer, and the till cannot file a correction for it, so take off any dish that may not come before you print.",
    );
    setLocale("es");
    expect(t("meal_end.unserved_full_invoice")).toBe(
      "Algunos platos de esta cuenta no están marcados como servidos. Es una factura completa a nombre de un cliente y la caja no puede presentar una rectificación para ella, así que quita antes de imprimir los platos que puedan no llegar.",
    );
  });

  it("Cancel takes the list down and sends nothing; Print the bill then asks again without printing anyway", async () => {
    const endMeal = vi.fn().mockRejectedValue(unservedRefusal);
    const { el } = await openBill({ endMeal });
    await printBill(el);

    warning(el)!.querySelector<HTMLElement>("[data-meal-end-cancel]")!.click();
    await flush(el, 6);

    expect(warning(el)).toBeNull();
    expect(endMeal).toHaveBeenCalledOnce();

    emit(tableOrder(el), "end-meal", { workingOrderId: "wo-4", printAnyway: true });
    await flush(el, 6);
    expect(endMeal).toHaveBeenCalledOnce();

    await printBill(el);

    expect(endMeal).toHaveBeenCalledTimes(2);
    expect(sentBodies(endMeal)[1]!.printAnyway).toBeUndefined();
    expect(warning(el)).not.toBeNull();
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

describe("till-app: Print the bill on a device that may not print receipts", () => {
  const noReceipts: CapabilityFlag[] = ["take-cash", "hand-over-orders"];
  const tablet = "tablet-landscape" as const;
  const devices = [
    ["till", {}],
    [
      "tablet",
      {
        getTill: vi
          .fn()
          .mockResolvedValue({ ...till, formFactor: tablet, capabilities: noReceipts }),
        getDeviceIdentity: vi
          .fn()
          .mockResolvedValue({ deviceId: "till-dev", name: "Till 1", formFactor: tablet }),
      },
    ],
  ] as const;
  const printInMenu = (el: TillApp) =>
    shadow(el).querySelector('[data-table-menu] [data-action="print-bill"]');

  it.each(devices)(
    "offers no Print the bill for a bill that needs paper on a %s, and sends nothing if asked",
    async (_device, device) => {
      const { el, endMeal } = await openBill(device, noReceipts);

      expect(printInMenu(el)).toBeNull();
      await printBill(el);

      expect(endMeal).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["A4", { medium: "a4", pagePrinterId: "printer-1" }],
    ["email", { medium: "email", recipient: "guest@example.test" }],
  ] as const)("offers and prints a full invoice going to %s", async (_medium, invoiceDelivery) => {
    const { el, endMeal } = await openBill(
      {
        getPartyBills: vi.fn(async () => [billOf({ invoiceType: "F1", invoiceDelivery })]),
      },
      noReceipts,
    );

    expect(printInMenu(el)).not.toBeNull();
    await printBill(el);

    expect(endMeal).toHaveBeenCalledOnce();
  });

  it("offers and sends a paper bill while the till has not read its device identity, leaving the check to the server", async () => {
    const { el, endMeal } = await openBill(
      { getDeviceIdentity: vi.fn().mockRejectedValue(new Error("network")) },
      noReceipts,
    );

    expect(printInMenu(el)).not.toBeNull();
    await printBill(el);

    expect(endMeal).toHaveBeenCalledOnce();
  });
});

describe("till-app: Print the bill while a part payment on the bill is held", () => {
  it("offers no Print the bill, and sends nothing if asked", async () => {
    const { el, endMeal } = await openBill({
      takeBillPayment: vi.fn(() => new Promise(() => {})),
    });
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(tableOrder(el).billPaymentHeld).toBe(true);

    expect(shadow(el).querySelector('[data-table-menu] [data-action="print-bill"]')).toBeNull();
    await printBill(el);

    expect(endMeal).not.toHaveBeenCalled();
  });
});

describe("till-app: a print left unanswered when its person signs out", () => {
  const printInMenu = (el: TillApp) =>
    shadow(el).querySelector<HTMLElement & { disabled: boolean }>(
      '[data-table-menu] [data-action="print-bill"]',
    )!;

  /** The first person presses Print the bill, gets no answer and signs out; the next opens the table. */
  async function pressThenNextPerson(overrides: Record<string, unknown>) {
    const opened = await openBill(overrides);
    await printBill(opened.el);
    expect(tableOrder(opened.el).billPrintPending).toBe(true);
    emit(shell(opened.el), "logout");
    await flush(opened.el, 6);
    await openTable(opened.el, ["payment.take"]);
    await flush(opened.el, 6);
    return opened;
  }

  it("leaves Print the bill usable for the next person, whose press is sent", async () => {
    const endMeal = vi.fn(() => new Promise(() => {}));
    const { el } = await pressThenNextPerson({ endMeal });

    expect(tableOrder(el).billPrintPending).toBe(false);
    expect(tableOrder(el).busy).toBe(false);
    expect(printInMenu(el).disabled).toBe(false);

    await printBill(el);

    expect(endMeal).toHaveBeenCalledTimes(2);
    const [first, second] = sentBodies(endMeal);
    expect(second!.submissionId).not.toBe(first!.submissionId);
  });

  it("still sends the next person one request at a time when the first person's answer arrives", async () => {
    const first = heldAnswer<EndedMeal>();
    const endMeal = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValue(new Promise(() => {}));
    const { el } = await pressThenNextPerson({ endMeal });
    await printBill(el);
    expect(tableOrder(el).billPrintPending).toBe(true);

    first.reject({ code: "bill.nothing_outstanding", status: 409 });
    await flush(el, 6);

    expect(tableOrder(el).billPrintPending).toBe(true);
    expect(tableOrder(el).busy).toBe(true);
    await printBill(el);
    expect(endMeal).toHaveBeenCalledTimes(2);
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

    const said = banner(el)?.textContent;

    release();
    await flush(el, 6);

    expect(banner(el)?.textContent).toBe(said);

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

    const said = banner(el)?.textContent;

    release();
    await flush(el, 6);

    expect(banner(el)?.textContent).toBe(said);

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

    const said = banner(el)?.textContent;

    release();
    await flush(el, 6);

    expect(banner(el)?.textContent).toBe(said);

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

    const said = banner(el)?.textContent;

    release();
    await flush(el, 6);

    expect(banner(el)?.textContent).toBe(said);

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

    const said = banner(el)?.textContent;

    release();
    await flush(el, 6);

    expect(banner(el)?.textContent).toBe(said);

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

  it("says the table changed when its revision moves while the pressed bill is read and staff are still on it", async () => {
    const { getTabLines, release } = holdingFirstBillTwoRead();
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: twoBills(),
      getTabLines,
    });
    await pressPrintFromFinishRefusal(el);
    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);
    expect(banner(el)).toBeNull();

    release();
    await flush(el, 6);

    expect(endMeal).not.toHaveBeenCalled();
    expect(tableOrder(el).orderId).toBe("wo-9");
    expect(banner(el)!.textContent).toContain(t("meal_end.table_moved"));
  });

  it("says nothing when the revision moves but staff have left the pressed bill for another", async () => {
    const { getTabLines, release } = holdingFirstBillTwoRead();
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: twoBills(),
      getTabLines,
    });
    await pressPrintFromFinishRefusal(el);
    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);
    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-4" });
    await flush(el, 6);

    release();
    await flush(el, 6);

    expect(endMeal).not.toHaveBeenCalled();
    expect(banner(el)).toBeNull();
  });

  it("keeps the table-moved message for the pressed bill and shows it when staff return to that bill", async () => {
    const { getTabLines, release } = holdingFirstBillTwoRead();
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: twoBills(),
      getTabLines,
    });
    await pressPrintFromFinishRefusal(el);
    emit(tableOrder(el), "serve-lines", { items: [{ lineId: "line-1", quantity: "1" }] });
    await flush(el, 6);
    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-4" });
    await flush(el, 6);

    release();
    await flush(el, 6);
    expect(banner(el)).toBeNull();

    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-9" });
    await flush(el, 6);

    expect(endMeal).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("meal_end.table_moved"));
  });

  it("says why nothing was sent when the bill it opens has a part payment held", async () => {
    const { el, endMeal } = await openBill({
      finishTable: vi.fn().mockRejectedValue({ code: "party.bill_outstanding" }),
      getPartyBills: twoBills(),
      takeBillPayment: vi.fn(() => new Promise(() => {})),
    });
    await openDialog(el, "contribution");
    await type(el, "amount", "40");
    await type(el, "tendered", "50");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    expect(tableOrder(el).billPaymentHeld).toBe(true);
    emit(tableOrder(el), "switch-bill", { workingOrderId: "wo-9" });
    await flush(el, 6);
    expect(tableOrder(el).billPaymentHeld).toBe(false);

    await pressPrintFromFinishRefusal(el);

    expect(tableOrder(el).orderId).toBe("wo-4");
    expect(endMeal).not.toHaveBeenCalled();
    expect(banner(el)!.textContent).toContain(t("bill_pay.sending"));
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

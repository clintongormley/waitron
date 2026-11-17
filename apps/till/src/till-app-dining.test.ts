import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { TillApp } from "./till-app.js";
import "./till-app.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillProduct, TillApi, ZoneOffers } from "./api/client.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import { answeredPartyAllergy } from "../test/answered-party-allergy.js";
import {
  billOf,
  emit,
  flush,
  invoiceOf,
  lock,
  offers,
  openTable,
  resetBillPayDrafts,
  stubApi,
  tableOrder,
} from "../test/bill-pay-app.js";

const tillChoice: ZoneOffers = {
  ...offers,
  context: { ...offers.context, dining: { policy: "till_choice", startsAs: "eat_in" } },
};

const cola: TillProduct = {
  id: "cola",
  menuItemId: "offer-cola",
  menuId: "cat-default",
  name: "Cola",
  pricingUnit: "each",
  unitPrice: "1.80",
  vatClass: "reduced",
  category: null,
  allergens: null,
};

let previous = currentLocale();
beforeEach(() => {
  previous = currentLocale();
  setLocale("en");
  resetBillPayDrafts();
});
afterEach(() => {
  cleanupWidgets();
  setLocale(previous);
});

const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const switchToEatIn = (el: TillApp) =>
  el.shadowRoot!.querySelector<HTMLElement>("[data-switch-eat-in]");

function segmented(screen: Element) {
  return screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-segmented-control"]>(
    "wt-segmented-control[name='dining']",
  );
}

async function chooseWay(el: TillApp, screen: Element, words: string): Promise<void> {
  const control = segmented(screen)!;
  await control.updateComplete;
  await userEvent.click(
    [...control.shadowRoot!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === words,
    )!,
  );
  await flush(el);
}

/** A switch the server takes, answering the next revision. */
const switching = () =>
  vi.fn(async (_id: string, _dining: string, revision: number) => ({ revision: revision + 1 }));

describe("the counter's way of selling (A1522)", () => {
  async function counterApp(overrides: Record<string, unknown> = {}) {
    const api = stubApi({
      listDefaultZoneOffers: vi.fn().mockResolvedValue(tillChoice),
      recordSale: vi.fn().mockResolvedValue(invoiceOf("1.80")),
      switchDining: switching(),
      ...overrides,
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    await flush(el);
    emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
    await flush(el);
    const counter = () => el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
    return { el, api, counter };
  }

  const payCash = async (el: TillApp, counter: TillCounterScreen) => {
    emit(counter, "confirm-payment", { method: "cash", amount: "20", guestCount: null });
    await flush(el);
  };

  const savedOrder = (diningChoice: "open" | "locked", revision = 2) => ({
    zoneId: null,
    id: "wo-1",
    orderNumber: 5,
    revision,
    label: null,
    expectedEdit: null,
    invoiceType: "F2",
    dining: "eat_in",
    diningChoice,
    kitchenNote: { scope: { workingOrderId: "wo-1" }, note: null, revision: 0, ownerRevision: 0 },
    lines: [
      { workingOrderLineId: "l-1", menuItemId: "offer-cola", quantity: "1.000", product: cola },
    ],
  });

  it("Take away on a draft sends nothing until the sale, whose body carries takeaway", async () => {
    const { el, api, counter } = await counterApp();
    counter().store.addProduct(cola, "1");
    await flush(el);

    await chooseWay(el, counter(), "Take away");

    expect(api.switchDining).not.toHaveBeenCalled();
    expect(counter().store.dining).toBe("takeaway");
    await payCash(el, counter());
    expect(vi.mocked(api.recordSale).mock.calls[0]![9]).toBe("takeaway");
  });

  it("Take away on a saved order switches it on the server and shows the way it now sells", async () => {
    const { el, api, counter } = await counterApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue(savedOrder("open")),
    });
    emit(counter(), "retrieve-order", { id: "wo-1" });
    await flush(el);
    expect(counter().diningChoice).toBe("open");

    await chooseWay(el, counter(), "Take away");

    expect(api.switchDining).toHaveBeenCalledExactlyOnceWith("wo-1", "takeaway", 2, null);
    expect(counter().store.dining).toBe("takeaway");
    expect(counter().store.revision).toBe(3);
    expect(segmented(counter())!.value).toBe("takeaway");
    expect(banner(el)).toBeNull();
  });

  it("a switch refused as locked is worded, and the order read again shows the stored way", async () => {
    const retrieveWorkingOrder = vi
      .fn()
      .mockResolvedValueOnce(savedOrder("open"))
      .mockResolvedValue(savedOrder("locked", 3));
    const { el, counter } = await counterApp({
      retrieveWorkingOrder,
      switchDining: vi.fn().mockRejectedValue({ code: "order.dining_locked", reason: "sent" }),
    });
    emit(counter(), "retrieve-order", { id: "wo-1" });
    await flush(el);

    await chooseWay(el, counter(), "Take away");
    await flush(el);

    expect(banner(el)?.textContent).toContain(codeMessage("order.dining_locked"));
    expect(retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(counter().store.dining).toBe("eat_in");
    expect(segmented(counter())).toBeNull();
    expect(counter().shadowRoot!.querySelector("[data-dining-label]")?.textContent?.trim()).toBe(
      t("dining.eat_in"),
    );
  });

  it("a switch refused as out of date reloads the order and says it was changed elsewhere", async () => {
    const retrieveWorkingOrder = vi.fn().mockResolvedValue(savedOrder("open"));
    const { el, counter } = await counterApp({
      retrieveWorkingOrder,
      switchDining: vi.fn().mockRejectedValue({
        code: "working_order.out_of_date",
        workingOrderId: "wo-1",
        revision: 3,
      }),
    });
    emit(counter(), "retrieve-order", { id: "wo-1" });
    await flush(el);

    await chooseWay(el, counter(), "Take away");
    await flush(el);

    expect(banner(el)?.textContent?.trim()).toBe(t("held.changed_elsewhere"));
    expect(retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(segmented(counter())!.value).toBe("eat_in");
  });

  it("a switch refused as fixed names the way, and the order read again drops the switch", async () => {
    const retrieveWorkingOrder = vi
      .fn()
      .mockResolvedValueOnce(savedOrder("open"))
      .mockResolvedValue({ ...savedOrder("open", 2), diningChoice: "none" });
    const { el, counter } = await counterApp({
      retrieveWorkingOrder,
      switchDining: vi.fn().mockRejectedValue({ code: "order.dining_fixed", dining: "eat_in" }),
    });
    emit(counter(), "retrieve-order", { id: "wo-1" });
    await flush(el);

    await chooseWay(el, counter(), "Take away");
    await flush(el);

    expect(banner(el)?.textContent).toContain(
      codeMessage("order.dining_fixed", undefined, { dining: "eat_in" }),
    );
    expect(retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(segmented(counter())).toBeNull();
  });

  it("a second choice while a switch is out sends nothing more", async () => {
    const reply = deferred<{ revision: number }>();
    const { el, api, counter } = await counterApp({
      retrieveWorkingOrder: vi.fn().mockResolvedValue(savedOrder("open")),
      switchDining: vi.fn(() => reply.promise),
    });
    emit(counter(), "retrieve-order", { id: "wo-1" });
    await flush(el);

    emit(counter(), "dining-change", { dining: "takeaway" });
    emit(counter(), "dining-change", { dining: "eat_in" });
    reply.resolve({ revision: 3 });
    await flush(el);

    expect(api.switchDining).toHaveBeenCalledExactlyOnceWith("wo-1", "takeaway", 2, null);
    expect(counter().store.dining).toBe("takeaway");
  });

  it("a refusal arriving after the basket was cleared says nothing and reads nothing", async () => {
    const reply = deferred<{ revision: number }>();
    const retrieveWorkingOrder = vi.fn().mockResolvedValue(savedOrder("open"));
    const { el, counter } = await counterApp({
      retrieveWorkingOrder,
      switchDining: vi.fn(() => reply.promise),
    });
    emit(counter(), "retrieve-order", { id: "wo-1" });
    await flush(el);

    emit(counter(), "dining-change", { dining: "takeaway" });
    counter().store.clear();
    reply.reject({ code: "order.dining_locked", reason: "sent" });
    await flush(el);

    expect(banner(el)).toBeNull();
    expect(retrieveWorkingOrder).toHaveBeenCalledOnce();
  });

  it.each(["order.dining_fixed"])("a sale refused %s says so in its own words", async (code) => {
    const { el, counter } = await counterApp({
      recordSale: vi.fn().mockRejectedValue({ code, canSwitch: false, dining: "eat_in" }),
    });
    counter().store.addProduct(cola, "1");
    await flush(el);

    await payCash(el, counter());

    expect(banner(el)?.textContent).toContain(codeMessage(code, undefined, { dining: "eat_in" }));
    expect(banner(el)?.textContent).not.toContain(codeMessage("server.internal"));
  });
});

describe("a table bill's way of selling (A1522)", () => {
  async function tableApp(
    overrides: Record<string, unknown> = {},
    dining: "eat_in" | "takeaway" = "eat_in",
  ) {
    const getPartyBills = vi
      .fn()
      .mockResolvedValue([billOf({ dining, diningChoice: "open", revision: 5 })]);
    const api = stubApi({
      listZoneOffers: vi.fn().mockResolvedValue(tillChoice),
      getPartyBills,
      switchDining: vi.fn(async (_id: string, dining: string, revision: number) => {
        getPartyBills.mockResolvedValue([
          billOf({ dining: dining as "takeaway", diningChoice: "open", revision: revision + 1 }),
        ]);
        return { revision: revision + 1 };
      }),
      ...overrides,
    });
    const { el } = await mountWidget<TillApp>("till-app", { api });
    Object.assign(api, answeredPartyAllergy(el));
    await openTable(el);
    await flush(el);
    return { el, api: api as TillApi & Record<string, ReturnType<typeof vi.fn>>, getPartyBills };
  }

  it("Take away on a saved bill switches it on the server with the bill's revision and edit", async () => {
    const { el, api } = await tableApp();
    expect(tableOrder(el).diningChoice).toBe("open");

    await chooseWay(el, tableOrder(el), "Take away");
    await flush(el);

    expect(api.switchDining).toHaveBeenCalledExactlyOnceWith(
      "wo-4",
      "takeaway",
      5,
      expect.objectContaining({ billId: "wo-4" }),
    );
    expect(tableOrder(el).dining).toBe("takeaway");
    expect(segmented(tableOrder(el))!.value).toBe("takeaway");
  });

  it("a switch refused as locked is worded, and the bills read again show the stored way", async () => {
    const getPartyBills = vi
      .fn()
      .mockResolvedValue([billOf({ diningChoice: "open", revision: 5 })]);
    const { el } = await tableApp({
      getPartyBills,
      switchDining: vi.fn(async () => {
        getPartyBills.mockResolvedValue([billOf({ diningChoice: "locked", revision: 6 })]);
        throw { code: "order.dining_locked", reason: "paid" };
      }),
    });

    await chooseWay(el, tableOrder(el), "Take away");
    await flush(el);

    expect(banner(el)?.textContent).toContain(codeMessage("order.dining_locked"));
    expect(tableOrder(el).diningChoice).toBe("locked");
    expect(tableOrder(el).dining).toBe("eat_in");
    expect(segmented(tableOrder(el))).toBeNull();
  });

  it("a second choice while a switch is out sends nothing more", async () => {
    const reply = deferred<{ revision: number }>();
    const { el, api } = await tableApp({ switchDining: vi.fn(() => reply.promise) });

    emit(tableOrder(el), "dining-change", { dining: "takeaway" });
    emit(tableOrder(el), "dining-change", { dining: "eat_in" });
    reply.resolve({ revision: 6 });
    await flush(el);

    expect(api.switchDining).toHaveBeenCalledExactlyOnceWith(
      "wo-4",
      "takeaway",
      5,
      expect.objectContaining({ billId: "wo-4" }),
    );
  });

  it("a refusal arriving after leaving the table says nothing and reads no bills", async () => {
    const reply = deferred<{ revision: number }>();
    const { el, getPartyBills } = await tableApp({ switchDining: vi.fn(() => reply.promise) });
    emit(tableOrder(el), "dining-change", { dining: "takeaway" });
    emit(tableOrder(el), "back-to-floor");
    await flush(el);
    const reads = getPartyBills.mock.calls.length;

    reply.reject({ code: "order.dining_locked", reason: "paid" });
    await flush(el);

    expect(banner(el)).toBeNull();
    expect(getPartyBills).toHaveBeenCalledTimes(reads);
  });

  it("a switch refused because the bill's draft changed elsewhere says so and reads the draft again", async () => {
    const { el, api, getPartyBills } = await tableApp({
      switchDining: vi.fn().mockRejectedValue({ code: "draft.out_of_date" }),
    });
    const listDrafts = vi.spyOn(api, "listDrafts");

    await chooseWay(el, tableOrder(el), "Take away");
    await flush(el);

    expect(banner(el)?.textContent?.trim()).toBe(t("table.draft_changed_elsewhere"));
    const refused = vi.mocked(api.switchDining).mock.invocationCallOrder[0]!;
    const billsRead = getPartyBills.mock.invocationCallOrder.find((order) => order > refused)!;
    expect(
      listDrafts.mock.invocationCallOrder.filter((order) => order > refused && order < billsRead),
    ).toHaveLength(1);
    expect(tableOrder(el).dining).toBe("eat_in");
  });

  it("a switch while the bill's draft could not be read sends nothing and says the draft is out of date", async () => {
    const { el, api } = await tableApp({
      listDrafts: vi.fn().mockRejectedValue(new Error("network")),
    });
    expect(banner(el)?.textContent?.trim()).toBe(t("table.draft_read_failed"));

    await chooseWay(el, tableOrder(el), "Take away");
    await flush(el);

    expect(api.switchDining).not.toHaveBeenCalled();
    expect(banner(el)?.textContent).toContain(codeMessage("draft.out_of_date"));
    expect(segmented(tableOrder(el))!.value).toBe("eat_in");
  });

  it("dishes moved to a bill sold the other way are refused in their own words", async () => {
    const { el } = await tableApp({
      getPartyBills: vi.fn().mockResolvedValue([
        billOf({ diningChoice: "open", revision: 5 }),
        billOf({
          workingOrderId: "wo-5",
          billNumber: 2,
          dining: "takeaway",
          diningChoice: "open",
        }),
      ]),
      moveDishes: vi.fn().mockRejectedValue({
        code: "order.dining_differs",
        fromOrderId: "wo-4",
        toOrderId: "wo-5",
      }),
    });

    emit(tableOrder(el), "move-dishes", { lineIds: ["l-1"], toBillId: "wo-5" });
    await flush(el);

    expect(banner(el)?.textContent).toContain(codeMessage("order.dining_differs"));
  });

  it.each([["order.dining_fixed", { dining: "eat_in" }]])(
    "a switch refused %s says so in its own words",
    async (code, params) => {
      const { el } = await tableApp({
        switchDining: vi.fn().mockRejectedValue({ code, ...params }),
      });

      await chooseWay(el, tableOrder(el), "Take away");
      await flush(el);

      expect(banner(el)?.textContent).toContain(codeMessage(code, undefined, { dining: "eat_in" }));
      expect(switchToEatIn(el)).toBeNull();
      expect(segmented(tableOrder(el))!.value).toBe("eat_in");
    },
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

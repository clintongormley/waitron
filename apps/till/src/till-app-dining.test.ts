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

const lunch: TillProduct = {
  id: "set-lunch",
  menuItemId: "offer-lunch",
  menuId: "cat-default",
  name: "Set lunch",
  pricingUnit: "each",
  unitPrice: "14.00",
  vatClass: "reduced",
  category: null,
  allergens: null,
  setLunch: true,
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

  it("a set lunch refused on a takeaway sale offers Switch to eat here, which keeps the set lunch", async () => {
    const recordSale = vi
      .fn()
      .mockRejectedValueOnce({ code: "order.set_lunch_takeaway", canSwitch: true })
      .mockResolvedValue(invoiceOf("14.00"));
    const { el, api, counter } = await counterApp({ recordSale });
    await chooseWay(el, counter(), "Take away");
    counter().store.addProduct(lunch, "1");
    await flush(el);

    await payCash(el, counter());

    expect(banner(el)?.textContent).toContain(codeMessage("order.set_lunch_takeaway"));
    expect(banner(el)?.textContent).toContain(t("dining.switch_to_eat_in_explained"));
    const action = switchToEatIn(el)!;
    expect(action.textContent?.trim()).toBe(t("dining.switch_to_eat_in"));

    await userEvent.click(action);
    await flush(el);

    expect(api.switchDining).not.toHaveBeenCalled();
    expect(counter().store.dining).toBe("eat_in");
    expect(counter().store.lines.map((line) => line.product.name)).toEqual(["Set lunch"]);
    expect(banner(el)).toBeNull();
    await payCash(el, counter());
    expect(recordSale.mock.calls[1]![9]).toBe("eat_in");
  });

  it("Switch to eat here on a saved order switches it on the server", async () => {
    const { el, api, counter } = await counterApp({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValue({ ...savedOrder("open"), dining: "takeaway" }),
      updateWorkingOrder: vi
        .fn()
        .mockRejectedValue({ code: "order.set_lunch_takeaway", canSwitch: true }),
    });
    emit(counter(), "retrieve-order", { id: "wo-1" });
    await flush(el);
    counter().store.addProduct(lunch, "1");
    await flush(el);
    await payCash(el, counter());

    await userEvent.click(switchToEatIn(el)!);
    await flush(el);

    expect(api.switchDining).toHaveBeenCalledExactlyOnceWith("wo-1", "eat_in", 2, null);
    expect(counter().store.dining).toBe("eat_in");
    expect(counter().store.lines.map((line) => line.product.name)).toContain("Set lunch");
  });

  it("a set lunch refused where the order cannot switch offers no Switch to eat here", async () => {
    const { el, counter } = await counterApp({
      recordSale: vi.fn().mockRejectedValue({ code: "order.set_lunch_takeaway", canSwitch: false }),
    });
    await chooseWay(el, counter(), "Take away");
    counter().store.addProduct(lunch, "1");
    await flush(el);

    await payCash(el, counter());

    expect(banner(el)?.textContent).toContain(codeMessage("order.set_lunch_takeaway"));
    expect(switchToEatIn(el)).toBeNull();
  });

  it.each(["order.dining_fixed", "order.set_lunch_takeaway"])(
    "a sale refused %s says so in its own words",
    async (code) => {
      const { el, counter } = await counterApp({
        recordSale: vi.fn().mockRejectedValue({ code, canSwitch: false, dining: "eat_in" }),
      });
      counter().store.addProduct(cola, "1");
      await flush(el);

      await payCash(el, counter());

      expect(banner(el)?.textContent).toContain(codeMessage(code, undefined, { dining: "eat_in" }));
      expect(banner(el)?.textContent).not.toContain(codeMessage("server.internal"));
    },
  );
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

  it("a round with a set lunch refused on a takeaway bill offers Switch to eat here, which switches the bill on the server", async () => {
    const { el, api } = await tableApp(
      {
        submitDraft: vi
          .fn()
          .mockRejectedValue({ code: "order.set_lunch_takeaway", canSwitch: true }),
      },
      "takeaway",
    );
    tableOrder(el).draftStore!.addProduct(lunch, "1");
    await flush(el);
    tableOrder(el)
      .shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!
      .click();
    await flush(el, 6);
    expect(api.submitDraft).toHaveBeenCalledOnce();
    expect(banner(el)?.textContent).toContain(codeMessage("order.set_lunch_takeaway"));

    await userEvent.click(switchToEatIn(el)!);
    await flush(el);

    expect(api.switchDining).toHaveBeenCalledExactlyOnceWith(
      "wo-4",
      "eat_in",
      5,
      expect.objectContaining({ billId: "wo-4" }),
    );
    expect(banner(el)).toBeNull();
    expect(tableOrder(el).dining).toBe("eat_in");
    expect(tableOrder(el).draftStore!.lines.map((line) => line.product.name)).toEqual([
      "Set lunch",
    ]);
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

  it.each([
    ["order.dining_fixed", { dining: "eat_in" }],
    ["order.set_lunch_takeaway", { canSwitch: false }],
  ])("a switch refused %s says so in its own words", async (code, params) => {
    const { el } = await tableApp({
      switchDining: vi.fn().mockRejectedValue({ code, ...params }),
    });

    await chooseWay(el, tableOrder(el), "Take away");
    await flush(el);

    expect(banner(el)?.textContent).toContain(codeMessage(code, undefined, { dining: "eat_in" }));
    expect(switchToEatIn(el)).toBeNull();
    expect(segmented(tableOrder(el))!.value).toBe("eat_in");
  });
});

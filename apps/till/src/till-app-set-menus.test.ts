import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  allergyView,
  api,
  emit as emitApp,
  flush,
  menu,
  mountApp,
  openTable,
  resetAllergyFixture,
  shell,
} from "../test/allergy-app-fixture.js";
import { t } from "./i18n/t.js";
import { setMenuCopyOf } from "@waitron/shared";
import {
  balanceOf,
  cash,
  dialog,
  emit,
  flush as flushCounter,
  inDialog,
  invoiceOf,
  line,
  lock,
  offers,
  paymentOf,
  press,
  resetBillPayDrafts,
  stubApi as counterApi,
  takenOf,
  till,
  type,
} from "../test/bill-pay-app.js";
import type { TillApp } from "./till-app.js";
import type { TabLine } from "./api/client.js";
import { liveReadFixture } from "../test/live-connection.js";
import { daily, bill, special } from "../test/set-menu-widgets.js";
import { setMenuProduct } from "./widgets/product-pick.js";
import { showView } from "./screens/till-table-order-screen.test-helpers.js";
import { cleanupWidgets, mountWidget, partyBillOf } from "./widgets/test-helpers.js";

beforeEach(resetAllergyFixture);
afterEach(cleanupWidgets);

it("opens the same choices for the exact drafted dish Send refuses", async () => {
  const sirloin = daily.offers[1]!;
  const variant = {
    ...sirloin,
    id: "rare",
    name: "Rare",
    menuPrice: null,
    pricingUnit: "each" as const,
  };
  const offer = { ...sirloin, variants: [variant], variantCountsAs: { rare: "main" } };
  const withVariant = { ...daily, offers: [offer] };
  const zone = menu("lunch");
  zone.menus[0]!.structure.members.push({
    kind: "set_menu",
    menuId: daily.menuId,
    name: daily.name,
  });
  zone.setMenus = [withVariant, special].map((copy) => ({
    ...copy,
    versionIds: ["lunch"],
    orderable: true,
    newestOnSale: true,
  }));
  const submitDraft = vi.fn(async (_party, _draft, request) => {
    const ids = request.groups.flatMap((group: { lineIds: string[] }) => group.lineIds);
    expect(ids).toHaveLength(2);
    throw {
      code: "set_menu.no_place",
      status: 409,
      dishName: "Sirloin",
      draftLineId: ids[1],
    };
  });
  const { el } = await mountApp({
    listZoneOffers: vi.fn(async () => zone),
    getPartyBills: vi.fn(async () => [
      {
        ...partyBillOf("v1", "wo-4", 1),
        setMenus: bill,
        setMenuCopies: [withVariant, special],
      },
    ]),
    previewPartyAllergy: vi.fn(async (_partyId, target) => allergyView("none", target)),
    submitDraft,
  });
  const screen = await openTable(el);
  const product = setMenuProduct({
    offer,
    setMenuId: daily.menuId,
    versionId: "lunch",
  });
  const selected = { ...product, variantId: "rare", variantName: "Rare" };
  for (const note of ["First", "Second"])
    screen.draftStore!.addProduct(selected, "1", { note, setMenu: { id: daily.menuId } });
  const openPlace = vi.spyOn(screen, "openSetMenuPlace");
  await showView(screen, "order", { ifShown: true, scripted: true });
  await flush(el);
  const send = screen.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!;
  expect(send).not.toBeNull();
  await userEvent.click(send);
  await vi.waitFor(() => expect(submitDraft).toHaveBeenCalled());
  const browser = screen.shadowRoot!.querySelector("till-menu-browser")!;
  await vi.waitFor(() => {
    const modal =
      browser.shadowRoot!.querySelector<import("@waitron/ui").WtDialog>("[data-set-menu-place]");
    expect(modal?.heading).toContain("No place for Sirloin");
    expect(modal?.shadowRoot!.querySelector("dialog")?.open).toBe(true);
  });
  await userEvent.click(page.elementLocator(browser).getByRole("button", { name: "Cancel" }));
  expect(openPlace).toHaveBeenCalledExactlyOnceWith(screen.draftStore!.lines[1]);
  expect(screen.draftStore!.lines.map((line) => line.product.name)).toEqual(["Sirloin", "Sirloin"]);
});

it("shows the counter no set-menu folder or count on a takeaway order", async () => {
  resetBillPayDrafts();
  const zone = {
    ...offers,
    defaultMenuId: "cat-default",
    context: { ...offers.context, dining: { policy: "till_choice", startsAs: "eat_in" } },
    setMenus: [{ ...daily, versionIds: ["v1"], orderable: true, newestOnSale: true }],
    menus: offers.menus.map((menu) => ({
      ...menu,
      structure: {
        ...menu.structure,
        members: [{ kind: "set_menu" as const, menuId: daily.menuId, name: daily.name }],
      },
    })),
  };
  const api = counterApi({
    listDefaultZoneOffers: vi.fn(async () => zone),
    listZoneOffers: vi.fn(async () => zone),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flushCounter(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flushCounter(el);
  const counter = el.shadowRoot!.querySelector("till-counter-screen")!;
  await userEvent.click(page.elementLocator(counter).getByText("Take away", { exact: true }));
  await vi.waitFor(() => expect(counter.store.dining).toBe("takeaway"));
  await flushCounter(el);
  await expect
    .element(page.elementLocator(counter).getByRole("button", { name: /Daily menu/ }))
    .not.toBeInTheDocument();
  expect(counter.setMenuCopies).toEqual([]);
  expect(counter.shadowRoot!.querySelector("till-set-menu-counts")).toBeNull();
});

it("renders a reopened set-menu dish from the recorded offer and saved price", async () => {
  resetBillPayDrafts();
  const offer = daily.offers.find(({ id }) => id === "sirloin")!;
  const source = setMenuProduct({ offer, setMenuId: daily.menuId, versionId: "v1" });
  const id = "reopened-takeaway";
  const api = counterApi({
    getTabLines: vi.fn(async () => ({ lines: [], revision: 6 })),
    retrieveWorkingOrder: vi.fn(async () => ({
      id,
      orderNumber: 10,
      revision: 6,
      zoneId: offers.context.zoneId,
      label: null,
      expectedEdit: null,
      invoiceType: "F2",
      dining: "takeaway",
      diningChoice: "locked",
      kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
      setMenus: {
        copies: [setMenuCopyOf(daily, "v1")],
        recorded: { [daily.menuId]: "v1" },
        setMenus: [bill.setMenus[0]!],
        dishes: [bill.dishes[0]!],
      },
      setMenuCopies: [daily],
      lines: [
        {
          workingOrderLineId: bill.dishes[0]!.lineId,
          menuItemId: offer.id,
          menuVersionId: "v1",
          setMenuId: daily.menuId,
          quantity: "1.000",
          product: {
            ...source,
            unit: { id: "each", name: { en: "each" }, precision: 0, hardwareUnit: null },
          },
        },
      ],
    })),
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flushCounter(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flushCounter(el);
  const counter = el.shadowRoot!.querySelector("till-counter-screen")!;
  emit(counter, "retrieve-order", { id });
  await vi.waitFor(() => expect(counter.store.id).toBe(id));
  await expect
    .element(page.elementLocator(counter).getByText("Sirloin", { exact: true }))
    .toBeVisible();
  expect(counter.shadowRoot!.querySelector("till-total")!.shadowRoot!.textContent).toContain(
    "€19.00",
  );
});

async function takeawaySetMenuOnCounter(
  id: string,
  invoiceNumber?: string,
  overrides: Record<string, unknown> = {},
) {
  resetBillPayDrafts();
  const soup = daily.offers.find((offer) => offer.id === "soup")!;
  const order = {
    id,
    orderNumber: 10,
    revision: 6,
    zoneId: offers.context.zoneId,
    label: null,
    expectedEdit: null,
    invoiceType: "F2",
    dining: "takeaway",
    diningChoice: "locked",
    kitchenNote: { scope: { workingOrderId: id }, note: null, revision: 0, ownerRevision: 0 },
    setMenus: {
      copies: [setMenuCopyOf(daily, "v1")],
      recorded: { [daily.menuId]: "v1" },
      setMenus: [bill.setMenus[0]!],
      dishes: [
        {
          ...bill.dishes[0]!,
          lineId: "soup-line",
          productId: soup.productId,
          place: 0,
          priceCents: 0,
          countsAsCourseId: "starter",
        },
      ],
    },
    setMenuCopies: [daily],
    lines: [
      {
        workingOrderLineId: "soup-line",
        menuItemId: soup.id,
        menuVersionId: "v1",
        setMenuId: daily.menuId,
        quantity: "1.000",
        product: {
          ...setMenuProduct({ offer: soup, setMenuId: daily.menuId, versionId: "v1" }),
          unit: { id: "each", name: { en: "each" }, precision: 0, hardwareUnit: null },
        },
      },
    ],
  };
  const placed = { ...order, ...(invoiceNumber === undefined ? {} : { invoiced: true }) };
  const api = counterApi({
    getTabLines: vi.fn(async () => ({
      lines: [line({ id: "soup-line", lineNo: 2, name: "Soup", unitPriceGross: "0.00" })],
      revision: 6,
    })),
    retrieveWorkingOrder: vi.fn(async () => order),
    retrievePlacedOrder: vi.fn(async () => placed),
    listCounterWaiting: vi.fn(async () => [
      {
        id: "placed-takeaway",
        items: [],
        orderNumber: 10,
        label: null,
        status: "placed",
        total: "14.00",
        openedAt: "2026-11-10T10:00:00Z",
        settledAt: null,
        collectedAt: null,
        serviceMode: "ticket_then_pay",
        counts: { ordered: 1, unsent: 0, held: 0, waiting: 1, ready: 0 },
        canHandOver: false,
        movableDishes: [],
        invoiceNumber,
      },
    ]),
    getBillBalance: vi.fn(async () =>
      balanceOf({ workingOrderId: id, total: "14.00", outstanding: "14.00" }),
    ),
    previewBillPayment: vi.fn().mockResolvedValue(cash("4.00", "0.00")),
    ...overrides,
  });
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flushCounter(el);
  emit(lock(el), "logged-in", { personId: "p1", displayName: "Alex", permissions: [] });
  await flushCounter(el);
  const counter = () => el.shadowRoot!.querySelector("till-counter-screen")!;
  async function pay({ outstanding = "14.00" } = {}) {
    await vi.waitFor(() => expect(counter().store.id).toBe(id));
    await flushCounter(el);
    expect(counter().store.total.toString()).toBe("0.00");
    const tender = counter().shadowRoot!.querySelector("till-tender-pay")!;
    await userEvent.click(tender.shadowRoot!.querySelector("[data-counter-pay]")!);
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await flushCounter(el);
    expect(api.getBillBalance).toHaveBeenCalledWith(id);
    expect(dialog(el)!.balance).toMatchObject({ total: "14.00", outstanding });
    expect(dialog(el)!.shadowRoot!.textContent).toContain("€14.00");
  }
  async function toTakePart() {
    inDialog(el, '[name="way"][value="contribution"]')!.click();
    await flushCounter(el);
    await type(el, "amount", "4");
    await type(el, "tendered", "4");
    await press(el, "[data-pay-continue]");
    expect(inDialog(el, "[data-pay-confirm]")).not.toBeNull();
  }
  return { api, el, counter, pay, toTakePart };
}

it("pays a Counter takeaway set menu at the server's balance", async () => {
  const { counter, pay } = await takeawaySetMenuOnCounter("counter-takeaway");
  emit(counter(), "retrieve-order", { id: "counter-takeaway" });
  await pay();
});

it.each([undefined, "F1/7"])(
  "pays a placed Counter takeaway set menu at the server's balance (invoice %s)",
  async (invoiceNumber) => {
    const { el, counter, pay, toTakePart } = await takeawaySetMenuOnCounter(
      "placed-takeaway",
      invoiceNumber,
    );
    emit(counter(), "pay-waiting-order", { id: "placed-takeaway" });
    await pay();
    await toTakePart();
    const question = inDialog(el, "[data-pay-own-receipt]");
    if (invoiceNumber === undefined)
      expect(question?.textContent).toContain(t("bill_pay.own_receipt"));
    else expect(question).toBeNull();
  },
);

it.each([
  ["has not answered", () => new Promise<never>(() => {})],
  ["failed", () => Promise.reject({ code: "server.internal" })],
  ["no longer lists it", () => Promise.resolve([])],
])(
  "asks for no own receipt on an invoiced Counter order when the waiting list %s",
  async (_, list) => {
    const { el, counter, pay, toTakePart } = await takeawaySetMenuOnCounter(
      "placed-takeaway",
      "F1/7",
      { listCounterWaiting: vi.fn().mockResolvedValueOnce([]).mockImplementation(list) },
    );
    emit(counter(), "pay-waiting-order", { id: "placed-takeaway" });
    await pay();
    await toTakePart();
    expect(inDialog(el, "[data-pay-own-receipt]")).toBeNull();
  },
);

it.each([
  [undefined, "till-invoice-correction-dialog", "till-tender-refund-dialog"],
  ["F1/7", "till-tender-refund-dialog", "till-invoice-correction-dialog"],
] as const)(
  "refunds a payment with its own receipt on a placed Counter set menu (invoice %s) through %s",
  async (invoiceNumber, opened, other) => {
    const id = "placed-takeaway";
    const { api, el, counter, pay } = await takeawaySetMenuOnCounter(id, invoiceNumber, {
      getBillBalance: vi.fn().mockResolvedValue(
        balanceOf({
          workingOrderId: id,
          status: "placed",
          total: "14.00",
          received: "4.00",
          outstanding: "10.00",
          payments: [
            paymentOf({
              applied: "4.00",
              hasTicket: true,
              saleId: "advance-sale",
              left: "4.00",
              tipLeft: "0.00",
              givenBack: "0.00",
              ...(invoiceNumber === undefined
                ? {}
                : { takenOffBy: { saleId: "bill-sale", invoiceNumber } }),
            }),
          ],
        }),
      ),
      getTransactionReceipt: vi.fn().mockResolvedValue(invoiceOf("4.00")),
      getRefundableTenders: vi.fn().mockResolvedValue([
        {
          tenderId: "11111111-1111-4111-8111-111111111111",
          method: "cash",
          last4: null,
          appliedRemaining: "4.00",
          tipRemaining: "0.00",
          pendingRefundId: null,
          manual: false,
        },
      ]),
      readInvoiceCorrectionLines: vi.fn(() => new Promise(() => {})),
    });
    emit(counter(), "pay-waiting-order", { id });
    await pay({ outstanding: "10.00" });
    await press(el, '[data-payment-refund="pay-1"]');
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector(opened)).not.toBeNull());
    expect(api.getTransactionReceipt).toHaveBeenCalledWith("advance-sale", expect.anything());
    expect(el.shadowRoot!.querySelector(other)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-bill-refund-dialog")).toBeNull();
    expect(dialog(el)).toBeNull();
  },
);

it.each([
  [undefined, true],
  ["F1/7", false],
])(
  "a paid placed Counter set menu (invoice %s) has its original receipt to print: %s",
  async (invoiceNumber, original) => {
    const id = "placed-takeaway";
    const { el, counter, pay } = await takeawaySetMenuOnCounter(id, invoiceNumber, {
      previewBillPayment: vi.fn().mockResolvedValue(cash("14.00", "0.00")),
      takeBillPayment: vi.fn(async () =>
        takenOf(
          { applied: "14.00", tendered: "14.00" },
          {
            workingOrderId: id,
            status: "settled",
            total: "14.00",
            received: "14.00",
            outstanding: "0.00",
          },
          invoiceOf("14.00"),
        ),
      ),
    });
    emit(counter(), "pay-waiting-order", { id });
    await pay();
    await type(el, "tendered", "14");
    await press(el, "[data-pay-continue]");
    await press(el, "[data-pay-confirm]");
    await vi.waitFor(() => expect(dialog(el)).toBeNull());
    const ticket = () => el.shadowRoot!.querySelector("till-settlement-document-dialog");
    await vi.waitFor(() => expect(ticket()).not.toBeNull());
    expect(ticket()!.originalReceiptAvailable).toBe(original);
  },
);

it.each([undefined, "F1/7"])(
  "asks for an own receipt as before when Pay is opened again from deferred payment (invoice %s)",
  async (invoiceNumber) => {
    const id = "placed-takeaway";
    const { el, counter, pay, toTakePart } = await takeawaySetMenuOnCounter(id, invoiceNumber, {
      getTill: vi
        .fn()
        .mockResolvedValue({ ...till, capabilities: [...till.capabilities, "close-deferred"] }),
    });
    emit(counter(), "pay-waiting-order", { id });
    await pay();
    await press(el, "[data-pay-deferred]");
    expect(dialog(el)).toBeNull();
    emit(el.shadowRoot!.querySelector("till-deferred-close-dialog")!, "deferred-close-cancel");
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await flushCounter(el);
    await toTakePart();
    expect(inDialog(el, "[data-pay-own-receipt]") !== null).toBe(invoiceNumber === undefined);
  },
);

it.each([undefined, "F1/7"])(
  "asks for an own receipt only before the invoice in the window a short card capture opens (invoice %s)",
  async (invoiceNumber) => {
    const id = "placed-takeaway";
    const balance = balanceOf({
      workingOrderId: id,
      status: "placed",
      total: "14.00",
      received: "5.00",
      outstanding: "9.00",
    });
    const { el, counter, toTakePart } = await takeawaySetMenuOnCounter(id, invoiceNumber, {
      pay: vi.fn().mockResolvedValue({ outcome: "partial", balance }),
      getBillBalance: vi.fn().mockResolvedValue(balance),
    });
    emit(counter(), "pay-waiting-order", { id });
    await vi.waitFor(() => expect(counter().store.id).toBe(id));
    await flushCounter(el);
    emit(counter(), "collect-card", {});
    await vi.waitFor(() => expect(dialog(el)).not.toBeNull());
    await flushCounter(el);
    await toTakePart();
    expect(inDialog(el, "[data-pay-own-receipt]") !== null).toBe(invoiceNumber === undefined);
  },
);

async function tableWithSetMenus(overrides: Record<string, unknown> = {}) {
  const zone = menu("lunch");
  zone.setMenus = [daily, special].map((copy) => ({
    ...copy,
    versionIds: ["lunch"],
    orderable: true,
    newestOnSale: true,
  }));
  const state = { bill: bill as typeof bill };
  const getPartyBills = vi.fn(async () => [
    { ...partyBillOf("v1", "wo-4", 1), setMenus: state.bill, setMenuCopies: [daily, special] },
  ]);
  const { el } = await mountApp({
    listZoneOffers: vi.fn(async () => zone),
    getPartyBills,
    ...overrides,
  });
  const screen = await openTable(el);
  await showView(screen, "order", { ifShown: true, scripted: true });
  await flush(el);
  return { el, screen, state, getPartyBills };
}

const lineIds = (screen: { bills: readonly { setMenus?: typeof bill }[] }) =>
  screen.bills[0]!.setMenus!.setMenus.map(({ lineId }) => lineId);

it("refuses a set-menu change while the table's order is locked", async () => {
  const setSetMenuCount = vi.fn();
  const { screen } = await tableWithSetMenus({ setSetMenuCount });
  const unlock = screen.draftStore!.lockEdits();

  await expect(screen.changeSetMenu!({ menuId: daily.menuId, count: 3 })).resolves.toBe(
    "Something went wrong, try again",
  );
  unlock();
  expect(setSetMenuCount).not.toHaveBeenCalled();
  expect(lineIds(screen)).toEqual(["daily-1", "daily-2", "special-1"]);
});

it("does not change set menus when the drafted dishes cannot be saved first", async () => {
  const setSetMenuCount = vi.fn();
  const { screen } = await tableWithSetMenus({ setSetMenuCount });
  api.saveDraft.mockRejectedValue(new TypeError("offline"));
  const product = setMenuProduct({
    offer: daily.offers[0]!,
    setMenuId: daily.menuId,
    versionId: "lunch",
  });
  screen.draftStore!.addProduct(product, "1", { setMenu: { id: daily.menuId } });

  await expect(screen.changeSetMenu!({ menuId: daily.menuId, count: 3 })).resolves.toBe(
    t("table.draft_save_failed"),
  );
  expect(setSetMenuCount).not.toHaveBeenCalled();
  expect(api.saveDraft).toHaveBeenCalled();
});

it("asks to reopen the table when it cannot be read after a set-menu change", async () => {
  const setSetMenuCount = vi.fn(async () => {
    getPartyBills.mockRejectedValue(new TypeError("offline"));
    return { setMenus: bill, partyRevision: 4 };
  });
  const { el, screen, getPartyBills } = await tableWithSetMenus({ setSetMenuCount });

  await expect(screen.changeSetMenu!({ menuId: daily.menuId, count: 3 })).resolves.toBeUndefined();
  await flush(el);
  expect(el.shadowRoot!.textContent).toContain(t("table.reread_failed"));
});

it.each(["answer", "refusal"])(
  "drops a set-menu %s that arrives after the table was left",
  async (kind) => {
    let answer!: (value: { setMenus: typeof bill; partyRevision: number }) => void;
    let refuse!: (error: unknown) => void;
    const setSetMenuCount = vi.fn(
      () =>
        new Promise<{ setMenus: typeof bill; partyRevision: number }>((resolve, reject) => {
          answer = resolve;
          refuse = reject;
        }),
    );
    const { el, screen, getPartyBills } = await tableWithSetMenus({ setSetMenuCount });

    const saved = screen.changeSetMenu!({ menuId: daily.menuId, count: 3 });
    await vi.waitFor(() => expect(setSetMenuCount).toHaveBeenCalled());
    emitApp(shell(el), "screen-select", { screen: "floor" });
    await flush(el);
    const reads = getPartyBills.mock.calls.length;
    if (kind === "answer")
      answer({ setMenus: { ...bill, setMenus: bill.setMenus.slice(0, 1) }, partyRevision: 9 });
    else refuse({ code: "party.out_of_date" });

    await expect(saved).resolves.toBeUndefined();
    await flush(el);
    expect(getPartyBills.mock.calls.length).toBe(reads);
    expect(el.shadowRoot!.textContent).not.toContain(t("table.reread_failed"));
  },
);

const tabRow = (over: Partial<TabLine> & Pick<TabLine, "id" | "lineNo">): TabLine => ({
  changesAfterSending: null,
  stationId: null,
  movable: false,
  productId: null,
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "0.00",
  servedAt: null,
  courseId: null,
  sentAt: "2026-11-19T12:00:00Z",
  firedAt: null,
  state: null,
  groupId: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
  ...over,
});

it("pays a set-menu bill by items without its covered dishes", async () => {
  const lines = [
    tabRow({ id: "daily-1", lineNo: 1, name: "Daily menu", unitPriceGross: "14.00" }),
    tabRow({ id: "daily-2", lineNo: 2, name: "Daily menu", unitPriceGross: "14.00" }),
    tabRow({ id: "special-1", lineNo: 3, name: "Special menu", unitPriceGross: "19.00" }),
    tabRow({
      id: "sent-sirloin",
      lineNo: 4,
      productId: "product-sirloin",
      name: "Sirloin",
      unitPriceGross: "5.00",
    }),
    tabRow({ id: "sent-soup", lineNo: 5, productId: "product-soup", name: "Soup" }),
  ];
  const withSoup = {
    ...bill,
    dishes: [
      ...bill.dishes,
      { ...bill.dishes[0]!, lineId: "sent-soup", productId: "product-soup", priceCents: 0 },
    ],
  };
  const { screen } = await tableWithSetMenus({
    getTabLines: vi.fn().mockResolvedValue({ lines, revision: 6 }),
    getPartyBills: vi.fn(async () => [
      {
        ...partyBillOf("v1", "wo-4", 1, { outstanding: "52.00" }),
        setMenus: withSoup,
        setMenuCopies: [daily, special],
      },
    ]),
  });
  await vi.waitFor(() => expect(screen.lines).toHaveLength(5));
  const paid = vi.fn();
  screen.addEventListener("bill-pay", (event) => paid((event as CustomEvent).detail));

  await userEvent.click(screen.shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!);

  expect(
    paid.mock.calls[0]![0].lines.map(({ lineNo, total }: { lineNo: number; total: string }) => [
      lineNo,
      total,
    ]),
  ).toEqual([
    [1, "14.00"],
    [2, "14.00"],
    [3, "19.00"],
    [4, "5.00"],
  ]);
});

it("the panel total after a comped set menu equals the server's balance", async () => {
  const twoDaily = { ...bill, setMenus: bill.setMenus.slice(0, 2) };
  const lines = [
    tabRow({
      id: "daily-1",
      lineNo: 1,
      name: "Daily menu",
      unitPriceGross: "0.00",
      listUnitPriceGross: "14.00",
    }),
    tabRow({ id: "daily-2", lineNo: 2, name: "Daily menu", unitPriceGross: "14.00" }),
    tabRow({
      id: "sent-sirloin",
      lineNo: 3,
      productId: "product-sirloin",
      name: "Sirloin",
      unitPriceGross: "5.00",
    }),
  ];
  const { el, screen } = await tableWithSetMenus({
    getTabLines: vi.fn().mockResolvedValue({ lines, revision: 6 }),
    getPartyBills: vi.fn(async () => [
      {
        ...partyBillOf("v1", "wo-4", 1, { outstanding: "19.00" }),
        setMenus: twoDaily,
        setMenuCopies: [daily],
      },
    ]),
  });
  await vi.waitFor(() => expect(screen.lines).toHaveLength(3));
  const sirloin = setMenuProduct({
    offer: daily.offers[1]!,
    setMenuId: daily.menuId,
    versionId: "lunch",
  });
  screen.draftStore!.addProduct(sirloin, "1", { setMenu: { id: daily.menuId } });
  await flush(el);

  // The draft Sirloin takes Daily 2's open main at +5.00; the bill's balance is 19.00.
  await vi.waitFor(() =>
    expect(screen.shadowRoot!.querySelector("[data-order-total]")!.textContent).toContain("24.00"),
  );
});

const soupBill = {
  ...bill,
  dishes: [
    ...bill.dishes,
    { ...bill.dishes[0]!, lineId: "sent-soup", productId: "product-soup", priceCents: 0 },
  ],
};

const soupLines = [
  tabRow({ id: "daily-1", lineNo: 1, name: "Daily menu", unitPriceGross: "14.00" }),
  tabRow({ id: "daily-2", lineNo: 2, name: "Daily menu", unitPriceGross: "14.00" }),
  tabRow({ id: "special-1", lineNo: 3, name: "Special menu", unitPriceGross: "19.00" }),
  tabRow({ id: "sent-soup", lineNo: 4, productId: "product-soup", name: "Soup" }),
];

const soupPartyBill = (setMenus: typeof bill) => ({
  ...partyBillOf("v1", "wo-4", 1, { outstanding: "47.00" }),
  setMenus,
  setMenuCopies: [daily, special],
});

const payDialogLines = (el: TillApp) =>
  el
    .shadowRoot!.querySelector("till-bill-pay-dialog")
    ?.lines.map(({ lineNo, total }) => [lineNo, total]);

it("a refund's pay window leaves out a covered dish at 0.00", async () => {
  const { el, screen } = await tableWithSetMenus({
    getTabLines: vi.fn().mockResolvedValue({ lines: soupLines, revision: 6 }),
    getPartyBills: vi.fn(async () => [soupPartyBill(soupBill)]),
  });
  await vi.waitFor(() => expect(screen.lines).toHaveLength(4));

  emitApp(screen, "refund-excess", { excess: "5.00" });

  await vi.waitFor(() =>
    expect(payDialogLines(el)).toEqual([
      [1, "14.00"],
      [2, "14.00"],
      [3, "19.00"],
    ]),
  );
});

it("an open pay window drops a covered dish when the bills read after the lines places it", async () => {
  const stream = liveReadFixture();
  const getTabLines = vi.fn().mockResolvedValue({ lines: soupLines, revision: 6 });
  const getPartyBills = vi.fn(async () => [soupPartyBill(bill)]);
  const { el, screen } = await tableWithSetMenus({
    readLiveEvents: stream.read,
    getTabLines,
    getPartyBills,
  });
  stream.event("ready");
  await flush(el);
  await vi.waitFor(() => expect(screen.lines).toHaveLength(4));
  await userEvent.click(screen.shadowRoot!.querySelector<HTMLElement>("[data-pay-sheet]")!);
  await vi.waitFor(() => expect(payDialogLines(el)).toContainEqual([4, "0.00"]));

  const reads = getPartyBills.mock.calls.length;
  getPartyBills.mockImplementation(async () => [soupPartyBill(soupBill)]);
  getTabLines.mockRejectedValue(new TypeError("Failed to fetch"));
  stream.event("change", '[{"type":"working_orders"}]');
  await flush(el, 10);

  await vi.waitFor(() => expect(getPartyBills.mock.calls.length).toBeGreaterThan(reads));
  await vi.waitFor(() =>
    expect(screen.bills[0]!.setMenus!.dishes.map(({ lineId }) => lineId)).toContain("sent-soup"),
  );
  await vi.waitFor(() =>
    expect(payDialogLines(el)).toEqual([
      [1, "14.00"],
      [2, "14.00"],
      [3, "19.00"],
    ]),
  );
});

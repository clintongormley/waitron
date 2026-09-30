import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";
import { formatMoney } from "@waitron/shared";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillBasket } from "./widgets/basket.js";
import type { TillAdjustmentDialog } from "./widgets/adjustment-dialog.js";
import type { TillSupervisorOverrideDialog } from "./widgets/supervisor-override-dialog.js";
import type { CanvasDef, CapabilityFlag } from "./layout.js";
import type {
  AdjustmentPreview,
  AdjustmentReason,
  HeldOrder,
  TabLine,
  TabLines,
  TillApi,
  TillProduct,
  ZoneOfferCatalogue,
} from "./api/client.js";

// Give away, Discount and Cancel on a stored counter order, through the app: the dialog is the
// table's, and after an answer the basket is loaded again from the server (B11c).

const canvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 6, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 6, config: {} },
      ],
    },
  ],
};

const till = {
  locale: "en",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "prepay" as const,
  receiptPrintMode: "auto" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [] as { id: string; name: string; displayOrder: number }[],
  cardProvider: "none" as const,
  tipsEnabled: false,
  canvas,
  capabilities: ["print-receipt"] as CapabilityFlag[],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

const offers: ZoneOfferCatalogue = {
  context: { zoneId: "zone-counter", departmentId: "department-default", serviceMode: "prepay" },
  defaultMenuId: null,
  menus: [],
  offers: [],
};

const product = (id: string, name: string, unitPrice: string): TillProduct => ({
  id,
  menuItemId: `mi-${id}`,
  name,
  pricingUnit: "each",
  unitPrice,
  vatClass: "general",
  category: null,
  allergens: null,
});

const tabLine = (over: Partial<TabLine> & Pick<TabLine, "id" | "lineNo">): TabLine => ({
  productId: null,
  parentLineNo: null,
  quantity: "1.000",
  unitPrecision: 0,
  unitPriceGross: "1.00",
  servedAt: null,
  courseId: null,
  sentAt: null,
  firedAt: null,
  state: null,
  groupId: null,
  note: null,
  listId: null,
  menuItemId: null,
  parentProductId: null,
  ...over,
});

/** Croquetas the kitchen has, and a caña at `canaPrice` (given away when not 2.50). */
function heldOrder(revision: number, canaPrice = "2.50", canaQuantity = "1.000"): HeldOrder {
  return {
    id: "wo-9",
    orderNumber: 12,
    label: "Mesa 4",
    revision,
    lines: [
      {
        workingOrderLineId: "l-1",
        productId: "croquetas",
        quantity: "1.000",
        product: product("croquetas", "Croquetas", "6.00"),
      },
      {
        workingOrderLineId: "l-2",
        productId: "cana",
        quantity: canaQuantity,
        product: product("cana", "Caña", canaPrice),
      },
    ],
  } as HeldOrder;
}

function listing(revision: number, canaPrice = "2.50", canaQuantity = "1.000"): TabLines {
  return {
    revision,
    editSentLines: true,
    lines: [
      tabLine({
        id: "l-1",
        lineNo: 1,
        name: "Croquetas",
        productId: "croquetas",
        unitPriceGross: "6.00",
        sentAt: "2026-09-30T09:00:00.000Z",
        firedAt: "2026-09-30T09:00:00.000Z",
        state: "queued",
      }),
      tabLine({
        id: "l-2",
        lineNo: 2,
        name: "Caña",
        productId: "cana",
        quantity: canaQuantity,
        unitPriceGross: canaPrice,
        ...(canaPrice === "2.50" ? {} : { listUnitPriceGross: "2.50" }),
      }),
    ],
  };
}

const complaint: AdjustmentReason = {
  id: "r-complaint",
  name: "Complaint",
  actions: ["comp", "discount_percent", "cancel"],
  noteRequired: false,
  maxPercentBp: null,
  maxAmount: null,
  applyRole: "supervisor",
  approverRole: "manager",
};

const preview = (over: Partial<AdjustmentPreview> = {}): AdjustmentPreview => ({
  reduction: "2.50",
  nominalValue: "2.50",
  needsApproval: null,
  overBillDiscountLimit: false,
  lines: [],
  ...over,
});

let api: TillApi;

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getTill: vi.fn().mockResolvedValue(till),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
    }),
    getDeviceStation: vi.fn().mockRejectedValue({ code: "device.unauthorized" }),
    listStaff: vi.fn().mockResolvedValue([]),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(offers),
    listZoneOffers: vi.fn().mockResolvedValue(offers),
    setServiceZone: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue([]),
    listStatuses: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    logout: vi.fn().mockResolvedValue(undefined),
    retrieveWorkingOrder: vi
      .fn()
      .mockResolvedValueOnce(heldOrder(4))
      .mockResolvedValue(heldOrder(5, "0.00")),
    getTabLines: vi.fn().mockResolvedValueOnce(listing(4)).mockResolvedValue(listing(5, "0.00")),
    listAdjustmentReasons: vi.fn().mockResolvedValue([complaint]),
    listAdjustmentApprovers: vi.fn().mockResolvedValue([{ personId: "m-1", displayName: "Marta" }]),
    previewAdjustment: vi.fn().mockResolvedValue(preview()),
    applyAdjustment: vi
      .fn()
      .mockResolvedValue({ adjustmentIds: ["a-1"], revision: 5, party: null }),
    ...overrides,
  } as unknown as TillApi;
}

async function flush(el: TillApp, rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
  }
}

function emit(source: Element, type: string, detail?: unknown): void {
  source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const lock = (el: TillApp) => el.shadowRoot!.querySelector<TillLockScreen>("till-lock-screen");
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
const basket = (el: TillApp) =>
  counter(el)
    .shadowRoot!.querySelector("till-card-grid")!
    .shadowRoot!.querySelector<TillBasket>("till-basket")!;
const inBasket = (el: TillApp, selector: string) =>
  basket(el).shadowRoot!.querySelector<HTMLElement>(selector);
const banner = (el: TillApp) => el.shadowRoot!.querySelector<HTMLElement>(".error");
const dialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillAdjustmentDialog>("till-adjustment-dialog");
const approval = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>("till-supervisor-override-dialog");
const inDialog = (el: TillApp, selector: string) =>
  dialog(el)!.shadowRoot!.querySelector<HTMLElement>(selector)!;

async function press(el: TillApp, target: HTMLElement): Promise<void> {
  target.click();
  await flush(el);
}

/** Signs in and retrieves the stored order wo-9 into the counter's basket. */
async function retrieved(overrides: Record<string, unknown> = {}): Promise<TillApp> {
  api = stubApi(overrides);
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", canConfigureTill: false });
  await flush(el);
  emit(counter(el), "retrieve-order", { id: "wo-9" });
  await flush(el);
  return el;
}

async function chooseReason(el: TillApp, name: string): Promise<void> {
  const radio = [
    ...dialog(el)!.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="reason"]'),
  ].find((candidate) => candidate.closest("label")!.textContent!.trim() === name)!;
  await press(el, radio);
}

/** Opens Give away on the caña, chooses Complaint and presses Continue. */
async function previewComp(el: TillApp): Promise<void> {
  await press(el, inBasket(el, '[data-comp-line="1"]')!);
  await chooseReason(el, "Complaint");
  await press(el, inDialog(el, "[data-adjust-continue]"));
}

const ask = {
  expectedRevision: 4,
  lineId: "l-2",
  reasonId: "r-complaint",
  action: "comp",
  note: null,
};

const applied = () =>
  vi.mocked(api.applyAdjustment).mock.calls.map(([orderId, command]) => ({ orderId, command }));

async function pinPad(el: TillApp, digits: string): Promise<void> {
  const override = approval(el)!;
  override.shadowRoot!.querySelector<HTMLElement>('[data-person="m-1"]')!.click();
  await override.updateComplete;
  for (const digit of digits) {
    override
      .shadowRoot!.querySelector("till-numeric-pad")!
      .shadowRoot!.querySelector<HTMLElement>(`[data-key="${digit}"]`)!
      .click();
    await override.updateComplete;
  }
  await press(el, override.shadowRoot!.querySelector<HTMLElement>(".authorize")!);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const offered = (el: TillApp) =>
  basket(el).shadowRoot!.querySelectorAll(
    "[data-cancel-line], [data-comp-line], [data-discount-bill]",
  ).length;

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-app: giving away a dish on a stored counter order", () => {
  it("offers the adjustments once the order's lines are read, Cancel only on what the kitchen has", async () => {
    const el = await retrieved();

    expect(api.getTabLines).toHaveBeenCalledWith("wo-9");
    expect(inBasket(el, '[data-cancel-line="0"]')).not.toBeNull();
    expect(inBasket(el, '[data-cancel-line="1"]')).toBeNull();
    expect(inBasket(el, '[data-comp-line="1"]')).not.toBeNull();
    expect(inBasket(el, "[data-discount-bill]")).not.toBeNull();
  });

  it("offers none, and keeps remove on every line, when the order's lines cannot be read", async () => {
    const el = await retrieved({
      getTabLines: vi.fn().mockRejectedValue({ code: "tab.not_open" }),
    });

    expect(counter(el).store.lines).toHaveLength(2);
    expect(offered(el)).toBe(0);
    expect(basket(el).shadowRoot!.querySelectorAll(".line .remove")).toHaveLength(2);
    expect(banner(el)).toBeNull();
  });

  it("offers none once the order is placed", async () => {
    const el = await retrieved({ placeOrder: vi.fn().mockResolvedValue(undefined) });
    expect(offered(el)).toBeGreaterThan(0);

    emit(counter(el), "place-order");
    await flush(el);

    expect(api.placeOrder).toHaveBeenCalledWith("wo-9");
    expect(offered(el)).toBe(0);
  });

  it("applies it to the counter order at the basket's revision, then loads the order again", async () => {
    const el = await retrieved();

    await previewComp(el);
    expect(api.previewAdjustment).toHaveBeenCalledWith("wo-9", ask);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(applied()).toEqual([
      { orderId: "wo-9", command: { ...ask, submissionId: expect.any(String) } },
    ]);
    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(counter(el).store.revision).toBe(5);
    const cana = basket(el).shadowRoot!.querySelectorAll(".line")[1]!;
    expect(cana.querySelector(".line-total s")!.textContent).toBe(
      formatMoney("2.50", currentLocale()),
    );
    expect(cana.querySelector(".line-total")!.textContent).toContain(
      formatMoney("0.00", currentLocale()),
    );
    expect(banner(el)).toBeNull();
    // Acting again starts from the order as it is now.
    await previewComp(el);
    expect(api.previewAdjustment).toHaveBeenLastCalledWith("wo-9", { ...ask, expectedRevision: 5 });
  });

  it("cancels a dish the kitchen has with a reason", async () => {
    const el = await retrieved();

    await press(el, inBasket(el, '[data-cancel-line="0"]')!);
    await chooseReason(el, "Complaint");
    await press(el, inDialog(el, "[data-adjust-continue]"));

    expect(api.previewAdjustment).toHaveBeenCalledWith("wo-9", {
      expectedRevision: 4,
      lineId: "l-1",
      reasonId: "r-complaint",
      action: "cancel",
      note: null,
    });
  });

  it("asks an approver for their PIN when the reason needs one", async () => {
    const el = await retrieved({
      previewAdjustment: vi.fn().mockResolvedValue(preview({ needsApproval: "manager" })),
    });

    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(api.listAdjustmentApprovers).toHaveBeenCalledWith("manager");
    await pinPad(el, "7777");

    expect(applied()).toEqual([
      {
        orderId: "wo-9",
        command: {
          ...ask,
          submissionId: expect.any(String),
          approver: { personId: "m-1", pin: "7777" },
        },
      },
    ]);
    expect(approval(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
  });
});

describe("till-app: a stored counter order changed elsewhere", () => {
  it("loads the order again after an out-of-date refusal, says what changed, and sends nothing again", async () => {
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockResolvedValue(heldOrder(6, "2.50", "2.000")),
      getTabLines: vi
        .fn()
        .mockResolvedValueOnce(listing(4))
        .mockResolvedValue(listing(6, "2.50", "2.000")),
      applyAdjustment: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });

    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(api.applyAdjustment).toHaveBeenCalledOnce();
    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(counter(el).store.revision).toBe(6);
    expect(counter(el).store.lines[1]!.quantity).toBe("2");
    expect(banner(el)!.textContent).toBe(t("adjust.changed_line").replace("{line}", "Caña"));
  });

  it("says the order could not be read again, rather than what changed, when its lines cannot be", async () => {
    const el = await retrieved({
      getTabLines: vi
        .fn()
        .mockResolvedValueOnce(listing(4))
        .mockRejectedValue(new TypeError("Failed to fetch")),
      applyAdjustment: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });

    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(offered(el)).toBe(0);
    expect(banner(el)!.textContent).toBe(t("held.reread_failed"));
  });

  it("says the order is no longer available when it has gone by the time it is loaded again", async () => {
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockRejectedValue({ code: "working_order.not_found", status: 404 }),
    });

    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));

    expect(api.applyAdjustment).toHaveBeenCalledOnce();
    expect(dialog(el)).toBeNull();
    expect(counter(el).store.revision).toBe(4);
    expect(banner(el)!.textContent).toBe(t("held.stale"));
  });

  it("loads the order again and says the change may have been made when no answer ever comes", async () => {
    const applyAdjustment = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const el = await retrieved({ applyAdjustment });
    await previewComp(el);

    inDialog(el, "[data-adjust-confirm]").click();
    // Two pauses between the three tries run on real time; wait for the message they end in.
    await vi.waitFor(() => expect(banner(el)?.textContent).toBe(t("adjust.unconfirmed")), {
      timeout: 4000,
      interval: 50,
    });

    expect(applyAdjustment).toHaveBeenCalledTimes(3);
    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);
    expect(banner(el)!.textContent).toBe(t("adjust.unconfirmed"));
  });
});

describe("till-app: an answer after the basket moved on", () => {
  it("leaves a cleared basket alone when the answer comes", async () => {
    const answer = deferred<{ adjustmentIds: string[]; revision: number; party: null }>();
    const el = await retrieved({ applyAdjustment: vi.fn(() => answer.promise) });
    await previewComp(el);
    inDialog(el, "[data-adjust-confirm]").click();
    await flush(el);

    counter(el).store.clear();
    await flush(el);
    answer.resolve({ adjustmentIds: ["a-1"], revision: 5, party: null });
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
    expect(counter(el).store.lines).toHaveLength(0);
    expect(banner(el)).toBeNull();
  });

  it("says nothing of a refusal that comes after the basket was cleared", async () => {
    const answer = deferred<never>();
    const el = await retrieved({ applyAdjustment: vi.fn(() => answer.promise) });
    await previewComp(el);
    inDialog(el, "[data-adjust-confirm]").click();
    await flush(el);

    counter(el).store.clear();
    await flush(el);
    answer.reject({ code: "adjustment.over_limit" });
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
    expect(banner(el)).toBeNull();
  });

  it("does not load the order again for an answer that comes after the till locked", async () => {
    const answer = deferred<{ adjustmentIds: string[]; revision: number; party: null }>();
    const el = await retrieved({ applyAdjustment: vi.fn(() => answer.promise) });
    await previewComp(el);
    inDialog(el, "[data-adjust-confirm]").click();
    await flush(el);

    emit(counter(el), "logout");
    await flush(el);
    answer.resolve({ adjustmentIds: ["a-1"], revision: 5, party: null });
    await flush(el);

    expect(dialog(el)).toBeNull();
    expect(api.retrieveWorkingOrder).toHaveBeenCalledOnce();
  });

  it("does not put the order back into a basket cleared while it was being loaded again", async () => {
    const reload = deferred<HeldOrder>();
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementation(() => reload.promise),
    });
    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(api.retrieveWorkingOrder).toHaveBeenCalledTimes(2);

    counter(el).store.clear();
    reload.resolve(heldOrder(5, "0.00"));
    await flush(el);

    expect(counter(el).store.lines).toHaveLength(0);
    expect(counter(el).store.persisted).toBe(false);
  });

  it("closes the dialog when another order is retrieved into the basket", async () => {
    const el = await retrieved();
    await previewComp(el);

    vi.mocked(api.retrieveWorkingOrder).mockResolvedValue({ ...heldOrder(2), id: "wo-10" });
    emit(counter(el), "retrieve-order", { id: "wo-10" });
    await flush(el);

    expect(dialog(el)).toBeNull();
  });
});

describe("till-app: no adjustment while the order is being paid, placed or held", () => {
  const adjustByHand = (el: TillApp) =>
    emit(basket(el), "adjust", {
      kind: "comp",
      counter: true,
      target: { lineId: "l-2", name: "Caña", quantity: "1", total: "2.50", unitTotal: null },
    });

  it("offers none, and opens nothing, while a card payment of the order is out", async () => {
    const payment = deferred<{ outcome: "declined" }>();
    const el = await retrieved({ pay: vi.fn(() => payment.promise) });

    emit(counter(el), "collect-card", {});
    await flush(el);

    expect(api.pay).toHaveBeenCalledOnce();
    expect(offered(el)).toBe(0);
    expect(inBasket(el, '[data-cancel-line="0"]')).toBeNull();
    expect(
      basket(el).shadowRoot!.querySelectorAll(".line")[0]!.querySelector(".remove"),
    ).toBeNull();
    adjustByHand(el);
    await flush(el);
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();

    payment.resolve({ outcome: "declined" });
    await flush(el);
    expect(offered(el)).toBeGreaterThan(0);
  });

  it("offers none, and opens nothing, while the order is being placed", async () => {
    const placing = deferred<void>();
    const el = await retrieved({ placeOrder: vi.fn(() => placing.promise) });

    emit(counter(el), "place-order");
    await flush(el);

    expect(api.placeOrder).toHaveBeenCalledOnce();
    expect(offered(el)).toBe(0);
    adjustByHand(el);
    await flush(el);
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();
    placing.resolve();
    await flush(el);
  });

  it("opens nothing while a changed order is being saved to be held", async () => {
    const saving = deferred<{ revision: number }>();
    const el = await retrieved({ updateWorkingOrder: vi.fn(() => saving.promise) });
    counter(el).store.setLineQuantity(1, "2");
    await flush(el);

    emit(counter(el), "park-order", {});
    await flush(el);

    expect(api.updateWorkingOrder).toHaveBeenCalledOnce();
    adjustByHand(el);
    await flush(el);
    expect(api.listAdjustmentReasons).not.toHaveBeenCalled();
    saving.resolve({ revision: 5 });
    await flush(el);
  });
});

describe("till-app: the basket while the order is loaded again", () => {
  const plus = (el: TillApp, index: number) =>
    basket(el)
      .shadowRoot!.querySelectorAll<HTMLElement>(".line")
      [index]!.querySelector<HTMLElement>(".step-inc")!;

  it("takes no edit until the order given away is loaded again, and takes edits after", async () => {
    const reload = deferred<HeldOrder>();
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementation(() => reload.promise),
    });
    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(dialog(el)).toBeNull();

    await press(el, plus(el, 1));
    expect(counter(el).store.lines[1]!.quantity).toBe("1");
    expect(counter(el).store.dirty).toBe(false);
    expect(offered(el)).toBe(0);

    reload.resolve(heldOrder(5, "0.00"));
    await flush(el);
    expect(counter(el).store.revision).toBe(5);
    await press(el, plus(el, 1));
    expect(counter(el).store.lines[1]!.quantity).toBe("2");
  });

  it("takes no edit until the order is loaded again after an out-of-date refusal", async () => {
    const reload = deferred<HeldOrder>();
    const el = await retrieved({
      retrieveWorkingOrder: vi
        .fn()
        .mockResolvedValueOnce(heldOrder(4))
        .mockImplementation(() => reload.promise),
      applyAdjustment: vi.fn().mockRejectedValue({ code: "working_order.out_of_date" }),
    });
    await previewComp(el);
    await press(el, inDialog(el, "[data-adjust-confirm]"));
    expect(dialog(el)).toBeNull();

    await press(el, plus(el, 1));
    expect(counter(el).store.dirty).toBe(false);

    reload.resolve(heldOrder(6));
    await flush(el);
    expect(counter(el).store.revision).toBe(6);
    await press(el, plus(el, 1));
    expect(counter(el).store.dirty).toBe(true);
  });
});

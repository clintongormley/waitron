import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";
import { setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { TillLockScreen } from "./screens/till-lock-screen.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillCounterWaiting } from "./widgets/counter-waiting.js";
import type { TillCancelCreditDialog } from "./widgets/cancel-credit-dialog.js";
import type { TillSupervisorOverrideDialog } from "./widgets/supervisor-override-dialog.js";
import type { CanvasDef } from "./layout.js";
import type { CounterWaitingOrder, TillApi, ZoneOfferCatalogue } from "./api/client.js";

// Cancel and credit on a counter order from the waiting list: invoiced when it was placed and not
// paid. The dialog and the cancel route are the table's.

const canvas: CanvasDef = {
  formFactor: "till",
  tabs: [
    {
      key: "counter",
      title: "Counter",
      columns: 12,
      cards: [
        { type: "product-grid", colSpan: 8, rowSpan: 4, config: {} },
        { type: "basket", colSpan: 4, rowSpan: 6, config: {} },
        { type: "held-orders", colSpan: 8, rowSpan: 2, config: {} },
      ],
    },
  ],
};

const till = {
  locale: "en",
  invoiceLocale: "es-ES",
  venueName: "Bar Pepe",
  nif: "B12345678",
  orderFlow: "ticket_then_pay" as const,
  receiptPrintMode: "auto" as const,
  bumpMode: "line" as const,
  fireControl: "waiter" as const,
  courses: [] as { id: string; name: string; displayOrder: number }[],
  cardProvider: "none" as const,
  tipsEnabled: false,
  canvas,
  capabilities: [],
  inactivityTimeoutSeconds: null as number | null,
  nodeId: "n1",
  servers: [],
};

const offers: ZoneOfferCatalogue = {
  context: {
    zoneId: "zone-counter",
    departmentId: "department-default",
    serviceMode: "ticket_then_pay",
  },
  defaultMenuId: null,
  menus: [],
  offers: [],
};

const notInvoiced: CounterWaitingOrder = {
  id: "wo-sent",
  orderNumber: 12,
  label: null,
  status: "placed",
  openedAt: "2026-10-01T10:02:00.000Z",
  settledAt: null,
  collectedAt: null,
  total: "7.50",
  canHandOver: true,
  serviceMode: "ticket_then_pay",
};
const invoiced: CounterWaitingOrder = { ...notInvoiced, invoiceNumber: "A/12" };

const kitchen = {
  id: "s-1",
  name: "Cocina",
  displayOrder: 1,
  isDefault: true,
  active: true,
  open: true,
};

let api: TillApi;

/** The server's side of the waiting list: `cancelOrder` takes the order off it unless it rejects. */
function waitingServer(cancel: () => Promise<void> = async () => {}) {
  let waiting: CounterWaitingOrder[] = [invoiced];
  return {
    listCounterWaiting: vi.fn(async () => waiting),
    cancelOrder: vi.fn(async () => {
      await cancel();
      waiting = [];
    }),
  };
}

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "en",
      loginDefault: "en",
    }),
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
    listStations: vi.fn().mockResolvedValue([kitchen]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    logout: vi.fn().mockResolvedValue(undefined),
    listCancelCreditAuthorizers: vi
      .fn()
      .mockResolvedValue([{ personId: "sup-1", displayName: "Luis" }]),
    ...waitingServer(),
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
const waitingList = (el: TillApp) =>
  counter(el)
    .shadowRoot!.querySelector("till-card-grid")!
    .shadowRoot!.querySelector<TillCounterWaiting>("till-counter-waiting");
const rowOf = (el: TillApp, id: string) =>
  waitingList(el)?.shadowRoot!.querySelector<HTMLElement>(`[data-waiting-order="${id}"]`) ?? null;
const offered = (el: TillApp) =>
  rowOf(el, "wo-sent")?.querySelector<HTMLElement>("[data-waiting-cancel-credit]") ?? null;
const dialog = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCancelCreditDialog>("till-cancel-credit-dialog");
const approval = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillSupervisorOverrideDialog>(
    "till-supervisor-override-dialog[data-cancel-credit-approval]",
  );
const bottom = (el: TillApp) =>
  dialog(el)!.shadowRoot!.querySelector<HTMLElement & { error: string }>("wt-form-actions")!.error;
const doneText = (el: TillApp) =>
  dialog(el)!
    .shadowRoot!.querySelector("[data-cancel-credit-done]")
    ?.textContent?.replace(/\s+/g, " ")
    .trim() ?? null;

/** Signs in on the counter, whose waiting list then shows the invoiced order. */
async function signedIn(overrides: Record<string, unknown> = {}): Promise<TillApp> {
  api = stubApi(overrides);
  const { el } = await mountWidget<TillApp>("till-app", { api });
  await flush(el);
  emit(lock(el)!, "logged-in", { personId: "p1", displayName: "Ana", permissions: [] });
  await flush(el);
  return el;
}

async function openCancel(overrides: Record<string, unknown> = {}): Promise<TillApp> {
  const el = await signedIn(overrides);
  offered(el)!.click();
  await flush(el);
  return el;
}

async function typeReason(el: TillApp, reason: string): Promise<void> {
  const input = dialog(el)!
    .shadowRoot!.querySelector('wt-input[name="reason"]')!
    .shadowRoot!.querySelector("input")!;
  input.value = reason;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await flush(el);
}

async function confirmCancel(el: TillApp): Promise<void> {
  dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-confirm]")!.click();
  await flush(el, 6);
}

beforeEach(() => setLocale("en"));
afterEach(cleanupWidgets);

describe("till-app: cancelling and crediting an invoiced counter order", () => {
  it("offers it on the waiting order, and opens naming its invoice and total, sending nothing yet", async () => {
    const el = await openCancel();

    expect(dialog(el)!.invoiceNumber).toBe("A/12");
    expect(dialog(el)!.amount).toBe("7.50");
    expect(dialog(el)!.fromCounter).toBe(true);
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });

  it("is not offered on an order not yet invoiced, nor on a paid one", async () => {
    const paid: CounterWaitingOrder = {
      ...invoiced,
      id: "wo-paid",
      status: "settled",
      settledAt: "2026-10-01T10:03:00.000Z",
      serviceMode: null,
    };
    const el = await signedIn({
      listCounterWaiting: vi.fn().mockResolvedValue([notInvoiced, paid]),
    });

    expect(rowOf(el, "wo-sent")).not.toBeNull();
    expect(rowOf(el, "wo-paid")).not.toBeNull();
    expect(waitingList(el)!.shadowRoot!.querySelector("[data-waiting-cancel-credit]")).toBeNull();
  });

  it("a request naming an order the list does not hold, or one not invoiced, or made while the dialog is open, opens nothing new", async () => {
    const el = await signedIn({
      listCounterWaiting: vi
        .fn()
        .mockResolvedValue([
          invoiced,
          { ...notInvoiced, id: "wo-2" },
          { ...invoiced, id: "wo-3", invoiceNumber: "A/13" },
        ]),
    });
    for (const id of ["wo-gone", "wo-2"]) {
      emit(waitingList(el)!, "cancel-credit-waiting-order", { id });
      await flush(el);
      expect(dialog(el)).toBeNull();
    }

    offered(el)!.click();
    await flush(el);
    emit(waitingList(el)!, "cancel-credit-waiting-order", { id: "wo-3" });
    await flush(el);

    expect(el.shadowRoot!.querySelectorAll("till-cancel-credit-dialog")).toHaveLength(1);
    expect(dialog(el)!.invoiceNumber).toBe("A/12");
  });

  it("Keep the bill closes the dialog and sends nothing", async () => {
    const el = await openCancel();

    const keep = dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-close]")!;
    expect(keep.textContent!.trim()).toBe(t("cancel_credit.keep"));
    keep.click();
    await expect.poll(() => dialog(el)).toBeNull();
    expect(api.cancelOrder).not.toHaveBeenCalled();
  });

  it("with the permission, sends the reason alone, says the credit note was issued, and the order leaves the list", async () => {
    const el = await openCancel();
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    const queueReads = vi.mocked(api.getStationQueue).mock.calls.length;

    await typeReason(el, "  Wrong order ");
    await confirmCancel(el);

    expect(vi.mocked(api.cancelOrder).mock.calls).toEqual([
      ["wo-sent", "Wrong order", undefined, { signal: expect.any(AbortSignal) }],
    ]);
    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads + 1);
    expect(api.getStationQueue).toHaveBeenCalledTimes(queueReads + 1);
    expect(rowOf(el, "wo-sent")).toBeNull();

    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-finished]")!.click();
    await flush(el);
    expect(dialog(el)).toBeNull();
  });

  it("clears an open basket for the cancelled order before a later list read answers", async () => {
    const el = await signedIn({
      retrievePlacedOrder: vi.fn().mockResolvedValue({
        id: "wo-sent",
        orderNumber: 12,
        label: null,
        revision: 2,
        lines: [
          {
            productId: "coffee",
            quantity: "1.000",
            product: {
              id: "coffee",
              name: "Coffee",
              customerName: { en: "Coffee" },
              pricingUnit: "each",
              unitPrice: "7.50",
              vatClass: "general",
              category: null,
              allergens: null,
            },
          },
        ],
      }),
    });
    emit(waitingList(el)!, "pay-waiting-order", { id: "wo-sent", serviceMode: "ticket_then_pay" });
    await flush(el);
    expect(counter(el).store.id).toBe("wo-sent");
    expect(counter(el).store.lineCount).toBe(1);
    expect(counter(el).stage).toBe("collect");

    expect(offered(el)).not.toBeNull();
    offered(el)!.click();
    await flush(el);
    expect(dialog(el)).not.toBeNull();
    await typeReason(el, "Wrong order");
    vi.mocked(api.getStationQueue).mockImplementation(() => new Promise(() => {}));
    await confirmCancel(el);

    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
    expect(counter(el).store.id).not.toBe("wo-sent");
    expect(counter(el).store.lineCount).toBe(0);
    expect(counter(el).stage).toBe("order");
  });

  it("does not load a cancelled order when its waiting-list Pay answer arrives late", async () => {
    let answer!: (order: unknown) => void;
    const el = await signedIn({
      retrievePlacedOrder: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    emit(waitingList(el)!, "pay-waiting-order", { id: "wo-sent", serviceMode: "ticket_then_pay" });
    await flush(el);
    expect(counter(el).store.editsLocked).toBe(true);

    offered(el)!.click();
    await flush(el);
    expect(dialog(el)).not.toBeNull();
    await typeReason(el, "Wrong order");
    await confirmCancel(el);
    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
    expect(counter(el).store.editsLocked).toBe(false);

    answer({
      id: "wo-sent",
      orderNumber: 12,
      label: null,
      revision: 2,
      lines: [],
    });
    await flush(el);
    expect(counter(el).store.id).not.toBe("wo-sent");
    expect(counter(el).store.lineCount).toBe(0);
    expect(counter(el).stage).toBe("order");
    expect(counter(el).store.editsLocked).toBe(false);
  });

  it("keeps a pending Pay load for a different order after the cancel", async () => {
    let answer!: (order: unknown) => void;
    const el = await signedIn({
      retrievePlacedOrder: vi.fn(() => new Promise((resolve) => (answer = resolve))),
    });
    emit(waitingList(el)!, "pay-waiting-order", {
      id: "wo-other",
      serviceMode: "ticket_then_pay",
    });
    await flush(el);
    offered(el)!.click();
    await flush(el);
    await typeReason(el, "Wrong order");
    await confirmCancel(el);

    answer({ id: "wo-other", orderNumber: 13, label: null, revision: 2, lines: [] });
    await flush(el);
    expect(counter(el).store.id).toBe("wo-other");
    expect(counter(el).stage).toBe("collect");
  });

  it("keeps a different basket when the waiting order is cancelled", async () => {
    const el = await openCancel();
    const store = counter(el).store;
    store.loadFrom("wo-other", [
      {
        product: {
          id: "coffee",
          name: "Coffee",
          customerName: { en: "Coffee" },
          pricingUnit: "each",
          unitPrice: "7.50",
          vatClass: "general",
          category: null,
          allergens: null,
        },
        quantity: "1",
      },
    ]);
    await typeReason(el, "Wrong order");
    await confirmCancel(el);

    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
    expect(store.id).toBe("wo-other");
    expect(store.lineCount).toBe(1);
  });

  it.each([
    ["kitchen queue", "station", "refresh.station_after_cancel"],
    ["waiting list", "waiting", "refresh.waiting_after_cancel"],
  ] as const)(
    "a %s that cannot be read after the cancel says the order was cancelled and credited, and the dialog still says so",
    async (_list, notice, key) => {
      const el = await openCancel();
      const failing = notice === "station" ? api.getStationQueue : api.listCounterWaiting;
      vi.mocked(failing).mockRejectedValue(new TypeError("Failed to fetch"));
      await typeReason(el, "Wrong order");

      await confirmCancel(el);

      expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
      const shown = el.shadowRoot!.querySelector<HTMLElement>(`[data-refresh-notice="${notice}"]`)!;
      expect(shown.textContent).toContain(t(key));
    },
  );

  it("without the permission, asks someone who may issue credit notes for their PIN and sends it with the same reason", async () => {
    let refuse = true;
    const server = waitingServer(async () => {
      if (refuse) {
        refuse = false;
        throw { code: "authorization.not_permitted", status: 403 };
      }
    });
    const el = await openCancel(server);

    await typeReason(el, "Wrong order");
    await confirmCancel(el);

    expect(api.listCancelCreditAuthorizers).toHaveBeenCalledOnce();
    expect(approval(el)!.authorizers).toEqual([{ personId: "sup-1", displayName: "Luis" }]);
    emit(approval(el)!, "override-confirm", { personId: "sup-1", pin: "4321" });
    await flush(el, 6);

    expect(server.cancelOrder.mock.calls[1]).toEqual([
      "wo-sent",
      "Wrong order",
      { personId: "sup-1", pin: "4321" },
      { signal: expect.any(AbortSignal) },
    ]);
    expect(approval(el)).toBeNull();
    expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
    expect(rowOf(el, "wo-sent")).toBeNull();
  });

  it("shows a wrong PIN in the PIN prompt, and sends nothing more", async () => {
    let sends = 0;
    const server = waitingServer(async () => {
      sends++;
      throw sends === 1
        ? { code: "authorization.not_permitted", status: 403 }
        : { code: "pin.invalid", status: 401 };
    });
    const el = await openCancel(server);
    await typeReason(el, "Wrong order");
    await confirmCancel(el);

    emit(approval(el)!, "override-confirm", { personId: "sup-1", pin: "0000" });
    await flush(el, 6);

    expect(server.cancelOrder).toHaveBeenCalledTimes(2);
    expect(approval(el)!.error).toBe("pin.invalid");
    expect(doneText(el)).toBeNull();
  });

  it.each([
    ["bill.payments_received", t("cancel_credit.refused_payments")],
    ["working_order.not_placed", codeMessage("working_order.not_placed")],
    ["series.no_rectificative_for_node", codeMessage("series.no_rectificative_for_node")],
  ])(
    "keeps the dialog open with %s's sentence, and reads the waiting list again",
    async (code, sentence) => {
      const server = waitingServer(async () => {
        throw { code, status: 409 };
      });
      const el = await openCancel(server);
      const waitingReads = server.listCounterWaiting.mock.calls.length;
      await typeReason(el, "Wrong order");

      await confirmCancel(el);

      expect(server.cancelOrder).toHaveBeenCalledOnce();
      expect(bottom(el)).toBe(sentence);
      expect(doneText(el)).toBeNull();
      expect(server.listCounterWaiting).toHaveBeenCalledTimes(waitingReads + 1);
    },
  );

  it("when the cancel got no answer, says it may have been made and to check the waiting orders, without sending it again", async () => {
    const server = waitingServer();
    server.cancelOrder.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const el = await openCancel(server);
    await typeReason(el, "Wrong order");

    await confirmCancel(el);

    expect(server.cancelOrder).toHaveBeenCalledOnce();
    expect(bottom(el)).toBe(t("cancel_credit.unconfirmed_counter"));
    expect(doneText(el)).toBeNull();
  });

  it("an answer arriving after the operator signed out opens nothing for the next one", async () => {
    let answer: () => void = () => undefined;
    const server = waitingServer(() => new Promise<void>((resolve) => (answer = resolve)));
    const el = await openCancel(server);
    await typeReason(el, "Wrong order");
    await confirmCancel(el);
    emit(counter(el), "logout");
    await flush(el);
    expect(dialog(el)).toBeNull();
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
    await flush(el);

    answer();
    await flush(el, 6);

    expect(dialog(el)).toBeNull();
  });

  it.each([
    ["kitchen queue", "station"],
    ["waiting list", "waiting"],
  ] as const)(
    "says the cancel was made, and frees the dialog, while the %s read after it never answers",
    async (_list, held) => {
      const el = await openCancel();
      const never = () => new Promise<never>(() => {});
      if (held === "station") vi.mocked(api.getStationQueue).mockImplementation(never);
      else vi.mocked(api.listCounterWaiting).mockImplementation(never);
      await typeReason(el, "Wrong order");

      await confirmCancel(el);

      expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
      expect(dialog(el)!.busy).toBe(false);
      dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-finished]")!.click();
      await flush(el);
      expect(dialog(el)).toBeNull();
    },
  );

  it("shows a refusal, and frees the dialog, while the waiting list read after it never answers", async () => {
    const server = waitingServer(async () => {
      throw { code: "working_order.not_placed", status: 409 };
    });
    const el = await openCancel(server);
    const waitingReads = server.listCounterWaiting.mock.calls.length;
    server.listCounterWaiting.mockImplementation(() => new Promise(() => {}));
    await typeReason(el, "Wrong order");

    await confirmCancel(el);

    expect(bottom(el)).toBe(codeMessage("working_order.not_placed"));
    expect(dialog(el)!.busy).toBe(false);
    expect(server.listCounterWaiting).toHaveBeenCalledTimes(waitingReads + 1);
  });

  it("a kitchen queue read answered after the operator signed out reads nothing, and says nothing, for the next one", async () => {
    const el = await openCancel();
    let releaseQueue: () => void = () => undefined;
    vi.mocked(api.getStationQueue).mockImplementationOnce(
      () =>
        new Promise(
          (resolve) => (releaseQueue = () => resolve({ printersDown: [], items: [], notices: [] })),
        ),
    );
    await typeReason(el, "Wrong order");
    await confirmCancel(el);
    emit(counter(el), "logout");
    await flush(el);
    emit(lock(el)!, "logged-in", { personId: "p2", displayName: "Sam", permissions: [] });
    await flush(el, 6);
    expect(lock(el)).toBeNull();
    const waitingReads = vi.mocked(api.listCounterWaiting).mock.calls.length;
    vi.mocked(api.listCounterWaiting).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    releaseQueue();
    await flush(el, 6);

    expect(api.listCounterWaiting).toHaveBeenCalledTimes(waitingReads);
    expect(el.shadowRoot!.querySelector('[data-refresh-notice="waiting"][data-active]')).toBeNull();
  });

  it("opens nothing while the basket's own order is being parked", async () => {
    const el = await signedIn({ parkOrder: vi.fn(() => new Promise(() => {})) });
    emit(counter(el), "park-order", { label: "Mesa 4" });
    await flush(el);
    expect(api.parkOrder).toHaveBeenCalledOnce();

    offered(el)!.click();
    await flush(el);

    expect(dialog(el)).toBeNull();
  });
});

for (const action of ["Keep the bill", "Escape"]) {
  it(`counter cancel-credit ${action} preserves the waiting order and basket through local Discard`, async () => {
    const el = await openCancel();
    const store = counter(el).store;
    store.loadFrom("wo-other", [
      {
        product: {
          id: "coffee",
          name: "Coffee",
          customerName: { en: "Coffee" },
          pricingUnit: "each",
          unitPrice: "7.50",
          vatClass: "general",
          category: null,
          allergens: null,
        },
        quantity: "1",
      },
    ]);
    await typeReason(el, "  Wrong table  ");
    if (action === "Escape") {
      dialog(el)!
        .shadowRoot!.querySelector("wt-input")!
        .shadowRoot!.querySelector("input")!
        .focus();
      await userEvent.keyboard("{Escape}");
    } else
      dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();
    await flush(el);
    const q = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await q.updateComplete;
    expect(q.open).toBe(true);
    expect(api.cancelOrder).not.toHaveBeenCalled();
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!.click();
    await expect.poll(() => q.open).toBe(false);
    expect(dialog(el)!.shadowRoot!.querySelector("wt-input")!.value).toBe("  Wrong table  ");
    dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-close]")!.click();
    await flush(el);
    q.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!.click();
    await expect.poll(() => dialog(el)).toBeNull();
    expect(rowOf(el, "wo-sent")).not.toBeNull();
    expect(store.id).toBe("wo-other");
    expect(store.lineCount).toBe(1);
    expect(store.total).toBe("7.50");
    expect(api.cancelOrder).not.toHaveBeenCalled();
    expect(api.listCancelCreditAuthorizers).not.toHaveBeenCalled();
  });
}

it("an accepted counter credit clears unload protection before its queue refresh starts", async () => {
  const el = await openCancel();
  await typeReason(el, "  Wrong table  ");
  let protectedAtRefresh: boolean | undefined;
  vi.mocked(api.getStationQueue).mockImplementation(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    protectedAtRefresh = event.defaultPrevented;
    return new Promise(() => {});
  });
  await confirmCancel(el);
  expect(protectedAtRefresh).toBe(false);
  expect(vi.mocked(api.cancelOrder).mock.calls).toEqual([
    ["wo-sent", "Wrong table", undefined, { signal: expect.any(AbortSignal) }],
  ]);
  expect(doneText(el)).toBe(t("cancel_credit.done_unnumbered"));
  dialog(el)!.shadowRoot!.querySelector<HTMLElement>("[data-cancel-credit-finished]")!.click();
  await expect.poll(() => dialog(el)).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
});

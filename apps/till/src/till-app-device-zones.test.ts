import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceZoneSelection } from "@waitron/venue-service";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, draftServer, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { TillApi, FloorZone, ZoneOfferCatalogue } from "./api/client.js";
import type { TillShell } from "./widgets/till-shell.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import { SessionActivity } from "./session-activity.js";
import { TillApp } from "./till-app.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

const zones: DeviceZoneSelection["zones"] = [
  {
    id: "bar",
    name: "Bar",
    departmentId: "department",
    departmentName: "Restaurant",
    serviceMode: "prepay",
  },
  {
    id: "shop",
    name: "Shop",
    departmentId: "department",
    departmentName: "Restaurant",
    serviceMode: "ticket_then_pay",
  },
  {
    id: "room",
    name: "Room",
    departmentId: "department",
    departmentName: "Restaurant",
    serviceMode: "table_tab",
  },
  {
    id: "garden",
    name: "Garden",
    departmentId: "department",
    departmentName: "Restaurant",
    serviceMode: "table_tab",
  },
];
const selection = (ids: string[], start: string | null, saved = true): DeviceZoneSelection => ({
  profileId: "profile",
  snapshot: "scope",
  zones,
  selectedZoneIds: ids,
  startingZoneId: start,
  adjusted: false,
  saved,
});
const floorZones: FloorZone[] = zones.map((zone) => ({
  ...zone,
  displayOrder: 0,
  active: true,
  closed: false,
  closesAt: null,
  hasPlan: false,
  layoutSetName: null,
  layoutDue: null,
}));
const catalogue = (id: string): ZoneOfferCatalogue => ({
  service: {
    open: true,
    zoneOpen: true,
    periodName: null,
    periodOccurrenceKey: null,
    keepOpen: null,
    zoneKeepOpen: null,
  },
  context: {
    zoneId: id,
    serviceMode: zones.find((zone) => zone.id === id)!.serviceMode,
    departmentId: "department",
    departmentName: "Restaurant",
  },
  zones: zones.map((zone) => ({
    ...zone,
    departmentId: "department",
    departmentName: "Restaurant",
  })),
  defaultMenuId: "menu",
  menus: servedMenus(
    [{ id: "menu", name: "Drinks", isDefault: true, versionId: "version" }],
    [{ id: "coffee-offer", menuId: "menu", productId: "coffee" }],
  ),
  offers: [
    {
      id: "coffee-offer",
      menuId: "menu",
      productId: "coffee",
      grossPrice: "2.00",
      unitPrice: "2.00",
      available: true,
      image: null,
      description: null,
      menuName: "Drinks",
      placements: [[]],
      name: "Coffee",
      customerName: { en: "Customer coffee" },
      kitchenName: "Kitchen coffee",
      unit: {
        staffName: "Staff unit",
        staffAbbreviation: "su",
        id: "each",
        name: { en: "each" },
        abbreviation: { en: "ea" },
        precision: 0,
        hardwareUnit: null,
      },
      vatClass: "general",
      category: null,
      allergens: null,
      diet: null,
      dietDerivation: null,
      dietOverride: null,
      dietaryDeclarations: [],
      courseId: null,
      offeredModifiers: [],
      variants: [],
    },
  ],
});

async function mount(
  chosen: DeviceZoneSelection,
  over: Record<string, unknown> = {},
  props: Partial<TillApp> = {},
  permissions: string[] = [],
) {
  setLocale("en-GB");
  const api = {
    getLocales: vi
      .fn()
      .mockResolvedValue({ locales: [{ code: "en-GB", label: "English" }], venueDefault: "en-GB" }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
    getTill: vi.fn().mockResolvedValue({
      locale: "en-GB",
      invoiceLocale: "en-GB",
      venueName: "Restaurant",
      nif: "B12345678",
      orderFlow: "prepay",
      fireControl: "waiter",
      courses: [],
      cardProvider: "none",
      tipsEnabled: false,
      formFactor: "till",
      capabilities: ["take-orders"],
      inactivityTimeoutSeconds: null,
      nodeId: "node",
      servers: [],
    }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "device",
      name: "Till",
      formFactor: "till",
      profileId: "profile",
    }),
    getDeviceZones: vi.fn().mockResolvedValue(chosen),
    setDeviceZones: vi.fn().mockResolvedValue(chosen),
    listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue(chosen.startingZoneId ?? "bar")),
    listZoneOffers: vi.fn(async (id: string) => catalogue(id)),
    setServiceZone: vi.fn(),
    listStaff: vi.fn().mockResolvedValue([]),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    listSentDepartmentTransfers: vi.fn().mockResolvedValue({ requests: [] }),
    getTablesState: vi.fn().mockResolvedValue([]),
    listZones: vi.fn().mockResolvedValue(floorZones),
    logout: vi.fn().mockResolvedValue(undefined),
    putLocale: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
  const { el } = await mountWidget<TillApp>("till-app", {
    api: api as unknown as TillApi,
    ...props,
  });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
  el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
    new CustomEvent("logged-in", {
      detail: { personId: "person", displayName: "Ana", permissions, locale: "en-GB" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-shell")).not.toBeNull());
  await el.updateComplete;
  return { el, api };
}
const shell = (el: TillApp) => el.shadowRoot!.querySelector<TillShell>("till-shell")!;
const counter = (el: TillApp) =>
  el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen");

describe("live device zones", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
  afterEach(() => vi.useRealTimers());
  async function tick(el: TillApp) {
    vi.advanceTimersByTime(15_000);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await el.updateComplete;
    }
  }
  const emit = (source: Element, type: string, detail?: unknown) =>
    source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));

  it.each(["floor-only", "empty"])(
    "recovers a %s device without needing a counter poll",
    async (kind) => {
      const chosen =
        kind === "empty" ? { ...selection([], null), zones: [] } : selection(["room"], "room");
      const { el, api } = await mount(chosen);
      api.getDeviceZones.mockResolvedValue({
        ...selection(["bar", "room"], "bar"),
        snapshot: "restored",
      });
      await tick(el);
      expect(shell(el).counterZones.map((zone) => zone.id)).toEqual(["bar"]);
      expect(api.getDeviceZones.mock.calls[1]?.[0]?.signal).toBeInstanceOf(AbortSignal);
      expect(api.setDeviceZones).not.toHaveBeenCalled();
      expect(api.listDefaultZoneOffers).not.toHaveBeenCalled();
    },
  );

  it("narrows an idle Counter to Floor and restores retained counters on a later snapshot", async () => {
    const { el, api } = await mount(selection(["bar", "room"], "bar"));
    api.getDeviceZones.mockResolvedValue({ ...selection(["room"], "room"), snapshot: "narrow" });
    await tick(el);
    expect(counter(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-floor-screen")!.zones.map((zone) => zone.id)).toEqual(
      ["room"],
    );
    api.getDeviceZones.mockResolvedValue({
      ...selection(["bar", "room"], "bar"),
      snapshot: "restored",
    });
    await tick(el);
    expect(shell(el).counterZones.map((zone) => zone.id)).toEqual(["bar"]);
    expect(api.setServiceZone).toHaveBeenCalledExactlyOnceWith("bar");
  });

  it("retains a narrowed basket's identity and prices, refuses new picks, and reconciles after clearing", async () => {
    const { el, api } = await mount(selection(["bar", "room"], "bar"));
    const store = counter(el)!.store;
    const product = counter(el)!.products[0]!;
    store.addProduct(product, "1");
    const id = store.id;
    api.getDeviceZones.mockResolvedValue({ ...selection(["room"], "room"), snapshot: "narrow" });
    await tick(el);
    expect(counter(el)?.store).toBe(store);
    expect(counter(el)?.selectedServiceZoneId).toBe("bar");
    expect(store.id).toBe(id);
    expect(
      el.shadowRoot!.querySelector("[data-device-zones-pending]")?.textContent ?? "",
    ).toContain("Park, send or cancel this order");
    store.addProduct(product, "1");
    expect(
      store.lines.map((line) => [line.product.productId, line.quantity, line.product.unitPrice]),
    ).toEqual([["coffee", "1", "2.00"]]);
    expect(api.setServiceZone).toHaveBeenCalledExactlyOnceWith("bar");
    expect(api.setDeviceZones).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent ?? "").not.toContain(
      "Last orders have ended",
    );
    store.clear();
    await el.updateComplete;
    expect(counter(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull();
  });

  it("defers zone navigation while the payment submission flag is active", async () => {
    const cancelCardPayment = vi.fn();
    const recordSale = vi.fn();
    const { el, api } = await mount(selection(["bar", "room"], "bar"), {
      cancelCardPayment,
      recordSale,
    });
    const store = counter(el)!.store;
    Object.assign(el, { submitting: true });
    api.getDeviceZones.mockResolvedValue({ ...selection(["room"], "room"), snapshot: "narrow" });
    await tick(el);
    expect(counter(el)?.store).toBe(store);
    expect(counter(el)?.selectedServiceZoneId).toBe("bar");
    expect(api.setServiceZone).toHaveBeenCalledExactlyOnceWith("bar");
    expect(cancelCardPayment).not.toHaveBeenCalled();
    expect(recordSale).not.toHaveBeenCalled();
    Object.assign(el, { submitting: false });
    await tick(el);
    expect(counter(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull();
  });

  it("drops the departed operator's pending scope before allowing the new operator's zone", async () => {
    const { el, api } = await mount(selection(["bar", "shop"], "bar"));
    const store = counter(el)!.store;
    const product = counter(el)!.products[0]!;
    store.addProduct(product, "1");
    api.getDeviceZones.mockResolvedValue({
      ...selection(["shop"], "shop"),
      snapshot: "old-pending",
    });
    await tick(el);
    expect(counter(el)!.selectedServiceZoneId).toBe("bar");
    store.setLineQuantity(0, "2");
    expect(store.lines[0]?.quantity).toBe("1");
    emit(counter(el)!, "logout");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
    api.getDeviceZones.mockResolvedValue({
      ...selection(["bar"], "bar"),
      profileId: "new-profile",
      snapshot: "new-session",
    });
    emit(el.shadowRoot!.querySelector("till-lock-screen")!, "logged-in", {
      personId: "other-person",
      displayName: "Diego",
      permissions: [],
      locale: "en-GB",
    });
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-shell")).not.toBeNull());
    await el.updateComplete;
    store.setLineQuantity(0, "2");
    expect(
      store.lines.map((line) => [line.product.productId, line.quantity, line.product.unitPrice]),
    ).toEqual([["coffee", "2", "2.00"]]);
    expect(shell(el).counterZones.map((zone) => zone.id)).toEqual(["bar"]);
    expect(counter(el)!.selectedServiceZoneId).toBe("bar");
    expect(api.setDeviceZones).not.toHaveBeenCalled();
  });

  it("retains a real card request and its decline through live narrowing until the order clears", async () => {
    let answer!: (outcome: { outcome: "declined"; failureReason: string }) => void;
    const pending = new Promise<{ outcome: "declined"; failureReason: string }>((resolve) => {
      answer = resolve;
    });
    const pay = vi.fn<TillApi["pay"]>(() => pending);
    const cancelCardPayment = vi.fn();
    const recordSale = vi.fn();
    const { el, api } = await mount(selection(["bar", "room"], "bar"), {
      pay,
      cancelCardPayment,
      recordSale,
    });
    const screen = counter(el)!;
    const store = screen.store;
    store.addProduct(screen.products[0]!, "1");
    const id = store.id;
    emit(screen, "collect-card", { readerId: "reader-original" });
    await tick(el);
    expect(pay).toHaveBeenCalledOnce();
    const submitted = structuredClone(pay.mock.calls[0]);
    expect(submitted?.[0]).toMatchObject({ id, readerId: "reader-original" });
    api.getDeviceZones.mockResolvedValue({ ...selection(["room"], "room"), snapshot: "narrow" });
    await tick(el);
    expect(counter(el)).toBe(screen);
    expect(store.id).toBe(id);
    expect(screen.selectedServiceZoneId).toBe("bar");
    expect(pay.mock.calls).toEqual([submitted]);
    expect(cancelCardPayment).not.toHaveBeenCalled();
    expect(api.setServiceZone).toHaveBeenCalledExactlyOnceWith("bar");
    answer({ outcome: "declined", failureReason: "insufficient_funds" });
    await pending;
    await tick(el);
    expect(counter(el)).toBe(screen);
    expect(store.id).toBe(id);
    expect(
      store.lines.map((line) => [line.product.productId, line.quantity, line.product.unitPrice]),
    ).toEqual([["coffee", "1", "2.00"]]);
    expect(screen.cardOutcome).toEqual({
      outcome: "declined",
      failureReason: "insufficient_funds",
    });
    expect(pay).toHaveBeenCalledOnce();
    expect(cancelCardPayment).not.toHaveBeenCalled();
    expect(recordSale).not.toHaveBeenCalled();
    store.clear();
    await el.updateComplete;
    expect(counter(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull();
  });

  it("keeps the latest scope through a transient read failure and retries on the next tick", async () => {
    const { el, api } = await mount(selection(["bar", "room"], "bar"));
    api.getDeviceZones.mockRejectedValueOnce(new TypeError("offline"));
    await tick(el);
    expect(counter(el)!.selectedServiceZoneId).toBe("bar");
    api.getDeviceZones.mockResolvedValue({ ...selection(["room"], "room"), snapshot: "narrow" });
    await tick(el);
    expect(counter(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull();
  });

  it("aborts a disconnected read and refuses its late scope after reconnecting", async () => {
    let answer!: (value: DeviceZoneSelection) => void;
    const { el, api } = await mount(selection(["bar", "room"], "bar"));
    api.getDeviceZones.mockImplementationOnce(
      () =>
        new Promise<DeviceZoneSelection>((resolve) => {
          answer = resolve;
        }),
    );
    await tick(el);
    expect(api.getDeviceZones).toHaveBeenCalledTimes(2);
    const signal = api.getDeviceZones.mock.calls[1]![0]!.signal as AbortSignal;
    const parent = el.parentElement!;
    el.remove();
    expect(signal.aborted).toBe(true);
    parent.append(el);
    answer({ ...selection(["room"], "room"), snapshot: "old" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(counter(el)!.selectedServiceZoneId).toBe("bar");
  });

  it("an old poll cannot overwrite a successful own save or repaint its newer editor", async () => {
    let answer!: (value: DeviceZoneSelection) => void;
    const chosen = selection(["bar", "room"], "bar");
    const { el, api } = await mount(chosen, {
      setDeviceZones: vi.fn().mockResolvedValue(selection(["bar", "room"], "room")),
    });
    api.getDeviceZones.mockImplementationOnce(
      () =>
        new Promise<DeviceZoneSelection>((resolve) => {
          answer = resolve;
        }),
    );
    await tick(el);
    expect(api.getDeviceZones).toHaveBeenCalledTimes(2);
    const dialog = await openZones(el);
    emit(dialog, "save-device-zones", {
      profileId: "profile",
      snapshot: "scope",
      selectedZoneIds: ["bar", "room"],
      startingZoneId: "room",
    });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-device-zones-dialog")).toBeNull(),
    );
    answer({ ...selection(["shop"], "shop"), snapshot: "old" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(shell(el).counterZones.map((zone) => zone.id)).toEqual(["bar"]);
    expect(counter(el)!.selectedServiceZoneId).toBe("bar");
    expect(api.setDeviceZones).toHaveBeenCalledOnce();
  });

  it("reads changed profile capabilities before applying the matching navigation snapshot", async () => {
    const { el, api } = await mount(selection(["bar", "room"], "bar"));
    const setup = await api.getTill.mock.results[0]!.value;
    api.getTill.mockResolvedValue({ ...setup, capabilities: [] });
    api.getDeviceZones.mockResolvedValue({
      ...selection(["room"], "room"),
      snapshot: "capabilities-changed",
    });
    await tick(el);
    expect(api.getTill).toHaveBeenCalledTimes(2);
    expect(counter(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-floor-screen")!.canChangeToday).toBe(false);
  });

  it("blocks new picks while a changed profile setup is unavailable, and recovers without losing its basket", async () => {
    const { el, api } = await mount(selection(["bar", "room"], "bar"));
    const setup = await api.getTill.mock.results[0]!.value;
    const store = counter(el)!.store;
    const product = counter(el)!.products[0]!;
    store.addProduct(product, "1");
    api.getTill.mockRejectedValueOnce(new TypeError("offline"));
    api.getDeviceZones.mockResolvedValue({ ...selection(["room"], "room"), snapshot: "narrow" });
    await tick(el);
    store.addProduct(product, "1");
    expect(
      store.lines.map((line) => [line.product.productId, line.quantity, line.product.unitPrice]),
    ).toEqual([["coffee", "1", "2.00"]]);
    api.getTill.mockResolvedValue(setup);
    await tick(el);
    store.clear();
    await el.updateComplete;
    expect(counter(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull();
  });

  it("does not reload unchanged profile setup and does not replace an action's refusal", async () => {
    const { el, api } = await mount(selection(["bar", "room"], "bar"));
    Object.assign(el, { errorKey: "service_zone.basket_active" });
    await tick(el);
    await tick(el);
    expect(api.getDeviceZones).toHaveBeenCalledTimes(3);
    expect(api.getTill).toHaveBeenCalledOnce();
    expect(el.shadowRoot!.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      "Clear the basket before changing service area",
    );
  });

  it("applies a changed profile's inactivity limit when its scope can reconcile", async () => {
    const activity = new SessionActivity();
    const configure = vi.spyOn(activity, "configure");
    const { el, api } = await mount(
      selection(["bar", "room"], "bar"),
      {},
      { sessionActivity: activity },
    );
    const setup = await api.getTill.mock.results[0]!.value;
    api.getTill.mockResolvedValue({ ...setup, inactivityTimeoutSeconds: 45 });
    api.getDeviceZones.mockResolvedValue({
      ...selection(["room"], "room"),
      snapshot: "new-idle-limit",
    });
    await tick(el);
    expect(counter(el)).toBeNull();
    expect(configure.mock.calls.at(-1)![0]).toMatchObject({ loggedIn: true, timeoutSeconds: 45 });
  });

  it("a background scope change with an unchanged idle limit does not count as activity", async () => {
    const activity = new SessionActivity();
    const configure = vi.spyOn(activity, "configure");
    const { el, api } = await mount(
      selection(["bar", "room"], "bar"),
      {},
      { sessionActivity: activity },
    );
    const calls = configure.mock.calls.length;
    api.getDeviceZones.mockResolvedValue({ ...selection(["room"], "room"), snapshot: "narrow" });
    await tick(el);
    expect(counter(el)).toBeNull();
    expect(configure).toHaveBeenCalledTimes(calls);
  });

  it("a live snapshot invalidates the open editor's scope without changing its draft", async () => {
    const { el, api } = await mount(selection(["bar", "room"], "bar"));
    const dialog = await openZones(el);
    await userEvent.click(
      dialog.shadowRoot!.querySelector<HTMLInputElement>(
        'input[name="starting-zone"][value="room"]',
      )!,
    );
    const changed = { ...selection(["bar"], "bar"), zones: [zones[0]!], snapshot: "narrow" };
    api.getDeviceZones.mockResolvedValue(changed);
    await tick(el);
    expect(dialog.selection?.snapshot).toBe("narrow");
    expect(dialog.shadowRoot!.querySelector("wt-form-actions")!.error).not.toBe("");
    expect(
      dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-zones-save]")!
        .disabled,
    ).toBe(true);
    expect(api.setDeviceZones).not.toHaveBeenCalled();
  });

  it("a narrowed table keeps its real draft and bill while refusing new product picks", async () => {
    const drafts = draftServer(() => ({ tabId: "bill", revision: 1, groups: [] }));
    drafts.bills.add("bill");
    const table = {
      id: "table",
      label: "1",
      zoneId: "room",
      state: "open-tab",
      hasOpenTab: true,
      tabLineCount: 0,
      tabTotal: "0.00",
      pendingDeliveries: 0,
      pendingToServe: 0,
      readyToServe: 0,
      timingBand: "fresh",
      nextReservation: null,
      today: null,
      signals: [],
      party: {
        kitchenNote: { scope: { partyId: "party" }, note: null, revision: 0, ownerRevision: 1 },
        id: "party",
        revision: 1,
        guestCount: 2,
        state: "open",
        mainBillId: "bill",
        outstanding: "0.00",
        billCount: 1,
        tableIds: ["table"],
        unsentDrafts: [],
        reminder: null,
      },
    };
    const { el, api } = await mount(selection(["bar", "room"], "room"), {
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue("bar")),
      getTablesState: vi.fn().mockResolvedValue([table]),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
      listGroups: vi.fn().mockResolvedValue({ revision: 1, groups: [] }),
      getPartyBills: vi.fn().mockResolvedValue([]),
      listDrafts: drafts.listDrafts,
      saveDraft: drafts.saveDraft,
      submitDraft: drafts.submitDraft,
    });
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector("till-floor-screen")!.tables.map((row) => row.id),
      ).toEqual(["table"]),
    );
    emit(el.shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "table",
      seated: true,
    });
    const screen = () => el.shadowRoot!.querySelector("till-table-order-screen")!;
    await vi.waitFor(() => expect(screen()?.draftStore).toBeTruthy());
    const store = screen().draftStore!;
    const product = screen().products[0]!;
    store.addProduct(product, "1");
    await el.updateComplete;
    api.getDeviceZones.mockResolvedValue({ ...selection(["bar"], "bar"), snapshot: "narrow" });
    await tick(el);
    expect(screen().draftStore).toBe(store);
    expect(screen().orderId).toBe("bill");
    expect(screen().party?.id).toBe("party");
    expect(screen().zoneId).toBe("room");
    store.addProduct(product, "1");
    expect(
      store.lines.map((line) => [line.product.productId, line.quantity, line.product.unitPrice]),
    ).toEqual([["coffee", "1", "2.00"]]);
    expect(drafts.submitDraft).not.toHaveBeenCalled();
    expect(api.setDeviceZones).not.toHaveBeenCalled();
  });
});

it("a table-only device starts on Floor and never asks for an unrestricted counter", async () => {
  const { el, api } = await mount(selection(["room"], "room"));
  expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull();
  expect(counter(el)).toBeNull();
  expect(api.getDeviceZones).toHaveBeenCalledOnce();
  expect(api.listDefaultZoneOffers).not.toHaveBeenCalled();
  expect(api.listZoneOffers).not.toHaveBeenCalled();
  expect(
    [...shell(el).shadowRoot!.querySelectorAll('[role="tab"]')].map((e) => e.textContent!.trim()),
  ).toEqual(["Floor"]);
  const floor = el.shadowRoot!.querySelector("till-floor-screen")!;
  expect(floor.zones.map((zone) => zone.id)).toEqual(["room"]);
});

it("an empty scope mounts no selling screen and offers a recoverable explanation", async () => {
  const { el, api } = await mount({ ...selection([], null), zones: [] });
  expect(counter(el)).toBeNull();
  expect(el.shadowRoot!.querySelector("till-floor-screen")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-device-zones-empty]")?.textContent).toContain(
    "no area",
  );
  expect(el.shadowRoot!.querySelector("[data-retry-device-zones]")).not.toBeNull();
  expect(api.listDefaultZoneOffers).not.toHaveBeenCalled();
  expect(api.setServiceZone).not.toHaveBeenCalled();
});

it("shows the selected counters in the header and filters Floor independently of transfer metadata", async () => {
  const { el, api } = await mount(selection(["bar", "shop", "garden"], "shop"));
  expect(counter(el)?.selectedServiceZoneId).toBe("shop");
  expect(shell(el).counterZones.map((zone) => zone.id)).toEqual(["bar", "shop"]);
  expect(shell(el).shadowRoot!.textContent).toContain("Counter: Shop");
  expect(counter(el)!.shadowRoot!.querySelector(".service-zone")).toBeNull();
  const floorButton = [...shell(el).shadowRoot!.querySelectorAll<HTMLButtonElement>(".tab")].find(
    (e) => e.textContent!.trim() === "Floor",
  )!;
  await userEvent.click(page.elementLocator(floorButton));
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull());
  const floor = el.shadowRoot!.querySelector("till-floor-screen")!;
  expect(floor.zones.map((zone) => zone.id)).toEqual(["garden"]);
  expect(api.listZones).toHaveBeenCalled();
});

it("a forged Counter selection cannot leave a table-only screen", async () => {
  const { el, api } = await mount(selection(["room"], "room"));
  shell(el).dispatchEvent(
    new CustomEvent("screen-select", {
      detail: { screen: "counter" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(counter(el)).toBeNull();
  expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull();
  expect(api.listDefaultZoneOffers).not.toHaveBeenCalled();
});

it("a Counter zone click is refused with basket lines and during a submitted action", async () => {
  const { el, api } = await mount(selection(["bar", "shop"], "bar"));
  const store = counter(el)!.store!;
  store.addProduct(counter(el)!.products[0]!, "1");
  shell(el).dispatchEvent(
    new CustomEvent("counter-zone-selected", {
      detail: { zoneId: "shop" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(counter(el)!.selectedServiceZoneId).toBe("bar");
  expect(store.lines).toHaveLength(1);
  expect(api.listZoneOffers).not.toHaveBeenCalled();
  store.clear();
  Object.assign(el, { submitting: true });
  shell(el).dispatchEvent(
    new CustomEvent("counter-zone-selected", {
      detail: { zoneId: "shop" },
      bubbles: true,
      composed: true,
    }),
  );
  await el.updateComplete;
  expect(counter(el)!.selectedServiceZoneId).toBe("bar");
  expect(api.listZoneOffers).not.toHaveBeenCalled();
});

it("choosing a Counter zone from Floor opens Counter once and closes its checked list", async () => {
  const { el, api } = await mount(selection(["bar", "shop", "room"], "room"), {
    listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue("bar")),
  });
  expect(counter(el)).toBeNull();
  const menu = shell(el).shadowRoot!.querySelector<HTMLElement>("[data-counter-zones]")!;
  await (menu as TillShell).updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(menu.querySelector<HTMLElement>('[data-counter-zone="shop"]')!);
  await vi.waitFor(() => expect(counter(el)?.selectedServiceZoneId).toBe("shop"));
  expect(api.listZoneOffers).toHaveBeenCalledExactlyOnceWith("shop");
  expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
});

it("a line added while a zone read is pending keeps the original zone and price", async () => {
  let answer!: (value: ZoneOfferCatalogue) => void;
  const pending = new Promise<ZoneOfferCatalogue>((resolve) => {
    answer = resolve;
  });
  const { el, api } = await mount(selection(["bar", "shop"], "bar"), {
    listZoneOffers: vi.fn(() => pending),
  });
  shell(el).dispatchEvent(
    new CustomEvent("counter-zone-selected", {
      detail: { zoneId: "shop" },
      bubbles: true,
      composed: true,
    }),
  );
  expect(api.listZoneOffers).toHaveBeenCalledOnce();
  const store = counter(el)!.store!;
  store.addProduct(counter(el)!.products[0]!, "1");
  answer(catalogue("shop"));
  await pending;
  await el.updateComplete;
  expect(counter(el)!.selectedServiceZoneId).toBe("bar");
  expect(store.lines).toHaveLength(1);
  expect(store.lines[0]!.product.unitPrice).toBe("2.00");
  expect(api.setServiceZone).toHaveBeenCalledExactlyOnceWith("bar");
});

it("a hidden history destination resolves to the selected Floor rather than Counter", async () => {
  history.replaceState(null, "", "/tabs/counter");
  const { el, api } = await mount(selection(["garden"], "garden"));
  expect(counter(el)).toBeNull();
  expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull();
  expect(api.setServiceZone).not.toHaveBeenCalled();
  expect(location.pathname).toBe("/tabs/floor");
});

it.each(["device_profile.no_service_zone", "service_zone.default_missing"])(
  "a scope lost before offers answer blocks new Counter work (%s)",
  async (code) => {
    const { el, api } = await mount(selection(["bar"], "bar"), {
      listDefaultZoneOffers: vi.fn().mockRejectedValue({ code }),
    });
    expect(counter(el)).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-device-zones-empty]")).not.toBeNull();
    expect(api.setServiceZone).not.toHaveBeenCalled();
  },
);

async function openZones(el: TillApp) {
  shell(el).dispatchEvent(new CustomEvent("open-device-zones", { bubbles: true, composed: true }));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-device-zones-dialog")).not.toBeNull(),
  );
  const dialog = el.shadowRoot!.querySelector("till-device-zones-dialog")!;
  await vi.waitFor(() => expect(dialog.loading).toBe(false));
  return dialog;
}
it("empty-scope Settings reaches zones without a selling screen", async () => {
  const { el, api } = await mount({ ...selection([], null), zones: [] });
  const settings = el.shadowRoot!.querySelector<HTMLElement>("[data-open-device-settings]");
  expect(settings).not.toBeNull();
  await userEvent.click(settings!);
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-settings-zones]")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-device-zones-dialog")).not.toBeNull(),
  );
  expect(api.getDeviceZones).toHaveBeenCalledTimes(2);
});
it("retrying a failed settings read preserves edits and an action refusal", async () => {
  const { el, api } = await mount(selection(["bar", "room"], "bar"), {
    setDeviceZones: vi
      .fn()
      .mockRejectedValue({ code: "device_zones.changed", params: { field: "selectedZoneIds" } }),
  });
  const dialog = await openZones(el);
  await userEvent.click(
    dialog.shadowRoot!.querySelector<HTMLInputElement>(
      'input[name="starting-zone"][value="room"]',
    )!,
  );
  await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-zones-save]")!);
  await vi.waitFor(() => expect(dialog.busy).toBe(false));
  expect(dialog.refusal?.code).toBe("device_zones.changed");
  api.getDeviceZones.mockRejectedValueOnce(new Error("offline"));
  dialog.dispatchEvent(new CustomEvent("retry-device-zones", { bubbles: true, composed: true }));
  await vi.waitFor(() => expect(dialog.readError).not.toBe(""));
  await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-zones-retry]")!);
  await vi.waitFor(() => expect(dialog.readError).toBe(""));
  expect(
    dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="starting-zone"][value="room"]')!
      .checked,
  ).toBe(true);
  expect(dialog.refusal?.code).toBe("device_zones.changed");
  expect(
    dialog.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-zones-save]")!
      .disabled,
  ).toBe(false);
});
it("the real header's Settings click closes its menu and exposes Equipment and Zones", async () => {
  const { el } = await mount(selection(["bar", "room"], "bar"));
  const menu =
    shell(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-row-actions"]>(
      '[data-test="more-menu"]',
    )!;
  await menu.updateComplete;
  await userEvent.click(menu.shadowRoot!.querySelector("button")!);
  await userEvent.click(menu.querySelector<HTMLElement>(".settings")!);
  await el.updateComplete;
  expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
  expect(el.shadowRoot!.querySelector("[data-settings-equipment]")).not.toBeNull();
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-settings-zones]")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-device-zones-dialog")).not.toBeNull(),
  );
});
it("opens Equipment from Settings without replacing the basket when its read fails", async () => {
  const { el, api } = await mount(selection(["bar", "room"], "bar"), {
    getDeviceEquipment: vi.fn().mockRejectedValue(new TypeError("offline")),
  });
  const store = counter(el)!.store;
  store.addProduct(counter(el)!.products[0]!, "1");
  const id = store.id;
  shell(el).dispatchEvent(new CustomEvent("open-settings", { bubbles: true, composed: true }));
  await el.updateComplete;
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-settings-equipment]")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-equipment-dialog")?.open).toBe(true),
  );
  expect(el.shadowRoot!.querySelector("[data-settings-equipment]")).toBeNull();
  expect(store.id).toBe(id);
  expect(
    store.lines.map((line) => [line.product.productId, line.quantity, line.product.unitPrice]),
  ).toEqual([["coffee", "1", "2.00"]]);
  expect(api.setDeviceZones).not.toHaveBeenCalled();
});
it("recovers empty device scope through the visible Retry action without changing operator", async () => {
  const { el, api } = await mount({ ...selection([], null), zones: [] });
  expect(counter(el)).toBeNull();
  api.getDeviceZones.mockResolvedValue({ ...selection(["bar"], "bar"), snapshot: "restored" });
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-retry-device-zones]")!);
  await vi.waitFor(() => expect(counter(el)?.selectedServiceZoneId).toBe("bar"));
  expect(counter(el)!.products.map((product) => product.productId)).toEqual(["coffee"]);
  expect(shell(el).operatorName).toBe("Ana");
  expect(api.logout).not.toHaveBeenCalled();
  expect(api.setDeviceZones).not.toHaveBeenCalled();
});
it("a basket created while settings save is out retains its zone and prices", async () => {
  let answer!: (value: DeviceZoneSelection) => void;
  const pending = new Promise<DeviceZoneSelection>((resolve) => {
    answer = resolve;
  });
  const { el, api } = await mount(selection(["bar", "room"], "bar"), {
    setDeviceZones: vi.fn(() => pending),
  });
  const dialog = await openZones(el);
  await userEvent.click(
    dialog.shadowRoot!.querySelector<HTMLInputElement>(
      'input[name="starting-zone"][value="room"]',
    )!,
  );
  await userEvent.click(
    dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="shown-zone"][value="bar"]')!,
  );
  await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-zones-save]")!);
  expect(api.setDeviceZones).toHaveBeenCalledOnce();
  const store = counter(el)!.store!;
  store.addProduct(counter(el)!.products[0]!, "1");
  answer(selection(["room"], "room"));
  await pending;
  await el.updateComplete;
  expect(counter(el)).not.toBeNull();
  expect(counter(el)!.store).toBe(store);
  expect(counter(el)!.selectedServiceZoneId).toBe("bar");
  expect(store.lines[0]!.product.unitPrice).toBe("2.00");
  expect(api.setServiceZone).toHaveBeenCalledExactlyOnceWith("bar");
  store.clear();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-floor-screen")).not.toBeNull());
  expect(counter(el)).toBeNull();
});
it("saves an exact selection and closes before reporting a failed follow-up read", async () => {
  const chosen = selection(["bar", "room"], "bar");
  const saved = selection(["bar", "room"], "room");
  const { el, api } = await mount(chosen, { setDeviceZones: vi.fn().mockResolvedValue(saved) });
  const dialog = await openZones(el);
  await userEvent.click(
    dialog.shadowRoot!.querySelector<HTMLInputElement>(
      'input[name="starting-zone"][value="room"]',
    )!,
  );
  api.getDeviceZones.mockRejectedValue({ code: "device.not_found" });
  await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-zones-save]")!);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("till-device-zones-dialog")).toBeNull(),
  );
  expect(api.setDeviceZones).toHaveBeenCalledExactlyOnceWith({
    profileId: "profile",
    snapshot: "scope",
    selectedZoneIds: ["bar", "room"],
    startingZoneId: "room",
  });
  expect(counter(el)?.selectedServiceZoneId).toBe("bar");
  await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("could not be read"));
});
it("refuses hiding a zone with basket lines, while allowing only the future start to change", async () => {
  const { el, api } = await mount(selection(["bar", "room"], "bar"), {
    setDeviceZones: vi.fn().mockResolvedValue(selection(["bar", "room"], "room")),
  });
  const store = counter(el)!.store!;
  store.addProduct(counter(el)!.products[0]!, "1");
  const dialog = await openZones(el);
  await userEvent.click(
    dialog.shadowRoot!.querySelector<HTMLInputElement>(
      'input[name="starting-zone"][value="room"]',
    )!,
  );
  await userEvent.click(
    dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="shown-zone"][value="bar"]')!,
  );
  await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-zones-save]")!);
  expect(api.setDeviceZones).not.toHaveBeenCalled();
  expect(dialog.shadowRoot!.querySelector("wt-form-actions")!.error).toContain(
    "Park, send or cancel",
  );
  expect(store.lines).toHaveLength(1);
  await userEvent.click(
    dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="shown-zone"][value="bar"]')!,
  );
  await userEvent.click(dialog.shadowRoot!.querySelector<HTMLElement>("[data-zones-save]")!);
  await vi.waitFor(() => expect(api.setDeviceZones).toHaveBeenCalledOnce());
  expect(store.lines[0]!.product.unitPrice).toBe("2.00");
  expect(counter(el)?.selectedServiceZoneId).toBe("bar");
});
it("an old opening's read cannot repaint a reopened settings draft", async () => {
  const chosen = selection(["bar", "room"], "bar");
  const { el, api } = await mount(chosen);
  let answer!: (value: DeviceZoneSelection) => void;
  const pending = new Promise<DeviceZoneSelection>((resolve) => {
    answer = resolve;
  });
  api.getDeviceZones.mockReturnValueOnce(pending);
  shell(el).dispatchEvent(new CustomEvent("open-device-zones", { bubbles: true, composed: true }));
  await el.updateComplete;
  const first = el.shadowRoot!.querySelector("till-device-zones-dialog")!;
  first.dispatchEvent(new CustomEvent("close-device-zones", { bubbles: true, composed: true }));
  await el.updateComplete;
  const second = await openZones(el);
  await userEvent.click(
    second.shadowRoot!.querySelector<HTMLInputElement>(
      'input[name="starting-zone"][value="room"]',
    )!,
  );
  answer(selection(["shop"], "shop"));
  await pending;
  await el.updateComplete;
  await second.updateComplete;
  expect(second.selection!.selectedZoneIds).toEqual(["bar", "room"]);
  expect(
    second.shadowRoot!.querySelector<HTMLInputElement>('input[name="starting-zone"][value="room"]')!
      .checked,
  ).toBe(true);
});
it("a security sign-out drops settings before the same element signs in again", async () => {
  const activity = new SessionActivity();
  const configure = vi.spyOn(activity, "configure");
  const { el } = await mount(selection(["bar", "room"], "bar"), {}, { sessionActivity: activity });
  await openZones(el);
  configure.mock.calls.at(-1)![0].onIdle();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
  el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
    new CustomEvent("logged-in", {
      detail: { personId: "person", displayName: "Ana", permissions: [], locale: "en-GB" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(counter(el)).not.toBeNull());
  expect(el.shadowRoot!.querySelector("till-device-zones-dialog")).toBeNull();
});
it("a saved response from a signed-out operator cannot close the next opening", async () => {
  let answer!: (value: DeviceZoneSelection) => void;
  const pending = new Promise<DeviceZoneSelection>((resolve) => {
    answer = resolve;
  });
  const activity = new SessionActivity();
  const configure = vi.spyOn(activity, "configure");
  const { el } = await mount(
    selection(["bar", "room"], "bar"),
    { setDeviceZones: vi.fn(() => pending) },
    { sessionActivity: activity },
  );
  const first = await openZones(el);
  await userEvent.click(
    first.shadowRoot!.querySelector<HTMLInputElement>('input[name="starting-zone"][value="room"]')!,
  );
  await userEvent.click(first.shadowRoot!.querySelector<HTMLElement>("[data-zones-save]")!);
  configure.mock.calls.at(-1)![0].onIdle();
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
  el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
    new CustomEvent("logged-in", {
      detail: { personId: "other", displayName: "Bea", permissions: [], locale: "en-GB" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(counter(el)).not.toBeNull());
  const second = await openZones(el);
  answer(selection(["room"], "room"));
  await pending;
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-device-zones-dialog")).toBe(second);
  expect(second.busy).toBe(false);
  expect(second.selection!.startingZoneId).toBe("bar");
});

async function chooseUnsaved(el: TillApp, choice: "keep" | "discard") {
  const q = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
  await vi.waitFor(() => expect(q.open).toBe(true));
  await q.updateComplete;
  await userEvent.click(q.shadowRoot!.querySelector<HTMLElement>(`[data-choice="${choice}"]`)!);
  await vi.waitFor(() => expect(q.open).toBe(false));
}
it("browser Back restores its accepted URL on Keep and discards settings without saving", async () => {
  const { el, api } = await mount(selection(["bar", "room"], "bar"));
  const push = vi.spyOn(history, "pushState");
  shell(el).dispatchEvent(
    new CustomEvent("screen-select", {
      detail: { screen: "floor" },
      bubbles: true,
      composed: true,
    }),
  );
  await vi.waitFor(() => expect(location.pathname).toBe("/tabs/floor"));
  expect(push).toHaveBeenCalledOnce();
  const dialog = await openZones(el);
  await userEvent.click(
    dialog.shadowRoot!.querySelector<HTMLInputElement>(
      'input[name="starting-zone"][value="room"]',
    )!,
  );
  history.back();
  await chooseUnsaved(el, "keep");
  expect(location.pathname).toBe("/tabs/floor");
  expect(
    dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="starting-zone"][value="room"]')!
      .checked,
  ).toBe(true);
  history.back();
  await chooseUnsaved(el, "discard");
  await vi.waitFor(() => expect(location.pathname).toBe("/tabs/counter"));
  expect(
    dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="starting-zone"][value="bar"]')!
      .checked,
  ).toBe(true);
  expect(api.setDeviceZones).not.toHaveBeenCalled();
  push.mockRestore();
});
it("locale navigation protects settings on Keep and discards before changing language", async () => {
  const { el, api } = await mount(selection(["bar", "room"], "bar"));
  const dialog = await openZones(el);
  await userEvent.click(
    dialog.shadowRoot!.querySelector<HTMLInputElement>(
      'input[name="starting-zone"][value="room"]',
    )!,
  );
  const change = () =>
    shell(el).dispatchEvent(
      new CustomEvent("wt-locale-selected", {
        detail: { code: "es-ES" },
        bubbles: true,
        composed: true,
      }),
    );
  change();
  await chooseUnsaved(el, "keep");
  expect(currentLocale()).toBe("en-GB");
  expect(api.putLocale).not.toHaveBeenCalled();
  expect(
    dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="starting-zone"][value="room"]')!
      .checked,
  ).toBe(true);
  change();
  await chooseUnsaved(el, "discard");
  await vi.waitFor(() => expect(currentLocale()).toBe("es-ES"));
  expect(api.putLocale).toHaveBeenCalledExactlyOnceWith("es-ES");
  expect(
    dialog.shadowRoot!.querySelector<HTMLInputElement>('input[name="starting-zone"][value="bar"]')!
      .checked,
  ).toBe(true);
  expect(api.setDeviceZones).not.toHaveBeenCalled();
});
it("disconnecting the application retires its editor before reconnecting and reopening", async () => {
  const { el, api } = await mount(selection(["bar", "room"], "bar"));
  const first = await openZones(el);
  await userEvent.click(
    first.shadowRoot!.querySelector<HTMLInputElement>('input[name="starting-zone"][value="room"]')!,
  );
  const parent = el.parentElement!;
  el.remove();
  parent.append(el);
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-device-zones-dialog")).toBeNull();
  const second = await openZones(el);
  expect(second).not.toBe(first);
  expect(
    second.shadowRoot!.querySelector<HTMLInputElement>('input[name="starting-zone"][value="bar"]')!
      .checked,
  ).toBe(true);
  expect(api.getDeviceZones).toHaveBeenCalledTimes(3);
  expect(api.setDeviceZones).not.toHaveBeenCalled();
});

describe("a handheld's zones", () => {
  const handhelds = ["phone-portrait", "tablet-landscape"] as const;
  const orderedFloorZones: FloorZone[] = floorZones.map((zone, index) => ({
    ...zone,
    displayOrder: index + 1,
  }));
  const tableIn = (id: string, zoneId: string) => ({
    id,
    label: id,
    zoneId,
    state: "open-tab",
    hasOpenTab: true,
    tabLineCount: 0,
    tabTotal: "0.00",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    signals: [],
    party: {
      kitchenNote: { scope: { partyId: `party-${id}` }, note: null, revision: 0, ownerRevision: 1 },
      id: `party-${id}`,
      revision: 1,
      guestCount: 2,
      state: "open",
      mainBillId: `bill-${id}`,
      outstanding: "0.00",
      billCount: 1,
      tableIds: [id],
      unsentDrafts: [],
      reminder: null,
    },
  });
  afterEach(() => history.replaceState(null, "", "/"));

  async function mountHandheld(
    chosen: DeviceZoneSelection,
    formFactor: string = "phone-portrait",
    over: Record<string, unknown> = {},
    permissions: string[] = [],
  ) {
    return mount(
      chosen,
      {
        getTill: vi.fn().mockResolvedValue({
          locale: "en-GB",
          invoiceLocale: "en-GB",
          venueName: "Restaurant",
          nif: "B12345678",
          orderFlow: "prepay",
          bumpMode: "line",
          fireControl: "waiter",
          courses: [],
          cardProvider: "none",
          tipsEnabled: false,
          formFactor,
          capabilities: ["take-orders"],
          inactivityTimeoutSeconds: null,
          nodeId: "node",
          servers: [],
        }),
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "device",
          name: "Phone",
          formFactor,
          profileId: "profile",
        }),
        listZones: vi.fn().mockResolvedValue(orderedFloorZones),
        ...over,
      },
      {},
      permissions,
    );
  }
  const floor = (el: TillApp) => el.shadowRoot!.querySelector("till-floor-screen")!;
  async function floorZoneIds(el: TillApp) {
    await vi.waitFor(() => expect(floor(el)).not.toBeNull());
    await vi.waitFor(() => expect(floor(el).zones.length).toBeGreaterThan(0));
    return floor(el).zones.map((zone) => zone.id);
  }
  async function activeTab(el: TillApp) {
    await floorZoneIds(el);
    await floor(el).updateComplete;
    return floor(el)
      .shadowRoot!.querySelector('nav.tabs wt-button.tab[variant="primary"]')
      ?.getAttribute("data-zone");
  }

  it.each(handhelds)(
    "reads the device's zones at sign-in and narrows Floor to them (%s)",
    async (formFactor) => {
      const { el, api } = await mountHandheld(
        selection(["room", "garden"], "room", false),
        formFactor,
      );
      expect(await floorZoneIds(el)).toEqual(["room", "garden"]);
      expect(api.getDeviceZones).toHaveBeenCalledOnce();
    },
  );

  it.each(handhelds)(
    "reads the device's zones at sign-in and with every zone chosen keeps every zone (%s)",
    async (formFactor) => {
      const { el, api } = await mountHandheld(
        selection(["bar", "shop", "room", "garden"], "bar", false),
        formFactor,
      );
      expect(await floorZoneIds(el)).toEqual(orderedFloorZones.map((zone) => zone.id));
      expect(api.getDeviceZones).toHaveBeenCalledOnce();
    },
  );

  it.each(handhelds)(
    "with one zone chosen the Floor shows no zone tabs (worked example 6) (%s)",
    async (formFactor) => {
      const { el } = await mountHandheld(selection(["garden"], "garden"), formFactor);
      expect(await floorZoneIds(el)).toEqual(["garden"]);
      await floor(el).updateComplete;
      expect(floor(el).shadowRoot!.querySelector("nav.tabs")).toBeNull();
    },
  );

  it.each(handhelds)(
    "with two zones chosen the Floor shows their two zone tabs (worked example 6) (%s)",
    async (formFactor) => {
      const { el } = await mountHandheld(selection(["room", "garden"], "room"), formFactor);
      await floorZoneIds(el);
      await floor(el).updateComplete;
      expect(
        [...floor(el).shadowRoot!.querySelectorAll("nav.tabs wt-button.tab")].map((tab) =>
          tab.getAttribute("data-zone"),
        ),
      ).toEqual(["room", "garden"]);
    },
  );

  it.each(handhelds)(
    "keeps a chosen counter zone on the handheld's Floor and drops an unchosen one (%s)",
    async (formFactor) => {
      const { el } = await mountHandheld(selection(["bar", "room"], "room"), formFactor);
      const ids = await floorZoneIds(el);
      expect(ids).toContain("bar");
      expect(ids).not.toContain("shop");
      expect(ids).not.toContain("garden");
    },
  );

  it("the More entry opens the zones dialog and a save narrows the Floor", async () => {
    const { el, api } = await mountHandheld(
      selection(["bar", "shop", "room", "garden"], "bar", false),
      "phone-portrait",
      { setDeviceZones: vi.fn().mockResolvedValue(selection(["garden"], "garden")) },
    );
    await floorZoneIds(el);
    const more = shell(el).shadowRoot!.querySelector<
      HTMLElement & { updateComplete: Promise<unknown> }
    >('header wt-row-actions[data-test="more-menu"]')!;
    await more.updateComplete;
    await userEvent.click(more.shadowRoot!.querySelector<HTMLButtonElement>("button")!);
    await userEvent.click(more.querySelector<HTMLElement>("wt-button.zones")!);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-device-zones-dialog")).not.toBeNull(),
    );
    const dialog = el.shadowRoot!.querySelector("till-device-zones-dialog")!;
    await vi.waitFor(() => expect(dialog.loading).toBe(false));
    dialog.dispatchEvent(
      new CustomEvent("save-device-zones", {
        detail: {
          profileId: "profile",
          snapshot: "scope",
          selectedZoneIds: ["garden"],
          startingZoneId: "garden",
        },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-device-zones-dialog")).toBeNull(),
    );
    expect(api.setDeviceZones).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(floor(el).zones.map((zone) => zone.id)).toEqual(["garden"]));
  });

  it("a profile switch shows the new profile's own zones", async () => {
    const { el, api } = await mountHandheld(
      { ...selection(["room", "garden"], "room"), profileId: "profile" },
      "phone-portrait",
      {
        getDeviceIdentity: vi.fn().mockResolvedValue({
          deviceId: "device",
          name: "Phone",
          formFactor: "phone-portrait",
          profileId: "profile",
          approvedProfiles: [
            { id: "profile", name: "Waiter" },
            { id: "other", name: "Terrace" },
          ],
        }),
        switchDeviceProfile: vi.fn().mockResolvedValue({ activeProfileId: "other" }),
      },
    );
    expect(await floorZoneIds(el)).toEqual(["room", "garden"]);
    api.getDeviceZones.mockResolvedValue({
      ...selection(["shop", "garden"], "garden"),
      profileId: "other",
      snapshot: "other",
    });
    shell(el).dispatchEvent(new CustomEvent("open-profile", { bubbles: true, composed: true }));
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-profile-dialog")).not.toBeNull(),
    );
    el.shadowRoot!.querySelector("till-profile-dialog")!.dispatchEvent(
      new CustomEvent("profile-switch", {
        detail: { profileId: "other" },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() => expect(api.getDeviceZones).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(floor(el).zones.map((zone) => zone.id)).toEqual(["shop", "garden"]),
    );
  });

  describe("an unsaved handheld opens as today; a saved one opens on its Opens first zone", () => {
    const all = ["bar", "shop", "room", "garden"];
    it.each(handhelds)("unsaved, no URL zone, opens on the first tab (%s)", async (formFactor) => {
      const { el } = await mountHandheld(selection(all, "garden", false), formFactor);
      expect(await activeTab(el)).toBe("bar");
    });
    it.each(handhelds)("unsaved, with a URL zone, opens on it (%s)", async (formFactor) => {
      history.replaceState(null, "", "/tabs/floor/zone/room");
      const { el } = await mountHandheld(selection(all, "garden", false), formFactor);
      expect(await activeTab(el)).toBe("room");
    });
    it.each(handhelds)("saved, opens on its counter Opens first zone (%s)", async (formFactor) => {
      const { el } = await mountHandheld(selection(all, "shop", true), formFactor);
      expect(await activeTab(el)).toBe("shop");
    });
    it.each(handhelds)(
      "saved, opens on its Opens first zone over a URL zone (%s)",
      async (formFactor) => {
        history.replaceState(null, "", "/tabs/floor/zone/room");
        const { el } = await mountHandheld(selection(all, "shop", true), formFactor);
        expect(await activeTab(el)).toBe("shop");
      },
    );
  });

  async function openTable(
    zoneId: string,
    over: Record<string, unknown> = {},
    seeded: boolean | "unavailable" = false,
    formFactor = "phone-portrait",
  ) {
    const table = tableIn(`table-${zoneId}`, zoneId);
    const drafts = draftServer(() => ({
      tabId: table.party.mainBillId,
      revision: 1,
      groups: [],
    }));
    drafts.bills.add(table.party.mainBillId);
    if (seeded === "unavailable") drafts.unavailable.add("coffee-offer");
    if (seeded)
      drafts.drafts.push({
        id: "draft-ana",
        partyId: table.party.id,
        billId: table.party.mainBillId,
        ownerId: "person",
        ownerName: "Ana",
        revision: 1,
        takenOverFrom: null,
        lines: [
          {
            slot: 0,
            joinGroupId: null,
            afterGroupId: null,
            id: "draft-line-1",
            sourceLineId: null,
            source: null,
            menuItemId: "coffee-offer",
            variantId: null,
            menuVersionId: null,
            options: [],
            extras: [],
            note: null,
            quantity: "1",
            courseId: null,
            makeAt: "switched-off",
            noMerge: false,
            unavailable: false,
          },
        ],
      });
    const { el } = await mountHandheld(selection(["garden"], "garden"), formFactor, {
      listDefaultZoneOffers: vi.fn().mockResolvedValue(catalogue("bar")),
      getTablesState: vi.fn().mockResolvedValue([table]),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
      listGroups: vi.fn().mockResolvedValue({ revision: 1, groups: [] }),
      getPartyBills: vi.fn().mockResolvedValue([]),
      listDrafts: drafts.listDrafts,
      saveDraft: drafts.saveDraft,
      submitDraft: drafts.submitDraft,
      ...over,
    });
    await vi.waitFor(() => expect(floor(el)?.tables.map((row) => row.id)).toEqual([table.id]));
    floor(el).dispatchEvent(
      new CustomEvent("open-table", {
        detail: { tableId: table.id, seated: true },
        bubbles: true,
        composed: true,
      }),
    );
    const screen = () => el.shadowRoot!.querySelector("till-table-order-screen")!;
    await vi.waitFor(() => expect(screen()?.draftStore).toBeTruthy());
    await el.updateComplete;
    return { el, screen: screen(), drafts };
  }

  it.each([
    ["room", false],
    ["garden", true],
  ] as const)(
    "a hidden zone's table takes no new dishes; a shown one does, whatever the profile's start (%s)",
    async (zoneId, allowed) => {
      const { el, screen } = await openTable(zoneId);
      expect(screen.orderingAllowed).toBe(allowed);
      const store = screen.draftStore!;
      store.addProduct(screen.products[0]!, "1");
      expect(store.lines).toHaveLength(allowed ? 1 : 0);
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
    },
  );

  it.each([
    ["room", true],
    ["garden", false],
  ] as const)(
    "a hidden zone's table cannot send its saved unsent dishes; a shown one can (%s)",
    async (zoneId, disabled) => {
      const { screen } = await openTable(zoneId, {}, true);
      await vi.waitFor(() => expect(screen.draftStore!.lines).toHaveLength(1));
      await screen.updateComplete;
      const sendAll = screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
        '[data-draft-action="send-all"]',
      )!;
      expect(sendAll.disabled).toBe(disabled);
    },
  );

  it("a handheld whose zone choice could not be read at sign-in still takes dishes at any table", async () => {
    const { screen } = await openTable("room", {
      getDeviceZones: vi.fn().mockRejectedValue({ code: "server.internal" }),
    });
    expect(screen.orderingAllowed).toBe(true);
    const store = screen.draftStore!;
    store.addProduct(screen.products[0]!, "1");
    expect(store.lines).toHaveLength(1);
  });

  it("a till whose zone choice could not be read takes no dishes", async () => {
    const table = tableIn("table-room", "room");
    const drafts = draftServer(() => ({ tabId: table.party.mainBillId, revision: 1, groups: [] }));
    drafts.bills.add(table.party.mainBillId);
    const { el } = await mount(selection(["room"], "room"), {
      getDeviceZones: vi.fn().mockRejectedValue({ code: "server.internal" }),
      getTablesState: vi.fn().mockResolvedValue([table]),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
      listGroups: vi.fn().mockResolvedValue({ revision: 1, groups: [] }),
      getPartyBills: vi.fn().mockResolvedValue([]),
      listDrafts: drafts.listDrafts,
      saveDraft: drafts.saveDraft,
      submitDraft: drafts.submitDraft,
    });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-device-zones-empty]")).not.toBeNull(),
    );
    expect(el.shadowRoot!.querySelector("till-floor-screen")).toBeNull();
    shell(el).dispatchEvent(
      new CustomEvent("open-table", {
        detail: { tableId: table.id, seated: true },
        bubbles: true,
        composed: true,
      }),
    );
    const screen = () => el.shadowRoot!.querySelector("till-table-order-screen");
    await vi.waitFor(() => expect(screen()?.draftStore).toBeTruthy());
    expect(screen()!.orderingAllowed).toBe(false);
    const store = screen()!.draftStore!;
    store.addProduct(screen()!.products[0]!, "1");
    expect(store.lines).toHaveLength(0);
  });

  describe("live", () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
    afterEach(() => vi.useRealTimers());
    async function tick(el: TillApp) {
      vi.advanceTimersByTime(15_000);
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        await el.updateComplete;
      }
    }
    const notice = (el: TillApp) =>
      [...el.shadowRoot!.querySelectorAll('[role="status"]')]
        .map((node) => node.textContent?.trim() ?? "")
        .filter((text) => text !== "");

    it("a failed zones read at sign-in keeps the handheld's other setup", async () => {
      const { el, api } = await mountHandheld(
        selection(["garden"], "garden"),
        "phone-portrait",
        {
          ...transferApi,
          getDeviceZones: vi
            .fn()
            .mockRejectedValueOnce({ code: "server.internal" })
            .mockResolvedValue(selection(["garden"], "garden")),
          listDefaultZoneOffers: vi.fn().mockResolvedValue(routeOffers()),
        },
        ["sale.take_payment"],
      );
      expect(api.listDefaultZoneOffers).toHaveBeenCalled();
      expect(await floorZoneIds(el)).toEqual(orderedFloorZones.map((zone) => zone.id));
      expect(notice(el)).toContain("The zones could not be read. Try again.");
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("till-department-transfers")).not.toBeNull(),
      );
      expect(acceptZones(el)).toEqual(["bar", "shop"]);
      expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
      await tick(el);
      await vi.waitFor(() => expect(floor(el).zones.map((zone) => zone.id)).toEqual(["garden"]));
      expect(notice(el)).not.toContain("The zones could not be read. Try again.");
    });

    const waiting = (el: TillApp) =>
      el.shadowRoot!.querySelector("[data-device-zones-pending]")?.textContent?.trim();
    const savedLines = (drafts: ReturnType<typeof draftServer>) =>
      drafts.drafts.flatMap((draft) => draft.lines);
    async function narrowToGarden(el: TillApp) {
      const api = el.api as unknown as { getDeviceZones: ReturnType<typeof vi.fn> };
      api.getDeviceZones.mockResolvedValue({
        ...selection(["garden"], "garden"),
        snapshot: "narrow",
      });
      await tick(el);
    }
    async function backToFloor(el: TillApp, formFactor: string, shown = ["garden"]) {
      if (formFactor === "till")
        el.shadowRoot!.querySelector("till-table-order-screen")!.dispatchEvent(
          new CustomEvent("back-to-floor", { bubbles: true, composed: true }),
        );
      else
        await userEvent.click(
          [...shell(el).shadowRoot!.querySelectorAll<HTMLElement>('[role="tab"]')].find(
            (tab) => tab.textContent!.trim() === "Floor",
          )!,
        );
      await vi.waitFor(() => expect(floor(el)?.zones.map((zone) => zone.id)).toEqual(shown));
    }
    async function openRoomTable(
      formFactor = "phone-portrait",
      seeded: boolean | "unavailable" = false,
    ) {
      const opened = await openTable(
        "room",
        {
          getDeviceZones: vi.fn().mockResolvedValue(selection(["room", "garden"], "room")),
          previewPartyAllergy: vi.fn(async (partyId: string) => ({
            partyId,
            snapshot: {
              answer: "none",
              guests: [],
              ticks: [],
              changedAt: null,
              changedBy: null,
              revision: 1,
            },
            dishes: [],
          })),
        },
        seeded,
        formFactor,
      );
      opened.drafts.personId = "person";
      const store = opened.screen.draftStore!;
      if (seeded === false) store.addProduct(opened.screen.products[0]!, "1");
      await vi.waitFor(() => expect(store.lines).toHaveLength(1));
      await vi.waitFor(() => expect(savedLines(opened.drafts)).toHaveLength(1));
      return opened;
    }
    const tableWaiting = "Send or remove this table's unsent dishes to hide its zone.";

    it.each(["phone-portrait", "till"])(
      "the table holding back a waiting narrowing can send its dishes, and sending applies it with no poll and returns to the Floor (%s)",
      async (formFactor) => {
        const { el, screen, drafts } = await openRoomTable(formFactor);
        await narrowToGarden(el);
        expect(waiting(el)).toBe(tableWaiting);
        expect(savedLines(drafts)).toHaveLength(1);
        await screen.updateComplete;
        const sendAll = screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
          '[data-draft-action="send-all"]',
        )!;
        expect(sendAll.disabled).toBe(false);
        sendAll.click();
        await vi.waitFor(() => expect(drafts.submitDraft).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(waiting(el)).toBeUndefined());
        await el.updateComplete;
        expect(el.shadowRoot!.querySelector("till-table-order-screen")).toBeNull();
        await vi.waitFor(() => expect(floor(el)?.zones.map((zone) => zone.id)).toEqual(["garden"]));
      },
    );

    it.each(["phone-portrait", "till"])(
      "the table holding back a waiting narrowing refuses a new dish while Send stays enabled (%s)",
      async (formFactor) => {
        const { el, screen } = await openRoomTable(formFactor);
        await narrowToGarden(el);
        await screen.updateComplete;
        expect(screen.orderingAllowed).toBe(false);
        expect(
          screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
            '[data-draft-action="send-all"]',
          )!.disabled,
        ).toBe(false);
        const store = screen.draftStore!;
        store.addProduct(screen.products[0]!, "1");
        expect(store.lines.map((line) => line.quantity)).toEqual(["1"]);
      },
    );

    it.each(["phone-portrait", "till"])(
      "the table holding back a waiting narrowing can remove its dishes, and removing applies it with no poll (%s)",
      async (formFactor) => {
        const { el, screen, drafts } = await openRoomTable(formFactor, "unavailable");
        await narrowToGarden(el);
        expect(waiting(el)).toBe(tableWaiting);
        expect(savedLines(drafts)).toHaveLength(1);
        await screen.updateComplete;
        const remove = screen.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
          "[data-flag-remove]",
        )!;
        expect(remove.disabled).toBe(false);
        remove.click();
        await vi.waitFor(() => expect(screen.draftStore!.lines).toHaveLength(0));
        await vi.waitFor(() => expect(waiting(el)).toBeUndefined());
        await screen.updateComplete;
        expect(screen.isConnected).toBe(true);
        expect(screen.orderingAllowed).toBe(false);
        await backToFloor(el, formFactor);
      },
    );

    async function openHiddenRoomTable(formFactor: string) {
      const opened = await openTable(
        "room",
        { getDeviceZones: vi.fn().mockResolvedValue(selection(["garden"], "garden")) },
        true,
        formFactor,
      );
      await vi.waitFor(() => expect(opened.screen.draftStore!.lines).toHaveLength(1));
      return opened;
    }

    it.each(["phone-portrait", "till"])(
      "a table in an already hidden zone does not hold back a widened choice that still hides it (%s)",
      async (formFactor) => {
        const { el } = await openHiddenRoomTable(formFactor);
        const api = el.api as unknown as { getDeviceZones: ReturnType<typeof vi.fn> };
        api.getDeviceZones.mockResolvedValue({
          ...selection(["garden", "bar"], "garden"),
          snapshot: "widen",
        });
        await tick(el);
        expect(waiting(el)).toBeUndefined();
        await backToFloor(el, formFactor, formFactor === "till" ? ["garden"] : ["bar", "garden"]);
      },
    );

    it.each(["phone-portrait", "till"])(
      "the zones dialog saves a widened choice at a table in an already hidden zone (%s)",
      async (formFactor) => {
        const { el } = await openHiddenRoomTable(formFactor);
        const api = el.api as unknown as { setDeviceZones: ReturnType<typeof vi.fn> };
        const dialog = await openZones(el);
        dialog.dispatchEvent(
          new CustomEvent("save-device-zones", {
            detail: {
              profileId: "profile",
              snapshot: "scope",
              selectedZoneIds: ["garden", "bar"],
              startingZoneId: "garden",
            },
            bubbles: true,
            composed: true,
          }),
        );
        await vi.waitFor(() => expect(api.setDeviceZones).toHaveBeenCalledOnce());
        expect(dialog.shadowRoot!.querySelector("wt-form-actions")!.error ?? "").toBe("");
      },
    );

    it("a hidden zone's table that holds nothing back stays blocked while the counter basket holds the narrowing", async () => {
      const table = tableIn("table-room", "room");
      const drafts = draftServer(() => ({
        tabId: table.party.mainBillId,
        revision: 1,
        groups: [],
      }));
      drafts.bills.add(table.party.mainBillId);
      const { el } = await mount(selection(["bar", "room", "garden"], "bar"), {
        listZones: vi.fn().mockResolvedValue(orderedFloorZones),
        getTablesState: vi.fn().mockResolvedValue([table]),
        getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
        listGroups: vi.fn().mockResolvedValue({ revision: 1, groups: [] }),
        getPartyBills: vi.fn().mockResolvedValue([]),
        listDrafts: drafts.listDrafts,
        saveDraft: drafts.saveDraft,
        submitDraft: drafts.submitDraft,
      });
      counter(el)!.store.addProduct(counter(el)!.products[0]!, "1");
      await userEvent.click(
        [...shell(el).shadowRoot!.querySelectorAll<HTMLElement>('[role="tab"]')].find(
          (tab) => tab.textContent!.trim() === "Floor",
        )!,
      );
      await vi.waitFor(() => expect(floor(el)?.tables.map((row) => row.id)).toEqual([table.id]));
      floor(el).dispatchEvent(
        new CustomEvent("open-table", {
          detail: { tableId: table.id, seated: true },
          bubbles: true,
          composed: true,
        }),
      );
      const screen = () => el.shadowRoot!.querySelector("till-table-order-screen")!;
      await vi.waitFor(() => expect(screen()?.draftStore).toBeTruthy());
      expect(screen().orderingAllowed).toBe(true);
      await narrowToGarden(el);
      expect(waiting(el)).toBe("Park, send or cancel this order before hiding its zone.");
      await screen().updateComplete;
      expect(screen().orderingAllowed).toBe(false);
    });

    it("the zones dialog refuses to hide the open table's zone in a table's words", async () => {
      const { el } = await openRoomTable();
      const api = el.api as unknown as { setDeviceZones: ReturnType<typeof vi.fn> };
      const dialog = await openZones(el);
      dialog.dispatchEvent(
        new CustomEvent("save-device-zones", {
          detail: {
            profileId: "profile",
            snapshot: "scope",
            selectedZoneIds: ["garden"],
            startingZoneId: "garden",
          },
          bubbles: true,
          composed: true,
        }),
      );
      await vi.waitFor(() =>
        expect(dialog.shadowRoot!.querySelector("wt-form-actions")!.error).toBe(
          "Send or remove the unsent dishes before hiding their zone.",
        ),
      );
      expect(api.setDeviceZones).not.toHaveBeenCalled();
    });
  });

  const transferApi = {
    listIncomingDepartmentTransfers: vi.fn(async () => ({
      receiving: true,
      count: 0,
      requests: [],
    })),
    listDepartmentSentTransfers: vi.fn(async () => ({ requests: [] })),
    readDepartmentTransferEvents: vi.fn(
      (_reload: () => void, { signal }: { signal: AbortSignal }) =>
        new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        ),
    ),
  };
  const routeOffers = () => {
    const offers = catalogue("bar");
    return { ...offers, zones: offers.zones!.filter((zone) => zone.serviceMode !== "table_tab") };
  };
  const acceptZones = (el: TillApp) =>
    el.shadowRoot!.querySelector("till-department-transfers")!.serviceZones.map((zone) => zone.id);

  it("the transfer accept list stays the offers route's zones", async () => {
    const { el } = await mountHandheld(
      selection(["garden"], "garden"),
      "phone-portrait",
      { ...transferApi, listDefaultZoneOffers: vi.fn().mockResolvedValue(routeOffers()) },
      ["sale.take_payment"],
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-department-transfers")).not.toBeNull(),
    );
    expect(acceptZones(el)).toEqual(["bar", "shop"]);
  });

  it("the transfer accept list stays the offers route's zones after a saved choice", async () => {
    const { el, api } = await mountHandheld(
      selection(["bar", "shop", "room", "garden"], "bar", false),
      "phone-portrait",
      {
        ...transferApi,
        listDefaultZoneOffers: vi.fn().mockResolvedValue(routeOffers()),
        setDeviceZones: vi.fn().mockResolvedValue(selection(["garden"], "garden")),
      },
      ["sale.take_payment"],
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-department-transfers")).not.toBeNull(),
    );
    const dialog = await openZones(el);
    dialog.dispatchEvent(
      new CustomEvent("save-device-zones", {
        detail: {
          profileId: "profile",
          snapshot: "scope",
          selectedZoneIds: ["garden"],
          startingZoneId: "garden",
        },
        bubbles: true,
        composed: true,
      }),
    );
    await vi.waitFor(() => expect(floor(el).zones.map((zone) => zone.id)).toEqual(["garden"]));
    expect(api.setDeviceZones).toHaveBeenCalledOnce();
    expect(acceptZones(el)).toEqual(["bar", "shop"]);
  });

  it("the transfer accept list never takes the choice's zones when the offers read fails", async () => {
    const { el, api } = await mountHandheld(
      selection(["garden"], "garden"),
      "phone-portrait",
      {
        ...transferApi,
        listDefaultZoneOffers: vi.fn().mockRejectedValue({ code: "server.internal" }),
      },
      ["sale.take_payment"],
    );
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("till-department-transfers")).not.toBeNull(),
    );
    expect(api.getDeviceZones).toHaveBeenCalledOnce();
    expect(acceptZones(el)).toEqual([]);
  });

  it("a kitchen display reads no zones", async () => {
    const { api } = await mountHandheld(selection(["garden"], "garden"), "kds");
    expect(api.getDeviceZones).not.toHaveBeenCalled();
  });
});

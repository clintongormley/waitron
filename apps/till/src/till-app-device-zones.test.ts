import { afterEach, expect, it, vi } from "vitest";
import type { DeviceZoneSelection } from "@waitron/venue-service";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
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
const selection = (ids: string[], start: string | null): DeviceZoneSelection => ({
  profileId: "profile",
  snapshot: "scope",
  zones,
  selectedZoneIds: ids,
  startingZoneId: start,
  adjusted: false,
});
const floorZones: FloorZone[] = zones.map((zone) => ({
  ...zone,
  displayOrder: 0,
  active: true,
  closed: false,
  closesAt: null,
  hasPlan: false,
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
      bumpMode: "line",
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
    listStatuses: vi.fn().mockResolvedValue([]),
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
      detail: { personId: "person", displayName: "Ana", permissions: [], locale: "en-GB" },
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
    "Hold, send or cancel",
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

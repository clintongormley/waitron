import { afterEach, expect, it, vi } from "vitest";
import type { DeviceZoneSelection } from "@waitron/venue-service";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget, servedMenus } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import type { TillApi, FloorZone, ZoneOfferCatalogue } from "./api/client.js";
import type { TillShell } from "./widgets/till-shell.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
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

async function mount(chosen: DeviceZoneSelection, over: Record<string, unknown> = {}) {
  setLocale("en-GB");
  const api = {
    getLocales: vi
      .fn()
      .mockResolvedValue({ locales: [{ code: "en-GB", label: "English" }], venueDefault: "en-GB" }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
    getTill: vi
      .fn()
      .mockResolvedValue({
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
    getDeviceIdentity: vi
      .fn()
      .mockResolvedValue({
        deviceId: "device",
        name: "Till",
        formFactor: "till",
        profileId: "profile",
      }),
    getDeviceZones: vi.fn().mockResolvedValue(chosen),
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
    ...over,
  };
  const { el } = await mountWidget<TillApp>("till-app", { api: api as unknown as TillApi });
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

import { answeredPartyAllergy } from "../test/answered-party-allergy.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import { page } from "vitest/browser";
import { setLocale } from "./i18n/t.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupWidgets,
  draftServer,
  expectNoA11yViolations,
  mountWidget,
  servedMenus,
} from "./widgets/test-helpers.js";
import "./till-app.js";
import type { TillApp } from "./till-app.js";
import type { TillApi, TillProduct } from "./api/client.js";
import type { TillCounterScreen } from "./screens/till-counter-screen.js";
import type { TillTableOrderScreen } from "./screens/till-table-order-screen.js";
import type { TillMenuBrowser } from "./widgets/menu-browser.js";
import type { WtToast } from "@waitron/ui/src/components/wt-toast.js";

const defaultMenu = { id: "cat-default", name: "Carta", isDefault: true };

const products: TillProduct[] = [
  {
    id: "p1",
    name: "Café",
    customerName: { "es-ES": "Café para el cliente" },
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
    allergens: null,
    catalogueId: "cat-default",
    catalogueName: "Carta",
  },
];

function stubApi(overrides: Record<string, unknown> = {}): TillApi {
  return {
    // Without it the boot fails and the till never leaves its lock screen.
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture(undefined, ["z1"])),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
    getLocales: vi.fn().mockResolvedValue({
      locales: [
        { code: "es-ES", label: "Español" },
        { code: "en-GB", label: "English" },
      ],
      venueDefault: "es-ES",
      loginDefault: "es-ES",
    }),
    setWorkingOrderLabel: vi.fn(async (_id: string, request: { revision: number }) => ({
      revision: request.revision + 1,
    })),
    getKitchenNote: vi.fn(async (scope: { workingOrderId: string } | { partyId: string }) => ({
      scope,
      note: null,
      revision: 0,
      ownerRevision: 0,
    })),
    getTill: vi.fn().mockResolvedValue({
      locale: "es-ES",
      venueName: "Bar Pepe",
      nif: "B12345678",
      orderFlow: "prepay",
      formFactor: "till",
      capabilities: ["show-station", "show-expo", "show-schedule"],
    }),
    listStaff: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ana" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    listProducts: vi.fn().mockResolvedValue({ menus: [defaultMenu], products }),
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      service: {
        open: true,
        zoneOpen: true,
        periodName: null,
        periodOccurrenceKey: null,
        keepOpen: null,
      },
      context: {
        departmentName: "Restaurant",
        zoneId: "zone-counter",
        departmentId: "department-default",
        serviceMode: "prepay",
      },
      defaultMenuId: defaultMenu.id,
      menus: servedMenus(
        [defaultMenu],
        [{ id: "menu-item-p1", menuId: defaultMenu.id, productId: products[0]!.id }],
      ),
      offers: [
        {
          id: "menu-item-p1",
          menuId: defaultMenu.id,
          productId: products[0]!.id,
          grossPrice: products[0]!.unitPrice,
          unitPrice: products[0]!.unitPrice,
          available: true,
          menuName: defaultMenu.name,
          placements: [[]],
          name: products[0]!.name,
          customerName: products[0]!.customerName ?? null,
          pricingUnit: products[0]!.pricingUnit,
          vatClass: products[0]!.vatClass,
          category: "Other",
          allergens: products[0]!.allergens,
          diet: null,
          dietDerivation: null,
          dietOverride: null,
          courseId: null,
          offeredModifiers: [],
          variants: [],
        },
      ],
    }),
    setServiceZone: vi.fn(),
    recordSale: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi
      .fn()
      .mockResolvedValue([
        { id: "st-default", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
      ]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
    }),
    ...overrides,
  } as unknown as TillApi;
}

const counterFormFactor = "till";

async function flush(el: TillApp): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("till-app a11y (%s theme)", (theme) => {
  it("has no violations on the composed counter screen after login", async () => {
    const { el, host } = await mountWidget<TillApp>("till-app", { api: stubApi() }, theme);
    await flush(el);
    el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
      new CustomEvent("logged-in", {
        detail: { personId: "p1", displayName: "Ana", permissions: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on the composed counter screen for Mode I with the Place control", async () => {
    const api = stubApi({
      getTill: vi.fn().mockResolvedValue({
        locale: "es-ES",
        venueName: "Bar Pepe",
        nif: "B12345678",
        orderFlow: "ticket_then_pay",
        formFactor: "till",
        capabilities: ["show-station", "show-expo", "show-schedule"],
      }),
      getStationQueue: vi.fn().mockResolvedValue({
        items: [
          {
            orderId: "wo-1",
            orderNumber: 5,
            label: "Mesa 4",
            queuedAt: "2026-08-17T10:00:00.000Z",
            thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
            items: [
              {
                id: "ti-1",
                workingOrderLineId: "wol-1",
                state: "queued",
                descriptions: { "es-ES": "Paella" },
                quantity: "2.000",
              },
            ],
          },
        ],
        notices: [],
      }),
    });
    const { el, host } = await mountWidget<TillApp>("till-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
      new CustomEvent("logged-in", {
        detail: { personId: "p1", displayName: "Ana", permissions: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("till-counter-screen")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations while a failed refresh after a successful hold is retried", async () => {
    const api = stubApi({
      getContentLanguages: vi
        .fn()
        .mockResolvedValue({ defaultLanguage: "es", languages: ["es", "en"] }),
      getTill: vi.fn().mockResolvedValue({
        locale: "es-ES",
        venueName: "Bar Pepe",
        nif: "B12345678",
        orderFlow: "prepay",
        courses: [],
        capabilities: [],
        formFactor: "till",
      }),
      parkOrder: vi.fn().mockResolvedValue({ id: "wo-1", orderNumber: 5 }),
      listWorkingOrders: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockRejectedValue(new TypeError("Failed to fetch")),
    });
    const { el, host } = await mountWidget<TillApp>("till-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
      new CustomEvent("logged-in", {
        detail: { personId: "p1", displayName: "Ana", permissions: [] },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    const counter = el.shadowRoot!.querySelector<TillCounterScreen>("till-counter-screen")!;
    counter.store.addProduct({ ...products[0]!, menuItemId: "menu-item-p1" }, "1");
    counter.dispatchEvent(
      new CustomEvent("park-order", { detail: {}, bubbles: true, composed: true }),
    );
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-refresh-retry]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("has no violations on the floor while it says what a completed draft sent", async () => {
    const floorFormFactor = "till";
    const party = {
      kitchenNote: { scope: { partyId: "v1" }, note: null, revision: 0, ownerRevision: 3 },
      id: "v1",
      revision: 3,
      guestCount: 2,
      state: "open",
      mainBillId: "wo-4",
      outstanding: "0.00",
      billCount: 1,
      tableIds: ["t4"],
      unsentDrafts: [],
      reminder: null,
    };
    const base = stubApi();
    const api = stubApi({
      getTill: vi.fn().mockResolvedValue({
        locale: "es-ES",
        venueName: "Bar Pepe",
        nif: "B12345678",
        orderFlow: "prepay",
        courses: [],
        capabilities: [],
        fireControl: "waiter",
        formFactor: floorFormFactor,
      }),
      listZoneOffers: base.listDefaultZoneOffers,
      listZones: vi
        .fn()
        .mockResolvedValue([
          { id: "z1", name: "Comedor", displayOrder: 0, active: true, serviceMode: "table_tab" },
        ]),
      getTablesState: vi.fn().mockResolvedValue([
        {
          id: "t4",
          label: "4",
          zoneId: "z1",
          state: "open-tab",
          hasOpenTab: true,
          tabLineCount: 0,
          tabTotal: "0.00",
          pendingDeliveries: 0,
          pendingToServe: 0,
          readyToServe: 0,
          enRoute: 0,
          timingBand: "fresh",
          nextReservation: null,
          today: null,
          signals: [],
          party: party,
        },
      ]),
      getTabLines: vi.fn().mockResolvedValue({ lines: [], revision: 0, editSentLines: true }),
      listGroups: vi.fn().mockResolvedValue({ revision: 3, groups: [] }),
      getPartyBills: vi.fn().mockResolvedValue([]),
      ...(({ listDrafts, saveDraft, submitDraft }) => ({ listDrafts, saveDraft, submitDraft }))(
        draftServer(),
      ),
    });
    const { el, host } = await mountWidget<TillApp>("till-app", { api }, theme);
    Object.assign(api, answeredPartyAllergy(el));
    await flush(el);
    const emit = (source: Element, type: string, detail: unknown) =>
      source.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    emit(el.shadowRoot!.querySelector("till-lock-screen")!, "logged-in", {
      personId: "p1",
      displayName: "Ana",
      permissions: [],
    });
    await flush(el);
    emit(el.shadowRoot!.querySelector("till-shell")!, "screen-select", { screen: "floor" });
    await flush(el);
    const grid = el;
    emit(grid.shadowRoot!.querySelector("till-floor-screen")!, "open-table", {
      tableId: "t4",
      seated: true,
    });
    await flush(el);
    await flush(el);
    const order = el.shadowRoot!.querySelector<TillTableOrderScreen>("till-table-order-screen")!;
    order
      .shadowRoot!.querySelector<TillMenuBrowser>("till-menu-browser")!
      .store.addProduct({ ...products[0]!, menuItemId: "menu-item-p1" }, "1");
    await flush(el);
    order.shadowRoot!.querySelector<HTMLElement>('[data-draft-action="send-all"]')!.click();
    await flush(el);
    await flush(el);
    await flush(el);

    const toast = el.shadowRoot!.querySelector<WtToast>("wt-toast[data-submitted-toast]")!;
    expect(toast.open).toBe(true);
    expect(el.shadowRoot!.querySelector("till-table-order-screen")).toBeNull();
    await toast.updateComplete;
    await expectNoA11yViolations(host);
  });
});

describe.each(["light", "dark"] as const)(
  "shell without technical clock notices (%s theme)",
  (theme) => {
    it("is accessible in both languages and widths", async () => {
      const { el, host } = await mountWidget<TillApp>(
        "till-app",
        {
          api: stubApi({
            getTill: async () => ({
              locale: "es-ES",
              venueName: "Bar Pepe",
              nif: "B12345678",
              orderFlow: "prepay",
              courses: [],
              capabilities: [],
              formFactor: counterFormFactor,
            }),
          }),
        },
        theme,
      );
      await flush(el);
      el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
        new CustomEvent("logged-in", {
          detail: { personId: "p1", displayName: "Ana", permissions: [] },
          bubbles: true,
          composed: true,
        }),
      );
      await flush(el);
      try {
        for (const locale of ["en-GB", "es-ES"] as const) {
          setLocale(locale);
          await el.updateComplete;
          for (const width of [390, 1280]) {
            await page.viewport(width, 900);
            expect(el.shadowRoot!.textContent).not.toContain("Check the server's date and time");
            expect(el.shadowRoot!.textContent).not.toContain("has not been verified");
            expect(el.shadowRoot!.textContent).not.toContain("Comprueba su fecha y hora");
            expect(el.shadowRoot!.textContent).not.toContain("No se ha verificado el reloj");
            await expectNoA11yViolations(host);
            if (import.meta.env.VITE_A364_VISUAL === "1")
              await page.screenshot({
                path: `__screenshots__/a364-shell-${theme}-${locale}-${width}.png`,
              });
          }
        }
      } finally {
        await page.viewport(1280, 720);
        setLocale("es-ES");
      }
    });
  },
);

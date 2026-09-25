import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import "./till-app.js";
import type { TillApp } from "./till-app.js";
import type { TillApi, TillProduct } from "./api/client.js";

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
    getTill: vi.fn().mockResolvedValue({
      locale: "es-ES",
      venueName: "Bar Pepe",
      nif: "B12345678",
      orderFlow: "prepay",
    }),
    listStaff: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ana" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    listProducts: vi.fn().mockResolvedValue({ menus: [defaultMenu], products }),
    listDefaultZoneOffers: vi.fn().mockResolvedValue({
      context: {
        zoneId: "zone-counter",
        departmentId: "department-default",
        serviceMode: "prepay",
      },
      defaultMenuId: defaultMenu.id,
      menus: [defaultMenu],
      offers: [
        {
          id: "menu-item-p1",
          menuId: defaultMenu.id,
          productId: products[0]!.id,
          sectionId: "section-drinks",
          grossPrice: products[0]!.unitPrice,
          unitPrice: products[0]!.unitPrice,
          displayOrder: 0,
          active: true,
          menuName: defaultMenu.name,
          sectionName: { en: "Other" },
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
        },
      ],
    }),
    setServiceZone: vi.fn(),
    recordSale: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listStations: vi
      .fn()
      .mockResolvedValue([
        { id: "st-default", name: "Cocina", displayOrder: 0, isDefault: true, active: true },
      ]),
    getStationQueue: vi.fn().mockResolvedValue([]),
    advanceTicketItem: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getDevDevices: vi.fn().mockRejectedValue({ code: "server.internal" }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "till-dev",
      name: "Till 1",
      formFactor: "till",
      stationId: null,
      tillId: "t1",
    }),
    ...overrides,
  } as unknown as TillApi;
}

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
        detail: { personId: "p1", displayName: "Ana" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });

  it("has no violations on the composed counter screen for Mode I (Place control + station queue together)", async () => {
    const api = stubApi({
      getTill: vi.fn().mockResolvedValue({
        locale: "es-ES",
        venueName: "Bar Pepe",
        nif: "B12345678",
        orderFlow: "invoice_first",
      }),
      getStationQueue: vi.fn().mockResolvedValue([
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
      ]),
    });
    const { el, host } = await mountWidget<TillApp>("till-app", { api }, theme);
    await flush(el);
    el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
      new CustomEvent("logged-in", {
        detail: { personId: "p1", displayName: "Ana" },
        bubbles: true,
        composed: true,
      }),
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});

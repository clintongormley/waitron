import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./widgets/test-helpers.js";
import "./till-app.js";
import type { TillApp } from "./till-app.js";
import type { TillApi, TillProduct } from "./api/client.js";

const products: TillProduct[] = [
  {
    id: "p1",
    descriptions: { "es-ES": "Café" },
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "general",
    category: null,
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
    listProducts: vi.fn().mockResolvedValue(products),
    recordSale: vi.fn(),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listPrepQueue: vi.fn().mockResolvedValue([]),
    logout: vi.fn().mockResolvedValue(undefined),
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

  it("has no violations on the composed counter screen for Mode I (Place control + prep queue together)", async () => {
    const api = stubApi({
      getTill: vi.fn().mockResolvedValue({
        locale: "es-ES",
        venueName: "Bar Pepe",
        nif: "B12345678",
        orderFlow: "invoice_first",
      }),
      listPrepQueue: vi.fn().mockResolvedValue([
        {
          id: "wo-1",
          orderNumber: 5,
          label: "Mesa 4",
          state: "queued",
          queuedAt: "2026-08-06T10:00:00.000Z",
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

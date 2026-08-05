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

function stubApi(): TillApi {
  return {
    getTill: vi
      .fn()
      .mockResolvedValue({ locale: "es-ES", venueName: "Bar Pepe", nif: "B12345678" }),
    listStaff: vi.fn().mockResolvedValue([{ personId: "p1", displayName: "Ana" }]),
    login: vi.fn().mockResolvedValue({ personId: "p1" }),
    listProducts: vi.fn().mockResolvedValue(products),
    recordSale: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
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
});

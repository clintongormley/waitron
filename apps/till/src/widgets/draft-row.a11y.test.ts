import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { formatMoney } from "@waitron/shared";
import { currentLocale } from "../i18n/t.js";
import { WorkingOrderStore, type OrderLine } from "../state/working-order.js";
import type { TillProduct } from "../api/menu-api.js";
import "./basket.js";
import type { TillBasket } from "./basket.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

const dish = (id: string, name: string): TillProduct => ({
  id,
  name,
  unitPrice: "7.80",
  pricingUnit: "each",
  vatClass: "general",
  category: null,
  allergens: { gluten: { kinds: ["wheat"] } },
});
const croquettes = dish("croquettes", "Croquettes");
const bravas = dish("bravas", "Bravas");

async function mount(theme: "light" | "dark", lines: OrderLine[], props: Partial<TillBasket> = {}) {
  const store = new WorkingOrderStore();
  store.loadFrom("draft", lines);
  const mounted = await mountWidget<TillBasket>(
    "till-basket",
    { store, lineDetails: true, stacked: true, compactRows: true, ...props },
    theme,
  );
  return { ...mounted, store };
}

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("compact draft rows a11y (%s theme)", (theme) => {
  it("a plain row has no violations and one button named by quantity, name and price", async () => {
    const { el, host } = await mount(theme, [{ product: croquettes, quantity: "2" }]);
    expect(el.shadowRoot!.querySelectorAll("button")).toHaveLength(1);
    const price = formatMoney("15.60", currentLocale()).replace(/[.]/g, "\\.");
    const named = page.getByRole("button", { name: new RegExp(`^2 Croquettes .*${price}$`) });
    expect(named.elements()).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("the row added last has no violations", async () => {
    const { el, host, store } = await mount(theme, [{ product: bravas, quantity: "1" }]);
    store.addProduct(croquettes, "1");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll("[data-last-added]")).toHaveLength(1);
    await expectNoA11yViolations(host);
  });

  it("a row carrying warnings has no violations", async () => {
    const { el, host } = await mount(theme, [
      {
        product: croquettes,
        quantity: "1",
        notOffered: true,
        endedPeriod: { periodName: "Lunch" },
        notOfferedExtras: [
          { productId: "aioli", listId: "sauces", name: "Aioli", price: "0.50", quantity: 2 },
        ],
      } as OrderLine,
    ]);
    const warning = document.createElement("div");
    warning.slot = "after-0";
    warning.textContent = "⚠ Kitchen is closed";
    el.append(warning);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("[data-period-ended]")).not.toBeNull();
    await expectNoA11yViolations(host);
  });

  it("a disabled row has no violations", async () => {
    const { el, host } = await mount(theme, [{ product: croquettes, quantity: "1" }], {
      orderInFlight: true,
    });
    expect(el.shadowRoot!.querySelector<HTMLButtonElement>("[data-draft-row]")!.disabled).toBe(
      true,
    );
    await expectNoA11yViolations(host);
  });
});

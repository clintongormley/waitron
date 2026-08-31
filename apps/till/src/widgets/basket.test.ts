import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillBasket } from "./basket.js";
import type { TillProduct } from "../api/client.js";
import type { SelectedLineOption } from "../state/working-order.js";

const cafe: TillProduct = {
  id: "cafe",
  descriptions: { es: "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const jamon: TillProduct = {
  id: "jamon",
  descriptions: { es: "Jamón" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

afterEach(cleanupWidgets);

describe("till-basket", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-basket")).toBe(TillBasket);
  });

  it("shows the empty placeholder when there are no lines", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.querySelectorAll(".line")).toHaveLength(0);
    expect(el.shadowRoot!.textContent).toContain(t("basket.empty"));
  });

  it("renders a row per line with name, quantity and gross line total", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const rows = el.shadowRoot!.querySelectorAll(".line");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Café");
    expect(rows[0]!.textContent).toContain("2");
    // 1.50 × 2, rounded to money scale.
    expect(rows[0]!.textContent).toContain(formatMoney("3.00"));
  });

  it("labels a weight line's quantity in kg and prices it by weight", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(jamon, "0.320");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const row = el.shadowRoot!.querySelector(".line")!;
    expect(row.textContent).toContain("0.320");
    expect(row.textContent).toContain("kg");
    // 10.00 × 0.320 = 3.20.
    expect(row.textContent).toContain(formatMoney("3.20"));
  });

  it("re-renders when the store changes after mount", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.textContent).toContain(t("basket.empty"));
    store.addProduct(cafe, "1");
    await el.updateComplete;
    expect(el.shadowRoot!.querySelectorAll(".line")).toHaveLength(1);
  });

  it("a remove control drops its own line from the basket", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1");
    store.addProduct(jamon, "0.100");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const removeButtons = el.shadowRoot!.querySelectorAll<HTMLElement>(".remove");
    expect(removeButtons).toHaveLength(2);
    removeButtons[0]!.click();
    await el.updateComplete;
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toBe(jamon);
  });

  // Dish-line quantity (feature B): an `each` line carries a −/+ stepper that drives the store's
  // setLineQuantity WITHOUT merging lines; a weight line keeps its static kg label (a measured weight
  // has no +/-). Deletion stays with the × remove control — `−` never removes a line.
  it("an each line renders a −/count/+ stepper and + increments the line quantity via the store", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const row = el.shadowRoot!.querySelector(".line")!;
    expect(row.querySelector(".count")!.textContent).toContain("2");
    row.querySelector<HTMLElement>(".step-inc")!.click();
    await el.updateComplete;
    expect(store.lines[0]!.quantity).toBe("3");
    expect(el.shadowRoot!.querySelector(".count")!.textContent).toContain("3");
  });

  it("the − step decrements the line quantity but is DISABLED at quantity 1 (delete is via ×, not −)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "2");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const dec = () =>
      el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(".step-dec")!;
    expect(dec().disabled).toBe(false);
    dec().click();
    await el.updateComplete;
    expect(store.lines[0]!.quantity).toBe("1");
    // At 1, the − is disabled and the line is NOT removed (deletion is the × control's job).
    expect(dec().disabled).toBe(true);
    expect(store.lines).toHaveLength(1);
  });

  it("a weight line keeps the static kg label and shows no stepper (a measured weight has no +/-)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(jamon, "0.320");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const row = el.shadowRoot!.querySelector(".line")!;
    expect(row.textContent).toContain("0.320");
    expect(row.textContent).toContain("kg");
    expect(row.querySelector(".step-inc")).toBeNull();
    expect(row.querySelector(".step-dec")).toBeNull();
  });

  it("groups a line's options under the dish — dish at its own price, options indented at their delta, no per-option remove", async () => {
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      descriptions: { es: "Hamburguesa" },
      unitPrice: "10.00",
    };
    const extraCheese: SelectedLineOption = {
      optionGroupItemId: "opt-cheese",
      name: { es: "Extra queso" },
      priceDelta: "0.50",
    };
    const noOnion: SelectedLineOption = {
      optionGroupItemId: "opt-noonion",
      name: { es: "Sin cebolla" },
      priceDelta: "0.00", // a FREE option
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", [extraCheese, noOnion]);
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    // One dish row and two indented option rows.
    const dishRows = el.shadowRoot!.querySelectorAll(".line");
    const optionRows = el.shadowRoot!.querySelectorAll(".option");
    expect(dishRows).toHaveLength(1);
    expect(optionRows).toHaveLength(2);

    // The dish shows its OWN gross (10.00 × 1), never the dish+options running total (10.50).
    expect(dishRows[0]!.textContent).toContain("Hamburguesa");
    expect(dishRows[0]!.textContent).toContain(formatMoney("10.00"));

    // Each option is indented under the dish and shows its delta; the free one shows 0.00.
    expect(optionRows[0]!.textContent).toContain("Extra queso");
    expect(optionRows[0]!.textContent).toContain(formatMoney("0.50"));
    expect(optionRows[1]!.textContent).toContain("Sin cebolla");
    expect(optionRows[1]!.textContent).toContain(formatMoney("0.00"));

    // A child option is NOT independently deletable: only the dish carries a remove control, and no
    // option row carries a stepper (a modifier is counted through the picker, not the basket).
    expect(el.shadowRoot!.querySelectorAll(".remove")).toHaveLength(1);
    expect(el.shadowRoot!.querySelectorAll(".option .step-inc")).toHaveLength(0);
  });

  // ×N badge (features A + B): an option taken more than once per dish shows a `×{quantity}` badge on
  // its name; a plain (quantity 1/absent) option renders exactly as before. `quantity` here is the
  // CLIENT per-dish count carried directly on the selected option — no derivation.
  it("appends a ×N badge to an option taken more than once per dish, and none to a plain option", async () => {
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      descriptions: { es: "Hamburguesa" },
      unitPrice: "10.00",
    };
    const extraShotX2: SelectedLineOption = {
      optionGroupItemId: "opt-shot",
      name: { es: "Extra chupito" },
      priceDelta: "0.50",
      quantity: 2,
    };
    const plain: SelectedLineOption = {
      optionGroupItemId: "opt-plain",
      name: { es: "Sin cebolla" },
      priceDelta: "0.00",
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", [extraShotX2, plain]);
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const optionRows = el.shadowRoot!.querySelectorAll(".option");
    expect(optionRows[0]!.textContent).toContain("Extra chupito");
    expect(optionRows[0]!.textContent).toContain("×2"); // stepped option → badge
    expect(optionRows[1]!.textContent).toContain("Sin cebolla");
    expect(optionRows[1]!.textContent).not.toContain("×"); // plain option → no badge
  });

  it("removing the parent dish removes its options with it", async () => {
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      descriptions: { es: "Hamburguesa" },
      unitPrice: "10.00",
    };
    const extraCheese: SelectedLineOption = {
      optionGroupItemId: "opt-cheese",
      name: { es: "Extra queso" },
      priceDelta: "0.50",
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", [extraCheese]);
    store.addProduct(cafe, "1"); // a second, plain line
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.querySelectorAll(".option")).toHaveLength(1);

    // Remove the dish that carries the option (the first remove control).
    el.shadowRoot!.querySelectorAll<HTMLElement>(".remove")[0]!.click();
    await el.updateComplete;

    // The whole line — dish and its option — is gone; only the plain café line remains.
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toBe(cafe);
    expect(el.shadowRoot!.querySelectorAll(".option")).toHaveLength(0);
  });

  it("unsubscribes on disconnect so a later change does not re-render it", async () => {
    const store = new WorkingOrderStore();
    const { el, host } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.textContent).toContain(t("basket.empty"));
    host.remove(); // disconnectedCallback → unsubscribe
    store.addProduct(cafe, "1");
    await el.updateComplete;
    // Still empty: a disconnected basket never heard the change.
    expect(el.shadowRoot!.querySelectorAll(".line")).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillBasket } from "./basket.js";
import type { TillOptionItem, TillProduct } from "../api/client.js";
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

  // ── As-served allergens (modifier↔allergen, Task 7) ──────────────────────────────────────────
  // The basket computes each line's AS-SERVED allergen profile CLIENT-side — the dish's declared
  // allergens folded with its selected options' overlays (`deriveAsServedAllergens`, the shared
  // catalogue leaf) — the same way it already computes display prices without a server round trip.

  it("shows the as-served allergen set for a dish with a gluten-removing modifier — gluten gone, no pending note", async () => {
    const glutenFreeBun: TillOptionItem = {
      id: "opt-1",
      name: { es: "Pan sin gluten" },
      priceDelta: "0.00",
      vatClass: null,
      maxQuantity: 1,
      addAllergens: null,
      removeAllergens: ["gluten"],
      addOrigins: null,
      removeOrigins: null,
    };
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      descriptions: { es: "Hamburguesa" },
      unitPrice: "10.00",
      allergens: { gluten: { presence: "contains" } }, // base REVIEWED, declares gluten
      optionGroups: [
        {
          id: "grp-bun",
          name: { es: "Pan" },
          minSelect: 0,
          maxSelect: 1,
          required: false,
          items: [glutenFreeBun],
        },
      ],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", [
      { optionGroupItemId: "opt-1", name: { es: "Pan sin gluten" }, priceDelta: "0.00" },
    ]);
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const asServed = el.shadowRoot!.querySelector(`[data-test="line-allergens-0"]`);
    expect(asServed).not.toBeNull();
    // The modifier strips the base gluten → the as-served set names no gluten (the label "Cereales
    // con gluten"/"Cereals containing gluten" both contain the word, so its absence proves the strip).
    expect(asServed!.textContent).not.toMatch(/gluten/i);
    // The base was reviewed, so nothing is pending: no "not fully reviewed" note.
    expect(asServed!.textContent).not.toMatch(/review|pendiente/i);
  });

  it("marks the as-served set 'not fully reviewed' when the dish's own allergens are unreviewed (Cautious)", async () => {
    const extraCheese: TillOptionItem = {
      id: "opt-cheese",
      name: { es: "Extra queso" },
      priceDelta: "0.50",
      vatClass: null,
      maxQuantity: 1,
      addAllergens: { milk: { presence: "contains" } },
      removeAllergens: null,
      addOrigins: null,
      removeOrigins: null,
    };
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      descriptions: { es: "Hamburguesa" },
      unitPrice: "10.00",
      allergens: null, // base UNREVIEWED → the plate stays pending
      optionGroups: [
        {
          id: "grp-extras",
          name: { es: "Extras" },
          minSelect: 0,
          maxSelect: 1,
          required: false,
          items: [extraCheese],
        },
      ],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", [
      { optionGroupItemId: "opt-cheese", name: { es: "Extra queso" }, priceDelta: "0.50" },
    ]);
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const asServed = el.shadowRoot!.querySelector(`[data-test="line-allergens-0"]`);
    expect(asServed).not.toBeNull();
    // Unreviewed base → the always-safe ADD still shows (milk), and the waiter sees the note.
    expect(asServed!.textContent).toMatch(/milk|leche/i);
    expect(asServed!.textContent).toMatch(/review|pendiente/i);
  });

  it("shows the as-served set for a plain dish that carries allergens even with no modifiers", async () => {
    const tostada: TillProduct = {
      ...cafe,
      id: "tostada",
      descriptions: { es: "Tostada" },
      allergens: { gluten: { presence: "contains" } },
    };
    const store = new WorkingOrderStore();
    store.addProduct(tostada, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const asServed = el.shadowRoot!.querySelector(`[data-test="line-allergens-0"]`);
    expect(asServed).not.toBeNull();
    expect(asServed!.textContent).toMatch(/gluten/i);
    expect(asServed!.textContent).not.toMatch(/review|pendiente/i);
  });

  it("renders NO allergen row for a plain no-allergen line (avoids noise)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1"); // allergens: null, no options
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.querySelector(`[data-test="line-allergens-0"]`)).toBeNull();
  });

  // A STALE selection — an `optionGroupItemId` absent from the product's option groups (`itemById.get`
  // misses) — must degrade to an EMPTY overlay rather than throwing (`as-served.ts`). The row still
  // renders from the reviewed base; the phantom option folds as no add/no remove.
  it("degrades a stale option selection to no overlay without throwing", async () => {
    const realCheese: TillOptionItem = {
      id: "opt-real",
      name: { es: "Extra queso" },
      priceDelta: "0.50",
      vatClass: null,
      maxQuantity: 1,
      addAllergens: { milk: { presence: "contains" } },
      removeAllergens: null,
      addOrigins: null,
      removeOrigins: null,
    };
    const tostada: TillProduct = {
      ...cafe,
      id: "tostada-stale",
      descriptions: { es: "Tostada" },
      allergens: { gluten: { presence: "contains" } }, // base REVIEWED → the row renders
      optionGroups: [
        {
          id: "grp-extras",
          name: { es: "Extras" },
          minSelect: 0,
          maxSelect: 1,
          required: false,
          items: [realCheese],
        },
      ],
    };
    const store = new WorkingOrderStore();
    // The selection points at an id NOT present in `optionGroups` (a stale/removed option).
    const stale: SelectedLineOption = {
      optionGroupItemId: "opt-ghost",
      name: { es: "Fantasma" },
      priceDelta: "0.00",
    };
    store.addProduct(tostada, "1", [stale]);
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const asServed = el.shadowRoot!.querySelector(`[data-test="line-allergens-0"]`);
    expect(asServed).not.toBeNull();
    // Base gluten survives; the phantom option added nothing (no milk) and removed nothing, and no throw.
    expect(asServed!.textContent).toMatch(/gluten/i);
    expect(asServed!.textContent).not.toMatch(/milk|leche/i);
    expect(asServed!.textContent).not.toMatch(/review|pendiente/i);
  });

  // ── As-served diet & contains badges (dietary-classification, Task 7) ────────────────────────
  // The basket computes each line's AS-SERVED DIET profile CLIENT-side (`asServedDiet`, the diet twin
  // of `asServedAllergens`) and renders vegan/vegetarian/halal/kosher badges + contains chips beside
  // the allergen chips — with a NEUTRAL "not reviewed" note (never a positive claim) when pending.

  it("shows a vegan badge for a plant-only reviewed dish", async () => {
    const salad: TillProduct = {
      ...cafe,
      id: "salad",
      descriptions: { es: "Ensalada" },
      dietDerivation: { origins: ["plant"], pending: false },
    };
    const store = new WorkingOrderStore();
    store.addProduct(salad, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const diet = el.shadowRoot!.querySelector(`[data-test="line-diet-0"]`);
    expect(diet).not.toBeNull();
    expect(diet!.querySelector("[data-diet='vegan']")).not.toBeNull();
    expect(diet!.querySelector("[data-diet='vegetarian']")).not.toBeNull();
    expect(diet!.textContent).toContain(t("diet.vegan"));
    // A reviewed dish makes no "not reviewed" claim.
    expect(diet!.textContent).not.toMatch(/review|revisi/i);
  });

  it("shows a contains-meat chip and no positive badge for a meat dish", async () => {
    const chuleta: TillProduct = {
      ...cafe,
      id: "chuleta",
      descriptions: { es: "Chuleta" },
      dietDerivation: { origins: ["meat"], pending: false },
    };
    const store = new WorkingOrderStore();
    store.addProduct(chuleta, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const diet = el.shadowRoot!.querySelector(`[data-test="line-diet-0"]`);
    expect(diet).not.toBeNull();
    expect(diet!.querySelector("[data-diet-contains='meat']")).not.toBeNull();
    expect(diet!.textContent).toContain(t("diet.contains.meat"));
    // A meat dish is neither vegan nor vegetarian — no positive badge.
    expect(diet!.querySelector("[data-diet='vegan']")).toBeNull();
    expect(diet!.querySelector("[data-diet='vegetarian']")).toBeNull();
  });

  it("shows the NEUTRAL 'not reviewed' state for an unreviewed (pending) diet, never a positive claim", async () => {
    const mystery: TillProduct = {
      ...cafe,
      id: "mystery",
      descriptions: { es: "Plato del día" },
      dietDerivation: { origins: [], pending: true },
    };
    const store = new WorkingOrderStore();
    store.addProduct(mystery, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const diet = el.shadowRoot!.querySelector(`[data-test="line-diet-0"]`);
    expect(diet).not.toBeNull();
    expect(diet!.querySelector("[data-diet-pending]")).not.toBeNull();
    expect(diet!.textContent).toMatch(/review|revisi/i);
    // Pending must NOT read as vegan/vegetarian.
    expect(diet!.querySelector("[data-diet='vegan']")).toBeNull();
    expect(diet!.querySelector("[data-diet='vegetarian']")).toBeNull();
  });

  it("renders NO diet row for a product carrying no diet data (avoids noise)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1"); // no dietDerivation / dietOverride
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.querySelector(`[data-test="line-diet-0"]`)).toBeNull();
  });

  it("re-derives the as-served diet from a meat-adding modifier (contains meat)", async () => {
    const addBacon: TillOptionItem = {
      id: "opt-bacon",
      name: { es: "Beicon" },
      priceDelta: "1.00",
      vatClass: null,
      maxQuantity: 1,
      addAllergens: null,
      removeAllergens: null,
      addOrigins: ["meat"],
      removeOrigins: null,
    };
    const salad: TillProduct = {
      ...cafe,
      id: "salad-bacon",
      descriptions: { es: "Ensalada" },
      dietDerivation: { origins: ["plant"], pending: false },
      optionGroups: [
        {
          id: "grp-extras",
          name: { es: "Extras" },
          minSelect: 0,
          maxSelect: 1,
          required: false,
          items: [addBacon],
        },
      ],
    };
    const store = new WorkingOrderStore();
    store.addProduct(salad, "1", [
      { optionGroupItemId: "opt-bacon", name: { es: "Beicon" }, priceDelta: "1.00" },
    ]);
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const diet = el.shadowRoot!.querySelector(`[data-test="line-diet-0"]`);
    expect(diet).not.toBeNull();
    // Adding a meat origin drops vegan and adds the contains-meat chip.
    expect(diet!.querySelector("[data-diet-contains='meat']")).not.toBeNull();
    expect(diet!.querySelector("[data-diet='vegan']")).toBeNull();
  });

  it("shows halal + kosher badges from a staff override", async () => {
    const kebab: TillProduct = {
      ...cafe,
      id: "kebab",
      descriptions: { es: "Kebab" },
      dietDerivation: { origins: ["meat"], pending: false },
      dietOverride: { halal: "yes", kosher: "yes" },
    };
    const store = new WorkingOrderStore();
    store.addProduct(kebab, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const diet = el.shadowRoot!.querySelector(`[data-test="line-diet-0"]`);
    expect(diet).not.toBeNull();
    expect(diet!.querySelector("[data-diet='halal']")).not.toBeNull();
    expect(diet!.querySelector("[data-diet='kosher']")).not.toBeNull();
    expect(diet!.querySelector("[data-diet-contains='meat']")).not.toBeNull();
  });

  it("renders NO diet row for a reviewed dish that is neither vegan/vegetarian nor tagged (nothing to assert)", async () => {
    const gelatin: TillProduct = {
      ...cafe,
      id: "gelatin",
      descriptions: { es: "Gelatina" },
      // Reviewed (not pending), an animal origin that is neither meat/fish nor vegetarian-ok → vegan
      // "no", vegetarian "no", contains [] — the helper has nothing positive to show, so no row.
      dietDerivation: { origins: ["other_animal"], pending: false },
    };
    const store = new WorkingOrderStore();
    store.addProduct(gelatin, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.querySelector(`[data-test="line-diet-0"]`)).toBeNull();
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

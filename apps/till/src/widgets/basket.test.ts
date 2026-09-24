import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { formatMoney } from "../i18n/format.js";
import { currentLocale, setLocale, t } from "../i18n/t.js";
import { setContentLanguages } from "@waitron/ui";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { allergenName } from "../i18n/allergen-names.js";
import { TillBasket } from "./basket.js";
import {
  sellingValuesOf,
  type OfferedExtraItem,
  type OfferedModifier,
  type TillProduct,
} from "../api/client.js";
import type { SelectedExtra } from "../state/working-order.js";

/**
 * One product an extras list offers. Its three names are DIFFERENT texts, so a surface reading the
 * customer or kitchen wording where it should read the staff name fails (CLAUDE.md §3).
 */
function offeredItem(
  productId: string,
  staff: string,
  price: string,
  declarations: Partial<Pick<OfferedExtraItem, "addAllergens" | "suitableFor">> = {},
): OfferedExtraItem {
  return {
    productId,
    name: staff,
    customerName: { es: `${staff} carta` },
    kitchenName: `${staff} KDS`,
    price,
    vatClass: "general",
    maxQuantity: 3,
    preselected: false,
    addAllergens: null,
    suitableFor: [],
    ...declarations,
  };
}

/** One extras list on offer, holding the given products. */
function offeredExtras(id: string, staff: string, items: OfferedExtraItem[]): OfferedModifier {
  return {
    kind: "extras",
    id,
    name: staff,
    customerName: { es: `${staff} carta` },
    kitchenName: `${staff} KDS`,
    minPicks: 0,
    maxPicks: null,
    items,
  };
}

/** One pick of an offered product, as a confirmed line carries it. */
function pick(listId: string, item: OfferedExtraItem, quantity = 1): SelectedExtra {
  return { listId, productId: item.productId, name: item.name, price: item.price, quantity };
}

const cafe: TillProduct = {
  id: "cafe",
  name: "Café",
  customerName: { es: "Café para el cliente" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

const jamon: TillProduct = {
  id: "jamon",
  name: "Jamón",
  customerName: { es: "Jamón para el cliente" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: "charcutería",
  allergens: null,
};

afterEach(cleanupWidgets);

describe("till-basket", () => {
  it("names a retrieved AND a new line by the staff name, whatever the content languages say", async () => {
    // The till's operator reads the venue's internal name. Both products here carry customer text in
    // the locale the till is showing AND in the only enabled content language, so a basket that
    // resolved a customer map would read "Hogaza" and "Pa de pagès" instead.
    const previousLocale = currentLocale();
    setLocale("en-GB");
    setContentLanguages({ defaultLanguage: "ca", languages: ["ca"] });
    try {
      const store = new WorkingOrderStore();
      store.loadFrom("held", [
        {
          workingOrderLineId: "stored-line",
          product: {
            ...cafe,
            name: "Pan de pueblo",
            customerName: { "en-GB": "Hogaza", ca: "Hogaza" },
          },
          quantity: "1",
          extras: [
            {
              listId: "list-spread",
              productId: "p-butter",
              name: "Mantequilla",
              price: "0.50",
              quantity: 1,
            },
          ],
        },
      ]);
      store.addProduct(
        {
          ...cafe,
          id: "fresh",
          name: "Bread",
          customerName: { "en-GB": "Pa de pagès", ca: "Pa de pagès" },
        },
        "1",
      );
      const { el } = await mountWidget<TillBasket>("till-basket", { store });
      expect(
        [...el.shadowRoot!.querySelectorAll(".line > .name")].map((node) => node.textContent),
      ).toEqual(["Pan de pueblo", "Bread"]);
      // A modifier is still named from its own per-language map — only the DISH name changed.
      expect(el.shadowRoot!.querySelector(".option .name")!.textContent).toContain("Mantequilla");
      expect(el.shadowRoot!.querySelector(".step-inc")!.getAttribute("aria-label")).toContain(
        "Pan de pueblo",
      );
    } finally {
      setLocale(previousLocale);
    }
  });

  it("names the line by the chosen variant's staff name, not its customer translation", async () => {
    const previousLocale = currentLocale();
    setLocale("es-ES");
    setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
    try {
      const store = new WorkingOrderStore();
      store.addProduct(
        {
          ...cafe,
          variantId: "large",
          variantName: "Large",
          variantCustomerName: { es: "Taza grande", "es-ES": "Taza grande" },
        },
        "1",
      );
      const { el } = await mountWidget<TillBasket>("till-basket", { store });
      expect(el.shadowRoot!.querySelector(".line > .name")!.textContent).toBe("Large");
    } finally {
      setLocale(previousLocale);
    }
  });

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

  it("keeps a custom fractional unit static even without a hardware mapping", async () => {
    const portion: TillProduct = {
      ...cafe,
      id: "portion",
      unit: {
        id: "unit-portion",
        name: { en: "tray" },
        abbreviation: { en: "tray" },
        precision: 2,
        hardwareUnit: null,
      },
    };
    const store = new WorkingOrderStore();
    store.addProduct(portion, "0.25");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const row = el.shadowRoot!.querySelector(".line")!;
    expect(row.textContent).toContain("0.25 tray");
    expect(row.querySelector(".step-inc")).toBeNull();
    expect(row.querySelector(".step-dec")).toBeNull();
  });

  it("groups a line's extras under the dish — dish at its own price, picks indented, no per-pick remove", async () => {
    const cheese = offeredItem("p-cheese", "Extra queso", "0.50");
    const noOnion = offeredItem("p-noonion", "Sin cebolla", "0.00"); // a FREE pick
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      name: "Hamburguesa",
      customerName: { es: "Hamburguesa para el cliente" },
      unitPrice: "10.00",
      offeredModifiers: [offeredExtras("list-extras", "Extras", [cheese, noOnion])],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", {
      extras: [pick("list-extras", cheese), pick("list-extras", noOnion)],
    });
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    // One dish row and two indented pick rows.
    const dishRows = el.shadowRoot!.querySelectorAll(".line");
    const optionRows = el.shadowRoot!.querySelectorAll(".option");
    expect(dishRows).toHaveLength(1);
    expect(optionRows).toHaveLength(2);

    // The dish shows its OWN gross (10.00 × 1), never the dish+picks running total (10.50).
    expect(dishRows[0]!.textContent).toContain("Hamburguesa");
    expect(dishRows[0]!.textContent).toContain(formatMoney("10.00"));

    // Each pick is indented under the dish at its own gross, by its STAFF name; the free one is 0.00.
    expect(optionRows[0]!.textContent).toContain("Extra queso");
    expect(optionRows[0]!.textContent).not.toContain("Extra queso carta");
    expect(optionRows[0]!.textContent).toContain(formatMoney("0.50"));
    expect(optionRows[1]!.textContent).toContain("Sin cebolla");
    expect(optionRows[1]!.textContent).toContain(formatMoney("0.00"));

    // A child is NOT independently deletable: only the dish carries a remove control, and no pick row
    // carries a stepper (a pick is counted through the picker, not the basket).
    expect(el.shadowRoot!.querySelectorAll(".remove")).toHaveLength(1);
    expect(el.shadowRoot!.querySelectorAll(".option .step-inc")).toHaveLength(0);
  });

  // A pick taken more than once per dish shows a `×{quantity}` badge on its name; a single pick
  // shows none. The count is the per-dish one carried on the pick — no derivation.
  it("appends a ×N badge to a pick taken more than once per dish, and none to a single pick", async () => {
    const shot = offeredItem("p-shot", "Extra chupito", "0.50");
    const plain = offeredItem("p-plain", "Sin cebolla", "0.00");
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      name: "Hamburguesa",
      customerName: { es: "Hamburguesa para el cliente" },
      unitPrice: "10.00",
      offeredModifiers: [offeredExtras("list-extras", "Extras", [shot, plain])],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", {
      extras: [pick("list-extras", shot, 2), pick("list-extras", plain)],
    });
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const optionRows = el.shadowRoot!.querySelectorAll(".option");
    expect(optionRows[0]!.textContent).toContain("Extra chupito");
    expect(optionRows[0]!.textContent).toContain("×2"); // taken twice → badge
    // …and it is priced twice: 0.50 × (1 dish × 2).
    expect(optionRows[0]!.textContent).toContain(formatMoney("1.00"));
    expect(optionRows[1]!.textContent).toContain("Sin cebolla");
    expect(optionRows[1]!.textContent).not.toContain("×"); // single pick → no badge
  });

  it("removing the parent dish removes its picks with it", async () => {
    const cheese = offeredItem("p-cheese", "Extra queso", "0.50");
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      name: "Hamburguesa",
      customerName: { es: "Hamburguesa para el cliente" },
      unitPrice: "10.00",
      offeredModifiers: [offeredExtras("list-extras", "Extras", [cheese])],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", { extras: [pick("list-extras", cheese)] });
    store.addProduct(cafe, "1"); // a second, plain line
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.querySelectorAll(".option")).toHaveLength(1);

    // Remove the dish that carries the pick (the first remove control).
    el.shadowRoot!.querySelectorAll<HTMLElement>(".remove")[0]!.click();
    await el.updateComplete;

    // The whole line — dish and its pick — is gone; only the plain café line remains.
    expect(store.lines).toHaveLength(1);
    expect(store.lines[0]!.product).toBe(cafe);
    expect(el.shadowRoot!.querySelectorAll(".option")).toHaveLength(0);
  });

  // ── As-served allergens (modifier↔allergen) ──────────────────────────────────────────────────
  // The basket shows each line's OWN allergen profile CLIENT-side — the dish's declared allergens, with
  // no modifier contribution. Each extra's own allergens are shown separately (Task 4).

  it("shows the dish's OWN allergens, ignoring a gluten-free bun picked as an extra", async () => {
    const bun = offeredItem("p-gf-bun", "Pan sin gluten", "0.00");
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      name: "Hamburguesa",
      customerName: { es: "Hamburguesa para el cliente" },
      unitPrice: "10.00",
      allergens: { gluten: { presence: "contains" } }, // base REVIEWED, declares gluten
      offeredModifiers: [offeredExtras("list-bun", "Pan", [bun])],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", { extras: [pick("list-bun", bun)] });
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const asServed = el.shadowRoot!.querySelector(`[data-test="line-allergens-0"]`);
    expect(asServed).not.toBeNull();
    // The pick no longer strips the dish's gluten — the dish shows its OWN gluten (the label "Cereales
    // con gluten"/"Cereals containing gluten" both contain the word, so its presence proves it stayed).
    expect(asServed!.textContent).toMatch(/gluten/i);
    // The base was reviewed, so nothing is pending: no "not fully reviewed" note.
    expect(asServed!.textContent).not.toMatch(/review|pendiente/i);
  });

  it("shows each pick's own allergens and diet, distinct from the dish's own", async () => {
    const bacon = offeredItem("p-bacon", "Bacon", "1.00", {
      addAllergens: { milk: { presence: "contains" } }, // the PICK's own allergen
      suitableFor: ["halal"], // the PICK's own positive diet claim
    });
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      name: "Hamburguesa",
      unitPrice: "10.00",
      allergens: { gluten: { presence: "contains" } }, // the DISH's own allergen (not milk)
      offeredModifiers: [offeredExtras("list-extras", "Extras", [bacon])],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", { extras: [pick("list-extras", bacon)] });
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const milkName = allergenName("milk", currentLocale());

    // The pick's OWN allergen node carries its milk, NOT the dish's gluten — a node distinct from the
    // dish's own allergen row.
    const optionAllergens = el.shadowRoot!.querySelector(`[data-test="option-allergens-0-0"]`);
    expect(optionAllergens).not.toBeNull();
    expect(optionAllergens!.textContent).toContain(milkName);
    expect(optionAllergens!.textContent).not.toMatch(/gluten/i);

    // The dish's OWN allergen row still shows gluten and NOT the pick's milk (no fold, distinct nodes).
    const dishAllergens = el.shadowRoot!.querySelector(`[data-test="line-allergens-0"]`);
    expect(dishAllergens!.textContent).toMatch(/gluten/i);
    expect(dishAllergens!.textContent).not.toContain(milkName);

    // The pick's OWN diet badge shows its positive suitability (halal).
    const optionDiet = el.shadowRoot!.querySelector(`[data-test="option-diet-0-0"]`);
    expect(optionDiet).not.toBeNull();
    expect(optionDiet!.querySelector("[data-diet='halal']")).not.toBeNull();
    expect(optionDiet!.textContent).toContain(t("diet.halal"));
  });

  it("renders no per-pick nutrition chrome for a pick that declares neither", async () => {
    const bun = offeredItem("p-plain-bun", "Pan normal", "0.00");
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      name: "Hamburguesa",
      unitPrice: "10.00",
      allergens: { gluten: { presence: "contains" } },
      offeredModifiers: [offeredExtras("list-bun", "Pan", [bun])],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", { extras: [pick("list-bun", bun)] });
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.querySelector(`[data-test="option-allergens-0-0"]`)).toBeNull();
    expect(el.shadowRoot!.querySelector(`[data-test="option-diet-0-0"]`)).toBeNull();
  });

  it("resolves a pick's own nutrition by the PICKED PRODUCT, across the dish's offered lists", async () => {
    // Two lists offer two products; the basket must read the declarations of the one actually picked,
    // and find it in the second list rather than stopping at the first.
    const cheese = offeredItem("p-cheese", "Queso", "1.00", {
      addAllergens: { gluten: { presence: "contains" } },
      suitableFor: ["vegetarian"],
    });
    const bacon = offeredItem("p-bacon", "Bacon", "1.00", {
      addAllergens: { milk: { presence: "contains" } },
      suitableFor: ["kosher"],
    });
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      name: "Hamburguesa",
      unitPrice: "10.00",
      allergens: null,
      offeredModifiers: [
        offeredExtras("list-cheese", "Quesos", [cheese]),
        offeredExtras("list-meat", "Carnes", [bacon]),
      ],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", { extras: [pick("list-meat", bacon)] });
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const allergens = el.shadowRoot!.querySelector(`[data-test="option-allergens-0-0"]`)!;
    expect(allergens.textContent).toContain(allergenName("milk", currentLocale()));
    expect(allergens.textContent).not.toMatch(/gluten/i);
    expect(
      el.shadowRoot!.querySelector(`[data-test="option-diet-0-0"] [data-diet='kosher']`),
    ).not.toBeNull();
  });

  it("marks the row 'not fully reviewed' for an unreviewed dish, ignoring an add-milk pick (Cautious)", async () => {
    const cheese = offeredItem("p-cheese", "Extra queso", "0.50", {
      addAllergens: { milk: { presence: "contains" } },
    });
    const burger: TillProduct = {
      ...cafe,
      id: "burger",
      name: "Hamburguesa",
      customerName: { es: "Hamburguesa para el cliente" },
      unitPrice: "10.00",
      allergens: null, // base UNREVIEWED → the plate stays pending
      offeredModifiers: [offeredExtras("list-extras", "Extras", [cheese])],
    };
    const store = new WorkingOrderStore();
    store.addProduct(burger, "1", { extras: [pick("list-extras", cheese)] });
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const asServed = el.shadowRoot!.querySelector(`[data-test="line-allergens-0"]`);
    expect(asServed).not.toBeNull();
    // Unreviewed base → the waiter sees the "not reviewed" note. The pick's milk is NOT folded in — it
    // is shown separately — so the dish's own row names no milk.
    expect(asServed!.textContent).not.toMatch(/milk|leche/i);
    expect(asServed!.textContent).toMatch(/review|pendiente/i);
  });

  it("shows the as-served set for a plain dish that carries allergens even with no modifiers", async () => {
    const tostada: TillProduct = {
      ...cafe,
      id: "tostada",
      name: "Tostada",
      customerName: { es: "Tostada para el cliente" },
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

  // A pick the dish no longer offers must NOT change the dish's own allergen row, and must not crash
  // the row either: the dish shows its OWN reviewed gluten and the pick simply gets no chrome.
  it("shows the dish's own allergens beside a pick it no longer offers, no fold", async () => {
    const cheese = offeredItem("p-real-cheese", "Extra queso", "0.50", {
      addAllergens: { milk: { presence: "contains" } },
    });
    const tostada: TillProduct = {
      ...cafe,
      id: "tostada-stale",
      name: "Tostada",
      customerName: { es: "Tostada para el cliente" },
      allergens: { gluten: { presence: "contains" } }, // base REVIEWED → the row renders
      offeredModifiers: [offeredExtras("list-extras", "Extras", [cheese])],
    };
    const store = new WorkingOrderStore();
    // The pick names a product NO offered list carries any more (withdrawn since it was chosen).
    const stale: SelectedExtra = {
      listId: "list-extras",
      productId: "p-ghost",
      name: "Fantasma",
      price: "0.00",
      quantity: 1,
    };
    store.addProduct(tostada, "1", { extras: [stale] });
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const asServed = el.shadowRoot!.querySelector(`[data-test="line-allergens-0"]`);
    expect(asServed).not.toBeNull();
    // The dish's own gluten shows; the offered cheese's milk is NOT folded in (it was not picked).
    expect(asServed!.textContent).toMatch(/gluten/i);
    expect(asServed!.textContent).not.toMatch(/milk|leche/i);
    expect(asServed!.textContent).not.toMatch(/review|pendiente/i);
    // An unresolvable pick gets no nutrition chrome rather than an empty declaration.
    expect(el.shadowRoot!.querySelector(`[data-test="option-allergens-0-0"]`)).toBeNull();
  });

  it("marks a retrieved pick and a retrieved dish that are not offered now, pricing the pick per dish", async () => {
    const store = new WorkingOrderStore();
    store.loadFrom("held", [
      {
        workingOrderLineId: "stored-cafe",
        product: cafe,
        quantity: "2",
        notOfferedExtras: [
          { productId: "p-oat", name: "Leche de avena", price: "0.40", quantity: 2 },
        ],
      },
      {
        workingOrderLineId: "stored-gone",
        product: { ...cafe, id: "gone", name: "Cortado" },
        quantity: "1",
        notOffered: true,
      },
    ]);
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const tag = t("basket.not_offered");
    const pickRow = el.shadowRoot!.querySelector(".option")!;
    expect(pickRow.textContent).toContain("Leche de avena");
    // 0.40 × 2 cafés × 2 per café.
    expect(pickRow.textContent).toContain(formatMoney("1.60"));
    expect(pickRow.textContent).toContain(tag);
    const names = [...el.shadowRoot!.querySelectorAll(".line > .name")];
    expect(names[0]!.textContent).not.toContain(tag);
    expect(names[1]!.textContent).toContain("Cortado");
    expect(names[1]!.textContent).toContain(tag);
  });

  // ── As-served diet & contains badges (dietary-classification) ────────────────────────────────
  // The basket shows each line's OWN DIET profile CLIENT-side (`asServedDiet`, the diet twin of
  // `asServedAllergens`) — the dish's recipe-derived diet, no modifier contribution — and renders
  // vegan/vegetarian/halal/kosher badges + contains chips beside the allergen chips, with a NEUTRAL
  // "not reviewed" note (never a positive claim) when pending.

  it("shows a vegan badge for a plant-only reviewed dish", async () => {
    const salad: TillProduct = {
      ...cafe,
      id: "salad",
      name: "Ensalada",
      customerName: { es: "Ensalada para el cliente" },
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
      name: "Chuleta",
      customerName: { es: "Chuleta para el cliente" },
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
      name: "Plato del día",
      customerName: { es: "Plato del día para el cliente" },
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

  it("shows the dish's OWN diet, ignoring a meat-adding pick", async () => {
    const bacon = offeredItem("p-bacon", "Beicon", "1.00");
    const salad: TillProduct = {
      ...cafe,
      id: "salad-bacon",
      name: "Ensalada",
      customerName: { es: "Ensalada para el cliente" },
      dietDerivation: { origins: ["plant"], pending: false },
      offeredModifiers: [offeredExtras("list-extras", "Extras", [bacon])],
    };
    const store = new WorkingOrderStore();
    store.addProduct(salad, "1", { extras: [pick("list-extras", bacon)] });
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const diet = el.shadowRoot!.querySelector(`[data-test="line-diet-0"]`);
    expect(diet).not.toBeNull();
    // The dish is plant-only: it keeps its vegan badge and shows no contains-meat chip — the pick's
    // meat is shown on the pick's own row, never folded into the dish's diet.
    expect(diet!.querySelector("[data-diet='vegan']")).not.toBeNull();
    expect(diet!.querySelector("[data-diet-contains='meat']")).toBeNull();
  });

  it("shows halal + kosher badges from a staff override", async () => {
    const kebab: TillProduct = {
      ...cafe,
      id: "kebab",
      name: "Kebab",
      customerName: { es: "Kebab para el cliente" },
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

  it("shows the 'not reviewed' note when an override resolves vegan but vegetarian is still unknown (Copilot)", async () => {
    // A pending (unreviewed) derivation with a staff override that resolves ONLY vegan
    // (`{ vegan: "no" }`) leaves vegetarian derived-unknown. Checking `diet.vegan === "unknown"`
    // alone would miss this — vegan already reads "no" — and with no positives/contains the row
    // would render nothing at all, silently dropping the "not reviewed" note vegetarian still needs.
    const mystery: TillProduct = {
      ...cafe,
      id: "mystery-partial-override",
      name: "Plato del día",
      customerName: { es: "Plato del día para el cliente" },
      dietDerivation: { origins: [], pending: true },
      dietOverride: { vegan: "no" },
    };
    const store = new WorkingOrderStore();
    store.addProduct(mystery, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    const diet = el.shadowRoot!.querySelector(`[data-test="line-diet-0"]`);
    expect(diet).not.toBeNull();
    expect(diet!.querySelector("[data-diet-pending]")).not.toBeNull();
    expect(diet!.textContent).toMatch(/review|revisi/i);
    // Still no positive claim — the resolved "no" and the still-unknown vegetarian both stay silent.
    expect(diet!.querySelector("[data-diet='vegan']")).toBeNull();
    expect(diet!.querySelector("[data-diet='vegetarian']")).toBeNull();
  });

  it("renders NO diet row for a reviewed dish that is neither vegan/vegetarian nor tagged (nothing to assert)", async () => {
    const gelatin: TillProduct = {
      ...cafe,
      id: "gelatin",
      name: "Gelatina",
      customerName: { es: "Gelatina para el cliente" },
      // Reviewed (not pending), an animal origin that is neither meat/fish nor vegetarian-ok → vegan
      // "no", vegetarian "no", contains [] — the helper has nothing positive to show, so no row.
      dietDerivation: { origins: ["other_animal"], pending: false },
    };
    const store = new WorkingOrderStore();
    store.addProduct(gelatin, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.querySelector(`[data-test="line-diet-0"]`)).toBeNull();
  });

  // ── Per-line note (order-line customisation, Task 4b) ─────────────────────────────────
  // EVERY basket line — including a plain no-modifier product fast-added with one tap — carries a
  // "Note" affordance that opens the shared note editor for THAT line. On change the store's
  // `setLineExtras` records it; the line's current note shows as an indented sub-row so staff see
  // it at a glance. Fast-add stays one tap — the editor is opened from the basket, never on the
  // ring-up path.

  /** The per-line note toggle button for the line at `index`. */
  function noteButton(el: TillBasket, index: number): HTMLElement | null {
    return el.shadowRoot!.querySelector<HTMLElement>(`[data-test="line-note-button-${index}"]`);
  }
  /** The open editor's note textarea for the line at `index`, or null when the editor is closed. */
  function noteBox(el: TillBasket): HTMLTextAreaElement | null {
    return el.shadowRoot!.querySelector<HTMLTextAreaElement>('[data-test="line-note"]');
  }
  const steak: TillProduct = {
    ...cafe,
    id: "steak",
    name: "Filete",
    customerName: { es: "Filete para el cliente" },
    unitPrice: "18.00",
    diet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
  };
  const seabass: TillProduct = {
    ...cafe,
    id: "seabass",
    name: "Lubina",
    customerName: { es: "Lubina para el cliente" },
    unitPrice: "16.00",
    diet: { vegan: "no", vegetarian: "no", contains: ["fish"] },
  };

  it("shows a Note affordance on EVERY line, including a plain no-modifier fast-added product", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1"); // fast-added, no options, no diet
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(noteButton(el, 0)).not.toBeNull();
  });

  it("opens the shared editor for that line and records a typed note via setLineExtras", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    // Closed until the Note button is tapped.
    expect(noteBox(el)).toBeNull();
    noteButton(el, 0)!.click();
    await el.updateComplete;
    const note = noteBox(el)!;
    expect(note).not.toBeNull();
    expect(note.maxLength).toBe(200);
    note.value = "extra hot";
    note.dispatchEvent(new Event("input"));
    await el.updateComplete;
    expect(store.lines[0]!.note).toBe("extra hot");
  });

  it("renders the line's set note as an indented sub-row (at a glance)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(steak, "1", { note: "no butter" });
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    const sub = el.shadowRoot!.querySelector(`[data-test="line-extras-0"]`);
    expect(sub).not.toBeNull();
    expect(sub!.textContent).toContain(t("line.note.label"));
    expect(sub!.textContent).toContain("no butter");
  });

  it("renders NO extras sub-row for a line with no note (avoids noise)", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    expect(el.shadowRoot!.querySelector(`[data-test="line-extras-0"]`)).toBeNull();
  });

  it("follows the open editor to its line when an EARLIER line is removed (note lands on the right dish)", async () => {
    // Basket [cafe, steak, seabass]. Open the MIDDLE line's (steak) editor, then remove the FIRST line
    // (cafe). Every later line slides down one slot, so the editor must follow steak to its new index —
    // otherwise a typed note (which can carry allergy info, per the placeholder) lands on seabass, the
    // line that slid into steak's old slot. This reproduces the positional-index reattach bug.
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1"); // A — index 0
    store.addProduct(steak, "1"); // B — index 1, the one we edit
    store.addProduct(seabass, "1"); // C — index 2
    const { el } = await mountWidget<TillBasket>("till-basket", { store });

    // Open B's (steak's) editor.
    noteButton(el, 1)!.click();
    await el.updateComplete;
    expect(noteBox(el)).not.toBeNull();

    // Remove A (cafe) via its remove control → lines become [steak, seabass].
    el.shadowRoot!.querySelectorAll<HTMLElement>(".remove")[0]!.click();
    await el.updateComplete;
    expect(store.lines.map((l) => l.product)).toEqual([steak, seabass]);

    // The editor is still open and now sits on steak (index 0). Type a note.
    const note = noteBox(el)!;
    expect(note).not.toBeNull();
    note.value = "allergy — nut";
    note.dispatchEvent(new Event("input"));
    await el.updateComplete;

    // The note lands on steak, NOT on seabass.
    expect(store.lines[0]!.note).toBe("allergy — nut"); // steak
    expect(store.lines[1]!.note).toBeUndefined(); // seabass untouched
  });

  it("closes the open editor when the edited line ITSELF is removed", async () => {
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1"); // index 0
    store.addProduct(steak, "1"); // index 1 — edited then removed
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    noteButton(el, 1)!.click();
    await el.updateComplete;
    expect(noteBox(el)).not.toBeNull();
    // Remove the edited line (steak, index 1).
    el.shadowRoot!.querySelectorAll<HTMLElement>(".remove")[1]!.click();
    await el.updateComplete;
    // The editor is gone — no dangling editor on the surviving line.
    expect(noteBox(el)).toBeNull();
  });

  it("closes the open editor when the whole basket is swapped (clear then re-fill)", async () => {
    // clear() mints a fresh working-order id and loadFrom() adopts a retrieved order's id, so either is a
    // whole-basket swap: the lines under an open editor are gone and its index is meaningless. The basket
    // watches store.id and closes the editor, so a re-filled basket never opens an editor uninvited.
    const store = new WorkingOrderStore();
    store.addProduct(cafe, "1");
    const { el } = await mountWidget<TillBasket>("till-basket", { store });
    noteButton(el, 0)!.click();
    await el.updateComplete;
    expect(noteBox(el)).not.toBeNull();
    // Empty the basket (fresh id) then ring up a new line at the same index 0.
    store.clear();
    store.addProduct(seabass, "1");
    await el.updateComplete;
    // No editor opens for the new line — the swap closed it.
    expect(noteBox(el)).toBeNull();
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

/** One options list on offer, three DIFFERENT texts per name and per label (CLAUDE.md §3). */
const cutList: OfferedModifier = {
  kind: "options",
  id: "list-cut",
  name: "Cortar",
  customerName: { es: "Cortar carta" },
  kitchenName: "Cortar KDS",
  defaultLabelId: "label-fino",
  labels: [
    {
      id: "label-fino",
      name: "Fino",
      customerName: { es: "Fino carta" },
      kitchenName: "Fino KDS",
      available: true,
    },
    {
      id: "label-grueso",
      name: "Grueso",
      customerName: { es: "Grueso carta" },
      kitchenName: "Grueso KDS",
      available: true,
    },
  ],
};

/** The line as the picker confirms it: the answer for the wire, and the six names for the basket. */
function answered(labelId: string, labelName: string) {
  return {
    options: [{ listId: "list-cut", labelId }],
    optionSnapshots: [
      {
        listName: { es: "Cortar" },
        listCustomerName: { es: "Cortar carta" },
        listKitchenName: "Cortar KDS",
        labelName: { es: labelName },
        labelCustomerName: { es: `${labelName} carta` },
        labelKitchenName: `${labelName} KDS`,
      },
    ],
  };
}

it("keeps each line's own answer through a quantity edit, and shows it in STAFF wording", async () => {
  const store = new WorkingOrderStore();
  store.addProduct(cafe, "1", answered("label-fino", "Fino"));
  store.addProduct(cafe, "1", answered("label-grueso", "Grueso"));
  const { el } = await mountWidget<TillBasket>("till-basket", { store });
  store.setLineQuantity(0, "2");
  await el.updateComplete;
  expect(store.lines.map((line) => line.options)).toEqual([
    [{ listId: "list-cut", labelId: "label-fino" }],
    [{ listId: "list-cut", labelId: "label-grueso" }],
  ]);
  // Each line keeps its own answer, read as the list's staff name and the chosen label's.
  expect(
    [...el.shadowRoot!.querySelectorAll(".modifier-answer")].map((answer) => answer.textContent),
  ).toEqual(["Cortar: Fino", "Cortar: Grueso"]);
});

it("offers no Edit on a line whose only question was its variant", async () => {
  // The basket's Edit reaches a line's ANSWERS only — `setLineModifiers` never replaces the line's
  // product — so a variant-only dish has nothing to edit here, unlike the two surfaces that ADD a
  // line, which hand the picker's variant-resolved product to `addProduct`.
  const store = new WorkingOrderStore();
  const product: TillProduct = {
    ...cafe,
    variants: [
      {
        ...sellingValuesOf(cafe),
        id: "v-large",
        name: "Grande",
        unitPrice: "2.00",
        unitPriceDifference: "0.50",
        available: true,
      },
    ],
    variantId: "v-large",
    variantName: "Grande",
  };
  store.addProduct(product, "1");
  const { el } = await mountWidget<TillBasket>("till-basket", { store });
  expect(el.shadowRoot!.querySelector(".edit-modifiers")).toBeNull();
});

it("reopens the picker on one line's answer and changes only that line", async () => {
  const store = new WorkingOrderStore();
  const product: TillProduct = { ...cafe, offeredModifiers: [cutList] };
  for (let index = 0; index < 2; index++)
    store.addProduct(product, "1", answered("label-fino", "Fino"));
  const { el } = await mountWidget<TillBasket>("till-basket", { store });
  el.shadowRoot!.querySelector<HTMLElement>(".edit-modifiers")!.click();
  await el.updateComplete;
  const picker =
    el.shadowRoot!.querySelector<import("./modifier-picker.js").TillModifierPicker>(
      "till-modifier-picker",
    )!;
  await picker.updateComplete;
  // The reopened answer is "Fino"; switch this line alone to "Grueso".
  const chosen = picker.shadowRoot!.querySelector<HTMLInputElement>("#label-list-cut-label-fino")!;
  expect(chosen.checked).toBe(true);
  picker.shadowRoot!.querySelector<HTMLInputElement>("#label-list-cut-label-grueso")!.click();
  await picker.updateComplete;
  picker.shadowRoot!.querySelector<HTMLElement>(".confirm")!.click();
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("till-modifier-picker")).toBeNull();
  expect(store.lines.map((line) => line.options)).toEqual([
    [{ listId: "list-cut", labelId: "label-grueso" }],
    [{ listId: "list-cut", labelId: "label-fino" }],
  ]);
  // The re-answer re-freezes the six names, so the basket reads the NEW label.
  expect(
    [...el.shadowRoot!.querySelectorAll(".modifier-answer")].map((answer) => answer.textContent),
  ).toEqual(["Cortar: Grueso", "Cortar: Fino"]);
});

it("hands the open picker ONE seed object, not a fresh one per basket render", async () => {
  // Lit's reactive-property `hasChanged` is an identity check, so a seed rebuilt inside `render()`
  // would re-render the open dialog on every basket render — note keystrokes included.
  const store = new WorkingOrderStore();
  const product: TillProduct = { ...cafe, offeredModifiers: [cutList] };
  store.addProduct(product, "1", answered("label-fino", "Fino"));
  const { el } = await mountWidget<TillBasket>("till-basket", { store });
  el.shadowRoot!.querySelector<HTMLElement>(".edit-modifiers")!.click();
  await el.updateComplete;
  const picker =
    el.shadowRoot!.querySelector<import("./modifier-picker.js").TillModifierPicker>(
      "till-modifier-picker",
    )!;
  const seed = picker.initialSelections;
  expect(seed).toBeDefined();
  el.requestUpdate();
  await el.updateComplete;
  expect(picker.initialSelections).toBe(seed);
});

it("shows a retrieved line's frozen options answers in the STAFF wording", async () => {
  // Three different texts per name, so the assertion fails if the basket reads the kitchen or the
  // customer side by mistake (CLAUDE.md §3).
  const store = new WorkingOrderStore();
  store.loadFrom("wo-1", [
    {
      product: cafe,
      quantity: "1",
      workingOrderLineId: "wol-1",
      optionSnapshots: [
        {
          listName: { es: "Punto personal" },
          listCustomerName: { "es-ES": "¿Cómo lo quiere?" },
          listKitchenName: "PTO",
          labelName: { es: "Poco personal" },
          labelCustomerName: { "es-ES": "Poco hecho" },
          labelKitchenName: "PH",
        },
      ],
    },
  ]);
  const { el } = await mountWidget<TillBasket>("till-basket", { store });
  expect(
    [...el.shadowRoot!.querySelectorAll(".modifier-answer")].map((answer) => answer.textContent),
  ).toEqual(["Punto personal: Poco personal"]);
});

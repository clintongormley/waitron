import { afterEach, describe, expect, it } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { formatMoney } from "../i18n/format.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillProductGrid } from "./product-grid.js";
import { TillModifierPicker } from "./modifier-picker.js";
import type { TillProduct } from "../api/client.js";

// A plain product with NO option groups — the common tap, which must ring up straight away.
const cafe: TillProduct = {
  id: "cafe",
  descriptions: { es: "Café" },
  pricingUnit: "each",
  unitPrice: "1.50",
  vatClass: "general",
  category: null,
  allergens: null,
};

// A weight product — the kg-keypad path, which the picker must never intercept.
const jamon: TillProduct = {
  id: "jamon",
  descriptions: { es: "Jamón" },
  pricingUnit: "weight",
  unitPrice: "10.00",
  vatClass: "reduced",
  category: null,
  allergens: null,
};

// A burger with two groups: a REQUIRED single-select "doneness" (radios) and an optional multi-select
// "extras" bounded at maxSelect 2 (checkboxes).
const burger: TillProduct = {
  id: "burger",
  descriptions: { en: "Burger", es: "Hamburguesa" },
  pricingUnit: "each",
  unitPrice: "8.00",
  vatClass: "general",
  category: null,
  allergens: null,
  optionGroups: [
    {
      id: "g-doneness",
      name: { en: "Doneness", es: "Punto" },
      minSelect: 1,
      maxSelect: 1,
      required: true,
      items: [
        {
          id: "i-rare",
          name: { en: "Rare", es: "Poco hecha" },
          priceDelta: "0.00",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
        {
          id: "i-medium",
          name: { en: "Medium", es: "Al punto" },
          priceDelta: "0.00",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
      ],
    },
    {
      id: "g-extras",
      name: { en: "Extras", es: "Extras" },
      minSelect: 0,
      maxSelect: 2,
      required: false,
      items: [
        {
          id: "i-cheese",
          name: { en: "Cheese", es: "Queso" },
          priceDelta: "1.00",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
        {
          id: "i-bacon",
          name: { en: "Bacon", es: "Bacon" },
          priceDelta: "1.50",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
        {
          id: "i-egg",
          name: { en: "Egg", es: "Huevo" },
          priceDelta: "0.75",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
      ],
    },
  ],
};

// A coffee with an OPTIONAL multi-select "extras" group (maxSelect 3) mixing per-option-quantity items:
// "extra shot" is takeable up to twice (maxQuantity 2 → stepper), "syrup" up to five times (maxQuantity 5,
// but the group cap of 3 bites first → stepper), and "oat milk" once (maxQuantity 1 → plain checkbox).
const coffee: TillProduct = {
  id: "coffee",
  descriptions: { en: "Coffee", es: "Café" },
  pricingUnit: "each",
  unitPrice: "2.00",
  vatClass: "general",
  category: null,
  allergens: null,
  optionGroups: [
    {
      id: "g-extras",
      name: { en: "Extras", es: "Extras" },
      minSelect: 0,
      maxSelect: 3,
      required: false,
      items: [
        {
          id: "i-shot",
          name: { en: "Extra shot", es: "Café extra" },
          priceDelta: "0.60",
          vatClass: null,
          maxQuantity: 2,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
        {
          id: "i-syrup",
          name: { en: "Syrup", es: "Sirope" },
          priceDelta: "0.40",
          vatClass: null,
          maxQuantity: 5,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
        {
          id: "i-oat",
          name: { en: "Oat milk", es: "Leche de avena" },
          priceDelta: "0.50",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
      ],
    },
  ],
};

// A drink whose ONLY group is SINGLE-select (maxSelect 1) yet carries an item authored with maxQuantity > 1.
// A single-select group caps the group sum at 1, so a quantity > 1 is impossible there — the picker must
// render RADIOS, never a stepper, regardless of the item's maxQuantity.
const sizedDrink: TillProduct = {
  id: "sized",
  descriptions: { en: "Sized drink", es: "Bebida" },
  pricingUnit: "each",
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: null,
  optionGroups: [
    {
      id: "g-size",
      name: { en: "Size", es: "Tamaño" },
      minSelect: 1,
      maxSelect: 1,
      required: true,
      items: [
        {
          id: "i-small",
          name: { en: "Small", es: "Pequeña" },
          priceDelta: "0.00",
          vatClass: null,
          maxQuantity: 3,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
        {
          id: "i-large",
          name: { en: "Large", es: "Grande" },
          priceDelta: "0.50",
          vatClass: null,
          maxQuantity: 3,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
      ],
    },
  ],
};

// A soup with a REQUIRED-but-EMPTY group (every item inactive → items: []) alongside a real optional
// group. The empty group must be skipped by the picker and must NOT block "Add" (the Task 3 carry).
const soup: TillProduct = {
  id: "soup",
  descriptions: { en: "Soup", es: "Sopa" },
  pricingUnit: "each",
  unitPrice: "5.00",
  vatClass: "reduced",
  category: null,
  allergens: null,
  optionGroups: [
    {
      id: "g-empty",
      name: { en: "Garnish", es: "Guarnición" },
      minSelect: 1,
      maxSelect: 1,
      required: true,
      items: [],
    },
    {
      id: "g-bread",
      name: { en: "Bread", es: "Pan" },
      minSelect: 0,
      maxSelect: 1,
      required: false,
      items: [
        {
          id: "i-white",
          name: { en: "White", es: "Blanco" },
          priceDelta: "0.00",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
      ],
    },
  ],
};

// A product whose ONLY groups are empty (misconfigured) — nothing to pick, so ordering must not be
// wedged behind a pointless dialog: it rings up straight away.
const brokenProduct: TillProduct = {
  id: "broken",
  descriptions: { en: "Broken", es: "Roto" },
  pricingUnit: "each",
  unitPrice: "3.00",
  vatClass: "general",
  category: null,
  allergens: null,
  optionGroups: [
    {
      id: "g-none",
      name: { en: "None", es: "Nada" },
      minSelect: 1,
      maxSelect: 1,
      required: true,
      items: [],
    },
  ],
};

// A MEAT dish (diet.contains includes "meat") carrying one optional group so the picker opens — the
// doneness picker must appear for it. Leaving the optional side blank keeps "Add" enabled.
const steak: TillProduct = {
  id: "steak",
  descriptions: { en: "Steak", es: "Filete" },
  pricingUnit: "each",
  unitPrice: "18.00",
  vatClass: "general",
  category: null,
  allergens: null,
  diet: { vegan: "no", vegetarian: "no", contains: ["meat"] },
  optionGroups: [
    {
      id: "g-side",
      name: { en: "Side", es: "Guarnición" },
      minSelect: 0,
      maxSelect: 1,
      required: false,
      items: [
        {
          id: "i-fries",
          name: { en: "Fries", es: "Patatas" },
          priceDelta: "0.00",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
      ],
    },
  ],
};

// A FISH dish (diet.contains ["fish"], not "meat") with an optional group — the doneness picker must
// be HIDDEN for it, exactly as it is for a product with no diet at all (burger).
const seabass: TillProduct = {
  id: "seabass",
  descriptions: { en: "Sea bass", es: "Lubina" },
  pricingUnit: "each",
  unitPrice: "16.00",
  vatClass: "general",
  category: null,
  allergens: null,
  diet: { vegan: "no", vegetarian: "no", contains: ["fish"] },
  optionGroups: [
    {
      id: "g-side",
      name: { en: "Side", es: "Guarnición" },
      minSelect: 0,
      maxSelect: 1,
      required: false,
      items: [
        {
          id: "i-fries",
          name: { en: "Fries", es: "Patatas" },
          priceDelta: "0.00",
          vatClass: null,
          maxQuantity: 1,
          addAllergens: null,
          removeAllergens: null,
          addOrigins: null,
          removeOrigins: null,
        },
      ],
    },
  ],
};

afterEach(cleanupWidgets);

/** The picker the grid opened, or null when none is mounted. */
function pickerOf(grid: TillProductGrid): TillModifierPicker | null {
  return grid.shadowRoot!.querySelector<TillModifierPicker>("till-modifier-picker");
}

/** Tap the tile whose accessible text contains `name`. */
function tapTile(grid: TillProductGrid, name: string): void {
  const tile = [...grid.shadowRoot!.querySelectorAll("wt-button")].find((b) =>
    b.textContent?.includes(name),
  );
  if (tile === undefined) throw new Error(`no tile for ${name}`);
  (tile as HTMLElement).click();
}

/** The Add (confirm) button inside the picker. */
function addButton(picker: TillModifierPicker): HTMLElement & { disabled: boolean } {
  return picker.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(".confirm")!;
}

/** The `+` step button for an item, or null when the item has no stepper (plain checkbox/radio). */
function incButton(
  picker: TillModifierPicker,
  itemId: string,
): (HTMLElement & { disabled: boolean }) | null {
  return picker.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    `[data-test="opt-${itemId}-inc"]`,
  );
}

/** The `−` step button for an item, or null when the item has no stepper. */
function decButton(
  picker: TillModifierPicker,
  itemId: string,
): (HTMLElement & { disabled: boolean }) | null {
  return picker.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    `[data-test="opt-${itemId}-dec"]`,
  );
}

/** The count readout inside an item's stepper. */
function stepCount(picker: TillModifierPicker, itemId: string): string | undefined {
  return picker
    .shadowRoot!.querySelector<HTMLElement>(`[data-test="opt-${itemId}-count"]`)
    ?.textContent?.trim();
}

/** Open the picker over a product via the grid, returning the mounted picker. */
async function openPicker(product: TillProduct, tile: string, store: WorkingOrderStore) {
  const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
    products: [product],
    store,
  });
  tapTile(el, tile);
  await el.updateComplete;
  const picker = pickerOf(el)!;
  await picker.updateComplete;
  return { el, picker };
}

describe("till-modifier-picker", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-modifier-picker")).toBe(TillModifierPicker);
  });

  // Pinned test 1 — regression guard: a product with no groups rings instantly, no picker.
  it("rings up a product with no option groups straight away, opening no picker", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [cafe],
      store,
    });
    tapTile(el, "Café");
    await el.updateComplete;
    expect(store.lines).toEqual([{ product: cafe, quantity: "1" }]);
    expect(pickerOf(el)).toBeNull();
  });

  it("never intercepts a weight product (the kg-keypad path is unchanged)", async () => {
    const store = new WorkingOrderStore();
    const seen: TillProduct[] = [];
    store.on("product-selected", (p) => seen.push(p as TillProduct));
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [jamon],
      store,
    });
    tapTile(el, "Jamón");
    await el.updateComplete;
    expect(seen).toEqual([jamon]);
    expect(store.lines).toHaveLength(0);
    expect(pickerOf(el)).toBeNull();
  });

  it("rings up a product whose only groups are empty straight away (no wedged dialog)", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [brokenProduct],
      store,
    });
    tapTile(el, "Broken");
    await el.updateComplete;
    expect(store.lines).toEqual([{ product: brokenProduct, quantity: "1" }]);
    expect(pickerOf(el)).toBeNull();
  });

  // Pinned test 2 — a product WITH groups opens the picker; required blocks Add; maxSelect disables
  // remaining; the running price sums dish + deltas.
  it("opens the picker; a required group blocks Add; maxSelect disables the rest; price sums deltas", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [burger],
      store,
    });
    tapTile(el, "Burger");
    await el.updateComplete;
    const picker = pickerOf(el)!;
    expect(picker).not.toBeNull();
    await picker.updateComplete;

    // Single-select group renders radios, multi renders checkboxes.
    const radios = picker.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    const checkboxes =
      picker.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(radios).toHaveLength(2); // rare, medium
    expect(checkboxes).toHaveLength(3); // cheese, bacon, egg

    // Required doneness not yet chosen → Add is disabled, and the running price is the bare dish.
    expect(addButton(picker).disabled).toBe(true);
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("8.00"));

    // Choose a doneness → required satisfied → Add enabled.
    picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-rare")!.click();
    await picker.updateComplete;
    expect(addButton(picker).disabled).toBe(false);

    // Pick both extras (maxSelect 2) → the third extra's checkbox disables.
    picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-cheese")!.click();
    picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-bacon")!.click();
    await picker.updateComplete;
    expect(picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-egg")!.disabled).toBe(true);
    // Already-selected extras stay enabled so the diner can undo them.
    expect(picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-cheese")!.disabled).toBe(
      false,
    );

    // Running price = dish 8.00 + cheese 1.00 + bacon 1.50 = 10.50.
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("10.50"));
  });

  // Pinned test 3 — on confirm the picker's parent grid rings the product with the chosen options.
  it("rings the product with the selected options on Add, then closes", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [burger],
      store,
    });
    tapTile(el, "Burger");
    await el.updateComplete;
    const picker = pickerOf(el)!;
    await picker.updateComplete;

    picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-medium")!.click();
    picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-cheese")!.click();
    await picker.updateComplete;
    addButton(picker).click();
    await el.updateComplete;

    expect(store.lines).toHaveLength(1);
    const line = store.lines[0]!;
    expect(line.product).toBe(burger);
    expect(line.quantity).toBe("1");
    expect(line.options).toEqual([
      { optionGroupItemId: "i-medium", name: { en: "Medium", es: "Al punto" }, priceDelta: "0.00" },
      { optionGroupItemId: "i-cheese", name: { en: "Cheese", es: "Queso" }, priceDelta: "1.00" },
    ]);
    // The picker tears down after confirming.
    expect(pickerOf(el)).toBeNull();
  });

  // Pinned test 4 — the empty-group carry: a group with items: [] is not rendered and does not block Add.
  it("skips an empty group and never lets it block Add", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [soup],
      store,
    });
    tapTile(el, "Soup");
    await el.updateComplete;
    const picker = pickerOf(el)!;
    expect(picker).not.toBeNull();
    await picker.updateComplete;

    // The empty (required) group is not rendered at all…
    expect(picker.shadowRoot!.textContent).not.toContain("Garnish");
    // …the real optional group is…
    expect(picker.shadowRoot!.textContent).toContain("Bread");
    // …and Add is enabled despite the empty group being `required` (it imposes no constraint).
    expect(addButton(picker).disabled).toBe(false);

    addButton(picker).click();
    await el.updateComplete;
    // No option chosen (the optional group was left blank) → the line carries no options key.
    expect(store.lines).toEqual([{ product: soup, quantity: "1" }]);
  });

  it("unticking a chosen extra removes it from the running price and the emitted options", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [burger],
      store,
    });
    tapTile(el, "Burger");
    await el.updateComplete;
    const picker = pickerOf(el)!;
    await picker.updateComplete;

    picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-rare")!.click();
    // Tick cheese, then untick it — the running price returns to the bare dish.
    picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-cheese")!.click();
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("9.00"));
    picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-cheese")!.click();
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("8.00"));

    addButton(picker).click();
    await el.updateComplete;
    // Only the doneness radio survives — the unticked extra is gone.
    expect(store.lines[0]!.options).toEqual([
      { optionGroupItemId: "i-rare", name: { en: "Rare", es: "Poco hecha" }, priceDelta: "0.00" },
    ]);
  });

  it("refuses to confirm while a required group is unsatisfied (the guard)", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [burger],
      store,
    });
    tapTile(el, "Burger");
    await el.updateComplete;
    const picker = pickerOf(el)!;
    await picker.updateComplete;

    // Force-click Add past its disabled state (required doneness not chosen): nothing rings, and the
    // picker stays open. Proven by removing the `#allSatisfied` guard in `#confirm` — this then rings.
    addButton(picker).click();
    await el.updateComplete;
    expect(store.lines).toHaveLength(0);
    expect(pickerOf(el)).not.toBeNull();
  });

  it("closes without ringing when cancelled", async () => {
    const store = new WorkingOrderStore();
    const { el } = await mountWidget<TillProductGrid>("till-product-grid", {
      products: [burger],
      store,
    });
    tapTile(el, "Burger");
    await el.updateComplete;
    const picker = pickerOf(el)!;
    await picker.updateComplete;

    picker.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
    await el.updateComplete;
    expect(pickerOf(el)).toBeNull();
    expect(store.lines).toHaveLength(0);
  });

  describe("per-option quantity (steppers)", () => {
    it("renders a stepper for a multi-select item with maxQuantity > 1, a plain checkbox otherwise", async () => {
      const store = new WorkingOrderStore();
      const { picker } = await openPicker(coffee, "Coffee", store);

      // The maxQuantity>1 items in a multi-select group get a stepper…
      expect(incButton(picker, "i-shot")).not.toBeNull();
      expect(decButton(picker, "i-shot")).not.toBeNull();
      expect(incButton(picker, "i-syrup")).not.toBeNull();
      // …while the maxQuantity===1 item stays a plain checkbox (no stepper).
      expect(incButton(picker, "i-oat")).toBeNull();
      expect(picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-oat")!.type).toBe(
        "checkbox",
      );
      // Nothing selected yet → the count reads 0 and `−` is disabled.
      expect(stepCount(picker, "i-shot")).toBe("0");
      expect(decButton(picker, "i-shot")!.disabled).toBe(true);
    });

    it("stepping to 2 emits the option with quantity: 2 and reflects the ×2 in the running price", async () => {
      const store = new WorkingOrderStore();
      const { el, picker } = await openPicker(coffee, "Coffee", store);

      incButton(picker, "i-shot")!.click();
      await picker.updateComplete;
      expect(stepCount(picker, "i-shot")).toBe("1");
      incButton(picker, "i-shot")!.click();
      await picker.updateComplete;
      expect(stepCount(picker, "i-shot")).toBe("2");
      // At the item's own maxQuantity (2), `+` disables.
      expect(incButton(picker, "i-shot")!.disabled).toBe(true);

      // Running price = dish 2.00 + shot 0.60 × 2 = 3.20.
      expect(picker.shadowRoot!.textContent).toContain(formatMoney("3.20"));

      addButton(picker).click();
      await el.updateComplete;
      expect(store.lines[0]!.options).toEqual([
        {
          optionGroupItemId: "i-shot",
          name: { en: "Extra shot", es: "Café extra" },
          priceDelta: "0.60",
          quantity: 2,
        },
      ]);
    });

    it("a maxQuantity===1 checkbox confirms with NO quantity field (byte-identical wire)", async () => {
      const store = new WorkingOrderStore();
      const { el, picker } = await openPicker(coffee, "Coffee", store);

      picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-oat")!.click();
      await picker.updateComplete;
      addButton(picker).click();
      await el.updateComplete;
      // toEqual pins the ABSENCE of a `quantity` key on a plain single-choice option.
      expect(store.lines[0]!.options).toEqual([
        {
          optionGroupItemId: "i-oat",
          name: { en: "Oat milk", es: "Leche de avena" },
          priceDelta: "0.50",
        },
      ]);
    });

    it("stepping back to 0 deselects the option entirely", async () => {
      const store = new WorkingOrderStore();
      const { el, picker } = await openPicker(coffee, "Coffee", store);

      incButton(picker, "i-shot")!.click();
      await picker.updateComplete;
      decButton(picker, "i-shot")!.click();
      await picker.updateComplete;
      expect(stepCount(picker, "i-shot")).toBe("0");
      expect(decButton(picker, "i-shot")!.disabled).toBe(true);

      addButton(picker).click();
      await el.updateComplete;
      // Nothing selected → no options key at all (the empty-selection collapse).
      expect(store.lines).toEqual([{ product: coffee, quantity: "1" }]);
    });

    it("caps the group at maxSelect on the SUMMED quantity — stepping past the allowance is prevented", async () => {
      const store = new WorkingOrderStore();
      const { picker } = await openPicker(coffee, "Coffee", store);

      // Step syrup (item maxQuantity 5) up to the GROUP cap of 3.
      incButton(picker, "i-syrup")!.click();
      incButton(picker, "i-syrup")!.click();
      incButton(picker, "i-syrup")!.click();
      await picker.updateComplete;
      expect(stepCount(picker, "i-syrup")).toBe("3");
      // The group sum is now at maxSelect 3, so syrup's `+` disables despite its item cap of 5…
      expect(incButton(picker, "i-syrup")!.disabled).toBe(true);
      // …the OTHER stepper's `+` disables too (no allowance left)…
      expect(incButton(picker, "i-shot")!.disabled).toBe(true);
      // …and the plain checkbox in the same group disables while unchecked.
      expect(picker.shadowRoot!.querySelector<HTMLInputElement>("#opt-i-oat")!.disabled).toBe(true);
    });

    it("never renders a stepper in a single-select group, even when the item's maxQuantity > 1", async () => {
      const store = new WorkingOrderStore();
      const { picker } = await openPicker(sizedDrink, "Sized drink", store);

      expect(incButton(picker, "i-small")).toBeNull();
      expect(incButton(picker, "i-large")).toBeNull();
      const radios = picker.shadowRoot!.querySelectorAll<HTMLInputElement>('input[type="radio"]');
      expect(radios).toHaveLength(2);
    });
  });

  describe("per-line note + meat-gated doneness", () => {
    /** The note textarea inside the picker, or null when absent. */
    function noteBox(picker: TillModifierPicker): HTMLTextAreaElement | null {
      return picker.shadowRoot!.querySelector<HTMLTextAreaElement>('[data-test="line-note"]');
    }
    /** The doneness select inside the picker, or null when it is not shown (non-meat). */
    function donenessBox(picker: TillModifierPicker): HTMLSelectElement | null {
      return picker.shadowRoot!.querySelector<HTMLSelectElement>('[data-test="line-doneness"]');
    }

    it("shows a note textarea for EVERY product the picker opens over", async () => {
      // A non-meat product with modifiers still gets the note box.
      const burgerPicker = await openPicker(burger, "Burger", new WorkingOrderStore());
      expect(noteBox(burgerPicker.picker)).not.toBeNull();
      expect(noteBox(burgerPicker.picker)!.maxLength).toBe(200);
      // As does a meat product.
      const steakPicker = await openPicker(steak, "Steak", new WorkingOrderStore());
      expect(noteBox(steakPicker.picker)).not.toBeNull();
    });

    it("shows the doneness select ONLY for a product whose diet.contains includes meat", async () => {
      const steakPicker = await openPicker(steak, "Steak", new WorkingOrderStore());
      expect(donenessBox(steakPicker.picker)).not.toBeNull();
      // Five doneness options plus a blank "no preference" default.
      expect(donenessBox(steakPicker.picker)!.querySelectorAll("option")).toHaveLength(6);
    });

    it("HIDES the doneness select for a fish product and for a product with no diet", async () => {
      const fishPicker = await openPicker(seabass, "Sea bass", new WorkingOrderStore());
      expect(donenessBox(fishPicker.picker)).toBeNull();
      const burgerPicker = await openPicker(burger, "Burger", new WorkingOrderStore());
      expect(donenessBox(burgerPicker.picker)).toBeNull();
    });

    it("carries the typed note and chosen doneness on Add (through to the rung line)", async () => {
      const store = new WorkingOrderStore();
      const { el, picker } = await openPicker(steak, "Steak", store);

      const note = noteBox(picker)!;
      note.value = "well seasoned, no butter";
      note.dispatchEvent(new Event("input"));
      const done = donenessBox(picker)!;
      done.value = "medium_rare";
      done.dispatchEvent(new Event("change"));
      await picker.updateComplete;

      addButton(picker).click();
      await el.updateComplete;
      expect(store.lines[0]!.note).toBe("well seasoned, no butter");
      expect(store.lines[0]!.doneness).toBe("medium_rare");
    });

    it("omits note and doneness when left blank on a meat product (byte-identical line)", async () => {
      const store = new WorkingOrderStore();
      const { el, picker } = await openPicker(steak, "Steak", store);
      addButton(picker).click();
      await el.updateComplete;
      // No note typed, no doneness chosen, no side ticked → a plain line with no extra keys.
      expect(store.lines).toEqual([{ product: steak, quantity: "1" }]);
    });

    it("folds a whitespace-only note to nothing (not chosen)", async () => {
      const store = new WorkingOrderStore();
      const { el, picker } = await openPicker(steak, "Steak", store);
      const note = noteBox(picker)!;
      note.value = "   ";
      note.dispatchEvent(new Event("input"));
      await picker.updateComplete;
      addButton(picker).click();
      await el.updateComplete;
      expect(store.lines).toEqual([{ product: steak, quantity: "1" }]);
    });
  });
});

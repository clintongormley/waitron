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
        },
        {
          id: "i-medium",
          name: { en: "Medium", es: "Al punto" },
          priceDelta: "0.00",
          vatClass: null,
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
        { id: "i-cheese", name: { en: "Cheese", es: "Queso" }, priceDelta: "1.00", vatClass: null },
        { id: "i-bacon", name: { en: "Bacon", es: "Bacon" }, priceDelta: "1.50", vatClass: null },
        { id: "i-egg", name: { en: "Egg", es: "Huevo" }, priceDelta: "0.75", vatClass: null },
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
        { id: "i-white", name: { en: "White", es: "Blanco" }, priceDelta: "0.00", vatClass: null },
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
});

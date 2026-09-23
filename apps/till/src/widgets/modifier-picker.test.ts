import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkingOrderStore } from "../state/working-order.js";
import { formatMoney } from "../i18n/format.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillProductGrid } from "./product-grid.js";
import { TillModifierPicker } from "./modifier-picker.js";
import type { OfferedModifier, TillProduct } from "../api/client.js";

/**
 * Every fixture below gives a list, a label and a picked product THREE DIFFERENT texts for their
 * three names (staff / customer / kitchen), so a surface reading the wrong one fails rather than
 * passing on a shared string (CLAUDE.md §3). The picker is a staff surface: it reads the plain
 * staff name everywhere (spec §10).
 */
function offeredItem(
  productId: string,
  staff: string,
  price: string,
  maxQuantity = 1,
  preselected = false,
) {
  return {
    productId,
    name: staff,
    customerName: { es: `${staff} carta`, en: `${staff} menu` },
    kitchenName: `${staff} KDS`,
    price,
    vatClass: "general" as const,
    maxQuantity,
    preselected,
    addAllergens: null,
    suitableFor: [],
  };
}

/** "Punto": one options list, two labels, "Al punto" preselected by the offer. */
const cookedList: OfferedModifier = {
  kind: "options",
  id: "list-cooked",
  name: "Punto",
  customerName: { es: "Punto carta" },
  kitchenName: "Punto KDS",
  defaultLabelId: "label-medium",
  labels: [
    {
      id: "label-rare",
      name: "Poco hecha",
      customerName: { es: "Poco hecha carta" },
      kitchenName: "Poco hecha KDS",
      available: true,
    },
    {
      id: "label-medium",
      name: "Al punto",
      customerName: { es: "Al punto carta" },
      kitchenName: "Al punto KDS",
      available: true,
    },
  ],
};

/** "Extras": optional, at most two picks in total; cheese may be taken three times. */
const extrasList: OfferedModifier = {
  kind: "extras",
  id: "list-extras",
  name: "Extras",
  customerName: { es: "Extras carta" },
  kitchenName: "Extras KDS",
  minPicks: 0,
  maxPicks: 2,
  items: [offeredItem("p-bacon", "Bacon", "1.50"), offeredItem("p-cheese", "Queso", "1.00", 3)],
};

/** "Pan": exactly one pick required — the "choose your bread" case (spec §3). */
const breadList: OfferedModifier = {
  kind: "extras",
  id: "list-bread",
  name: "Pan",
  customerName: { es: "Pan carta" },
  kitchenName: "Pan KDS",
  minPicks: 1,
  maxPicks: 1,
  items: [offeredItem("p-white", "Blanco", "0.00"), offeredItem("p-rye", "Centeno", "0.50")],
};

const base = {
  pricingUnit: "each" as const,
  vatClass: "general" as const,
  category: null,
  allergens: null,
};

// A plain product with nothing offered — the common tap, which must ring up straight away.
const cafe: TillProduct = {
  ...base,
  id: "cafe",
  name: "Café",
  customerName: { es: "Café carta" },
  unitPrice: "1.50",
};

// A weight product — the kg-keypad path, which the picker must never intercept.
const jamon: TillProduct = {
  ...base,
  id: "jamon",
  name: "Jamón",
  customerName: { es: "Jamón carta" },
  pricingUnit: "weight",
  vatClass: "reduced",
  unitPrice: "10.00",
};

// A burger offering its lists in this order: extras, then the options list. The picker must draw
// them in exactly that order — it is the product's own attachment order and nothing re-sorts it.
const burger: TillProduct = {
  ...base,
  id: "burger",
  name: "Burger",
  customerName: { es: "Burger carta" },
  unitPrice: "8.00",
  offeredModifiers: [extrasList, cookedList],
};

// A dish whose one list REQUIRES a pick.
const sandwich: TillProduct = {
  ...base,
  id: "sandwich",
  name: "Bocadillo",
  customerName: { es: "Bocadillo carta" },
  unitPrice: "5.00",
  offeredModifiers: [breadList],
};

/** The size the runner started at — a test that resizes the iframe hands it back here. */
const viewport = { width: window.innerWidth, height: window.innerHeight };

afterEach(async () => {
  await page.viewport(viewport.width, viewport.height);
  cleanupWidgets();
  if (vi.isMockFunction(history.pushState)) vi.mocked(history.pushState).mockRestore();
  if (vi.isMockFunction(history.replaceState)) vi.mocked(history.replaceState).mockRestore();
});

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

/** An extras item's checkbox, or null when the item is drawn as a stepper instead. */
function pickBox(
  picker: TillModifierPicker,
  listId: string,
  productId: string,
): HTMLInputElement | null {
  return picker.shadowRoot!.querySelector<HTMLInputElement>(`#pick-${listId}-${productId}`);
}

/** A label's radio inside an options list. */
function labelRadio(picker: TillModifierPicker, listId: string, labelId: string): HTMLInputElement {
  return picker.shadowRoot!.querySelector<HTMLInputElement>(`#label-${listId}-${labelId}`)!;
}

function incButton(
  picker: TillModifierPicker,
  listId: string,
  productId: string,
): (HTMLElement & { disabled: boolean }) | null {
  return picker.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    `[data-test="pick-${listId}-${productId}-inc"]`,
  );
}

function decButton(
  picker: TillModifierPicker,
  listId: string,
  productId: string,
): (HTMLElement & { disabled: boolean }) | null {
  return picker.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
    `[data-test="pick-${listId}-${productId}-dec"]`,
  );
}

function stepCount(picker: TillModifierPicker, listId: string, productId: string): string {
  return picker
    .shadowRoot!.querySelector<HTMLElement>(`[data-test="pick-${listId}-${productId}-count"]`)!
    .textContent!.trim();
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

  it("rings up a product that offers nothing straight away, opening no picker", async () => {
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
      products: [{ ...jamon, offeredModifiers: [extrasList] }],
      store,
    });
    tapTile(el, "Jamón");
    await el.updateComplete;
    expect(seen).toHaveLength(1);
    expect(store.lines).toHaveLength(0);
    expect(pickerOf(el)).toBeNull();
  });

  it("names each extras checkbox group by KIND and list, as the options radios already were", async () => {
    // Each group's `name` carries its kind in front of its list id — `extras-${list.id}` and
    // `options-${list.id}` (modifier-picker.ts) — where the extras checkbox used to carry the bare
    // list id and its options sibling was already prefixed. That is the whole of what changed here.
    // It does NOT make these names semantic: a list id is a generated uuid, and a kind in front of
    // one is still a generated widget id, which is what docs/developers/conventions-ui.md refuses.
    // Recorded as still open in `docs/backlog.md`, Task 12. Burger draws one extras checkbox (its
    // second item is a stepper, which has no input) and one radio per options label.
    const { picker } = await openPicker(burger, "Burger", new WorkingOrderStore());
    const names = [...picker.shadowRoot!.querySelectorAll("input")].map((input) => input.name);
    expect(names).toEqual(["extras-list-extras", "options-list-cooked", "options-list-cooked"]);
  });

  it("draws the dish's lists in the order they are offered, by their STAFF names", async () => {
    const { picker } = await openPicker(burger, "Burger", new WorkingOrderStore());
    const legends = [...picker.shadowRoot!.querySelectorAll("legend")].map((l) =>
      l.textContent!.trim(),
    );
    expect(legends).toEqual(["Extras", "Punto *"]);
    // The staff wording, never the diner's or the cook's.
    expect(picker.shadowRoot!.textContent).toContain("Bacon");
    expect(picker.shadowRoot!.textContent).not.toContain("Bacon carta");
    expect(picker.shadowRoot!.textContent).not.toContain("Bacon KDS");
    expect(picker.shadowRoot!.textContent).not.toContain("Punto carta");
  });

  it("prices each offered item at the price the offer resolved", async () => {
    const { picker } = await openPicker(burger, "Burger", new WorkingOrderStore());
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("1.50"));
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("1.00"));
  });

  it("gives a once-only item a checkbox and a repeatable item a stepper", async () => {
    const { picker } = await openPicker(burger, "Burger", new WorkingOrderStore());
    expect(pickBox(picker, "list-extras", "p-bacon")!.type).toBe("checkbox");
    expect(incButton(picker, "list-extras", "p-bacon")).toBeNull();
    expect(pickBox(picker, "list-extras", "p-cheese")).toBeNull();
    expect(incButton(picker, "list-extras", "p-cheese")).not.toBeNull();
    expect(stepCount(picker, "list-extras", "p-cheese")).toBe("0");
    expect(decButton(picker, "list-extras", "p-cheese")!.disabled).toBe(true);
  });

  it("blocks Add until a list with minPicks 1 has a pick, and marks it required", async () => {
    const { picker } = await openPicker(sandwich, "Bocadillo", new WorkingOrderStore());
    expect(picker.shadowRoot!.querySelector("legend")!.textContent!.trim()).toBe("Pan *");
    expect(addButton(picker).disabled).toBe(true);
    pickBox(picker, "list-bread", "p-white")!.click();
    await picker.updateComplete;
    expect(addButton(picker).disabled).toBe(false);
  });

  it("caps a list at maxPicks on the summed count", async () => {
    const { picker } = await openPicker(burger, "Burger", new WorkingOrderStore());
    incButton(picker, "list-extras", "p-cheese")!.click();
    incButton(picker, "list-extras", "p-cheese")!.click();
    await picker.updateComplete;
    expect(stepCount(picker, "list-extras", "p-cheese")).toBe("2");
    // Two of the list's allowance of two are taken: its own `+` and the untaken box both close.
    expect(incButton(picker, "list-extras", "p-cheese")!.disabled).toBe(true);
    expect(pickBox(picker, "list-extras", "p-bacon")!.disabled).toBe(true);
    // A click on a disabled `wt-button` still reaches the handler (the host takes it), so the cap
    // has to hold in the step itself, not only in Add's guard.
    incButton(picker, "list-extras", "p-cheese")!.click();
    await picker.updateComplete;
    expect(stepCount(picker, "list-extras", "p-cheese")).toBe("2");
  });

  it("caps one item at its own maxQuantity below the list's allowance", async () => {
    const roomy: TillProduct = {
      ...burger,
      offeredModifiers: [{ ...extrasList, maxPicks: null }],
    };
    const { picker } = await openPicker(roomy, "Burger", new WorkingOrderStore());
    for (let i = 0; i < 3; i += 1) incButton(picker, "list-extras", "p-cheese")!.click();
    await picker.updateComplete;
    expect(stepCount(picker, "list-extras", "p-cheese")).toBe("3");
    expect(incButton(picker, "list-extras", "p-cheese")!.disabled).toBe(true);
    // An uncapped list leaves every other item takeable.
    expect(pickBox(picker, "list-extras", "p-bacon")!.disabled).toBe(false);
  });

  it("starts a preselected item picked once", async () => {
    const preselected: TillProduct = {
      ...burger,
      offeredModifiers: [
        {
          ...extrasList,
          items: [
            offeredItem("p-bacon", "Bacon", "1.50", 1, true),
            offeredItem("p-cheese", "Queso", "1.00", 3, true),
          ],
        },
      ],
    };
    const { picker } = await openPicker(preselected, "Burger", new WorkingOrderStore());
    expect(pickBox(picker, "list-extras", "p-bacon")!.checked).toBe(true);
    expect(stepCount(picker, "list-extras", "p-cheese")).toBe("1");
  });

  it("preselects an options list's default label and requires exactly one", async () => {
    const { picker } = await openPicker(burger, "Burger", new WorkingOrderStore());
    expect(labelRadio(picker, "list-cooked", "label-medium").checked).toBe(true);
    expect(labelRadio(picker, "list-cooked", "label-rare").checked).toBe(false);
    expect(addButton(picker).disabled).toBe(false);
    labelRadio(picker, "list-cooked", "label-rare").click();
    await picker.updateComplete;
    expect(labelRadio(picker, "list-cooked", "label-rare").checked).toBe(true);
    expect(labelRadio(picker, "list-cooked", "label-medium").checked).toBe(false);
  });

  it("blocks Add while an options list with no default is unanswered", async () => {
    const undecided: TillProduct = {
      ...burger,
      offeredModifiers: [{ ...cookedList, defaultLabelId: null }],
    };
    const { picker } = await openPicker(undecided, "Burger", new WorkingOrderStore());
    expect(addButton(picker).disabled).toBe(true);
    labelRadio(picker, "list-cooked", "label-rare").click();
    await picker.updateComplete;
    expect(addButton(picker).disabled).toBe(false);
  });

  it("says so, and blocks Add, when an options list offers no label at all", async () => {
    const empty: TillProduct = {
      ...burger,
      offeredModifiers: [{ ...cookedList, defaultLabelId: null, labels: [] }],
    };
    const { picker } = await openPicker(empty, "Burger", new WorkingOrderStore());
    expect(addButton(picker).disabled).toBe(true);
    expect(picker.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain("Punto");
  });

  it("sums the dish and every pick into the running price", async () => {
    const roomy: TillProduct = {
      ...burger,
      offeredModifiers: [{ ...extrasList, maxPicks: null }, cookedList],
    };
    const { picker } = await openPicker(roomy, "Burger", new WorkingOrderStore());
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("8.00"));
    pickBox(picker, "list-extras", "p-bacon")!.click();
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("9.50"));
    // A pick taken twice is priced twice; the options answer above it adds nothing.
    incButton(picker, "list-extras", "p-cheese")!.click();
    incButton(picker, "list-extras", "p-cheese")!.click();
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("11.50"));
  });

  it("rings the dish with its picks and its answers on Add, then closes", async () => {
    const store = new WorkingOrderStore();
    const push = vi.spyOn(history, "pushState");
    // An uncapped list, so three picks in total are allowed and the emitted order can be read.
    const roomy: TillProduct = {
      ...burger,
      offeredModifiers: [{ ...extrasList, maxPicks: null }, cookedList],
    };
    const { el, picker } = await openPicker(roomy, "Burger", store);
    pickBox(picker, "list-extras", "p-bacon")!.click();
    incButton(picker, "list-extras", "p-cheese")!.click();
    incButton(picker, "list-extras", "p-cheese")!.click();
    labelRadio(picker, "list-cooked", "label-rare").click();
    await picker.updateComplete;
    addButton(picker).click();
    await el.updateComplete;

    const line = store.lines[0]!;
    expect(line.product).toBe(roomy);
    expect(line.extras).toEqual([
      { listId: "list-extras", productId: "p-bacon", name: "Bacon", price: "1.50", quantity: 1 },
      { listId: "list-extras", productId: "p-cheese", name: "Queso", price: "1.00", quantity: 2 },
    ]);
    expect(line.options).toEqual([{ listId: "list-cooked", labelId: "label-rare" }]);
    // The answer freezes six names and no ids, exactly as the server freezes it.
    expect(line.optionSnapshots).toEqual([
      {
        listName: { es: "Punto" },
        listCustomerName: { es: "Punto carta" },
        listKitchenName: "Punto KDS",
        labelName: { es: "Poco hecha" },
        labelCustomerName: { es: "Poco hecha carta" },
        labelKitchenName: "Poco hecha KDS",
      },
    ]);
    expect(pickerOf(el)).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("leaves a list the operator answered nothing on off the line entirely", async () => {
    const store = new WorkingOrderStore();
    const optional: TillProduct = { ...burger, offeredModifiers: [extrasList] };
    const { el, picker } = await openPicker(optional, "Burger", store);
    addButton(picker).click();
    await el.updateComplete;
    expect(store.lines).toEqual([{ product: optional, quantity: "1" }]);
  });

  it("unticking a pick removes it from the running price and from the line", async () => {
    const store = new WorkingOrderStore();
    const { el, picker } = await openPicker(burger, "Burger", store);
    pickBox(picker, "list-extras", "p-bacon")!.click();
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("9.50"));
    pickBox(picker, "list-extras", "p-bacon")!.click();
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).toContain(formatMoney("8.00"));
    addButton(picker).click();
    await el.updateComplete;
    expect(store.lines[0]!.extras).toBeUndefined();
  });

  it("steps a pick back to zero and deselects it", async () => {
    const store = new WorkingOrderStore();
    const { el, picker } = await openPicker(burger, "Burger", store);
    incButton(picker, "list-extras", "p-cheese")!.click();
    await picker.updateComplete;
    decButton(picker, "list-extras", "p-cheese")!.click();
    await picker.updateComplete;
    expect(stepCount(picker, "list-extras", "p-cheese")).toBe("0");
    addButton(picker).click();
    await el.updateComplete;
    expect(store.lines[0]!.extras).toBeUndefined();
  });

  it("counts the same product picked off two lists separately", async () => {
    const store = new WorkingOrderStore();
    const twice: TillProduct = {
      ...burger,
      offeredModifiers: [
        extrasList,
        { ...breadList, minPicks: 0, items: [offeredItem("p-bacon", "Bacon", "2.00")] },
      ],
    };
    const { el, picker } = await openPicker(twice, "Burger", store);
    pickBox(picker, "list-extras", "p-bacon")!.click();
    pickBox(picker, "list-bread", "p-bacon")!.click();
    await picker.updateComplete;
    addButton(picker).click();
    await el.updateComplete;
    expect(store.lines[0]!.extras).toEqual([
      { listId: "list-extras", productId: "p-bacon", name: "Bacon", price: "1.50", quantity: 1 },
      { listId: "list-bread", productId: "p-bacon", name: "Bacon", price: "2.00", quantity: 1 },
    ]);
  });

  it("refuses to confirm while a required list is unsatisfied (the guard)", async () => {
    const store = new WorkingOrderStore();
    const { el, picker } = await openPicker(sandwich, "Bocadillo", store);
    // Force-click Add past its disabled state: nothing rings and the picker stays open.
    addButton(picker).click();
    await el.updateComplete;
    expect(store.lines).toHaveLength(0);
    expect(pickerOf(el)).not.toBeNull();
  });

  it("closes without ringing when cancelled", async () => {
    const store = new WorkingOrderStore();
    const { el, picker } = await openPicker(burger, "Burger", store);
    picker.shadowRoot!.querySelector<HTMLElement>(".cancel")!.click();
    await el.updateComplete;
    expect(pickerOf(el)).toBeNull();
    expect(store.lines).toHaveLength(0);
  });

  describe("reopening a line's answers", () => {
    it("seeds the picker from the line's own answers, not from the offer's defaults", async () => {
      const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
        product: burger,
        initialSelections: {
          extras: [
            {
              listId: "list-extras",
              productId: "p-cheese",
              name: "Queso",
              price: "1.00",
              quantity: 2,
            },
          ],
          options: [{ listId: "list-cooked", labelId: "label-rare" }],
        },
      });
      expect(stepCount(el, "list-extras", "p-cheese")).toBe("2");
      expect(pickBox(el, "list-extras", "p-bacon")!.checked).toBe(false);
      expect(labelRadio(el, "list-cooked", "label-rare").checked).toBe(true);
      expect(labelRadio(el, "list-cooked", "label-medium").checked).toBe(false);
    });

    it("does not re-apply a default over a draft that deliberately picked nothing", async () => {
      const preselected: TillProduct = {
        ...burger,
        offeredModifiers: [
          { ...extrasList, items: [offeredItem("p-bacon", "Bacon", "1.50", 1, true)] },
        ],
      };
      const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
        product: preselected,
        initialSelections: { extras: [] },
      });
      expect(pickBox(el, "list-extras", "p-bacon")!.checked).toBe(false);
    });

    it("seeds once: a re-set product does not reset what the operator has already picked", async () => {
      const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
        product: burger,
      });
      incButton(el, "list-extras", "p-cheese")!.click();
      await el.updateComplete;
      expect(stepCount(el, "list-extras", "p-cheese")).toBe("1");
      el.product = structuredClone(burger);
      await el.updateComplete;
      expect(stepCount(el, "list-extras", "p-cheese")).toBe("1");
    });

    it("does not answer a changed options list with its new default over a stale answer", async () => {
      const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
        product: { ...burger, offeredModifiers: [cookedList] },
      });
      expect(addButton(el).disabled).toBe(false);
      el.product = {
        ...burger,
        offeredModifiers: [
          {
            ...cookedList,
            defaultLabelId: "label-other",
            labels: [
              {
                id: "label-other",
                name: "Muy hecha",
                customerName: { es: "Muy hecha carta" },
                kitchenName: "Muy hecha KDS",
                available: true,
              },
            ],
          },
        ],
      };
      await el.updateComplete;
      expect(addButton(el).disabled).toBe(true);
      expect(labelRadio(el, "list-cooked", "label-other").checked).toBe(false);
    });

    it("blocks Add when a seeded pick is no longer offered, rather than dropping it silently", async () => {
      const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
        product: burger,
        initialSelections: {
          extras: [
            { listId: "list-extras", productId: "p-gone", name: "Ido", price: "1.00", quantity: 1 },
          ],
          options: [{ listId: "list-cooked", labelId: "label-rare" }],
        },
      });
      expect(addButton(el).disabled).toBe(true);
      expect(el.shadowRoot!.querySelector('[role="alert"]')).not.toBeNull();
    });
  });

  describe("variants", () => {
    const wine = (
      id: string,
      unitPrice: string,
      unitPriceDifference: string | null,
      available = true,
    ) => ({
      id,
      name: `${id} staff`,
      customerName: { en: `${id} menu`, es: `${id} carta` },
      kitchenName: `${id} KDS`,
      unitPrice,
      unitPriceDifference,
      available,
    });
    // The parent's price is 4.00: "Wine 125" is dearer, "Wine 100" cheaper, "Wine 150" the same.
    const wineProduct: TillProduct = {
      ...cafe,
      name: "Vino",
      unitPrice: "4.00",
      menuItemId: "offer-wine",
      variants: [
        wine("Wine 100", "3.50", "-0.50", false),
        wine("Wine 125", "5.50", "1.50"),
        wine("Wine 150", "4.00", null),
      ],
    };

    const radios = (picker: TillModifierPicker) => [
      ...picker.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="product-variant"]'),
    ];

    it("lists the variants only, never the parent, by their STAFF names", async () => {
      const { picker } = await openPicker(wineProduct, "Vino", new WorkingOrderStore());
      expect(radios(picker).map((radio) => radio.value)).toEqual([
        "Wine 100",
        "Wine 125",
        "Wine 150",
      ]);
      const text = picker.shadowRoot!.querySelector("fieldset")!.textContent!;
      expect(text).toContain("Wine 125 staff");
      expect(text).not.toContain("Wine 125 carta");
      expect(text).not.toContain("Vino");
    });

    it("preselects the first available variant in variant order, so Add is enabled at once", async () => {
      const store = new WorkingOrderStore();
      const { el, picker } = await openPicker(wineProduct, "Vino", store);
      expect(radios(picker).map((radio) => radio.checked)).toEqual([false, true, false]);
      expect(addButton(picker).disabled).toBe(false);
      addButton(picker).click();
      await el.updateComplete;
      expect(store.lines[0]!.product).toMatchObject({
        name: "Vino",
        variantId: "Wine 125",
        variantName: "Wine 125 staff",
        variantCustomerName: { en: "Wine 125 menu", es: "Wine 125 carta" },
        variantKitchenName: "Wine 125 KDS",
        unitPrice: "5.50",
      });
    });

    it("shows an unavailable variant disabled", async () => {
      const { picker } = await openPicker(wineProduct, "Vino", new WorkingOrderStore());
      expect(radios(picker).map((radio) => radio.disabled)).toEqual([true, false, false]);
    });

    it("labels a variant priced above or below its parent with the difference, and one at the same price with none", async () => {
      const { picker } = await openPicker(wineProduct, "Vino", new WorkingOrderStore());
      const differences = [
        ...picker.shadowRoot!.querySelectorAll<HTMLElement>("fieldset label.option"),
      ].map((option) => option.querySelector(".price-difference")?.textContent?.trim() ?? null);
      expect(differences).toEqual([
        `\u2212${formatMoney("0.50")}`,
        `+${formatMoney("1.50")}`,
        null,
      ]);
    });

    it("rings the chosen variant's price after another is picked", async () => {
      const store = new WorkingOrderStore();
      const { el, picker } = await openPicker(wineProduct, "Vino", store);
      radios(picker)[2]!.click();
      await picker.updateComplete;
      addButton(picker).click();
      await el.updateComplete;
      expect(store.lines[0]!.product).toMatchObject({ variantId: "Wine 150", unitPrice: "4.00" });
    });
  });

  describe("what blocks Add reads as more than body copy", () => {
    /** Computed style of the first element matching `selector` inside the picker. */
    function styleOf(picker: TillModifierPicker, selector: string): CSSStyleDeclaration {
      return getComputedStyle(picker.shadowRoot!.querySelector<HTMLElement>(selector)!);
    }

    it("sets the per-list counter apart from the item names beside it", async () => {
      const { picker } = await openPicker(burger, "Burger", new WorkingOrderStore());
      const counter = styleOf(picker, ".selected-total");
      const name = styleOf(picker, ".option-name");
      expect(counter.color).not.toBe(name.color);
      expect(parseFloat(counter.fontSize)).toBeLessThan(parseFloat(name.fontSize));
      // A paragraph with no rule of its own keeps the user agent's 1em margins, which is also the
      // only em-derived spacing this file would carry.
      expect(counter.marginTop).toBe("0px");
    });

    it("marks an options list with nothing to choose as a refusal, not as prose", async () => {
      const empty: TillProduct = {
        ...burger,
        offeredModifiers: [extrasList, { ...cookedList, defaultLabelId: null, labels: [] }],
      };
      const { picker } = await openPicker(empty, "Burger", new WorkingOrderStore());
      expect(addButton(picker).disabled).toBe(true);
      const alert = styleOf(picker, '[role="alert"]');
      const name = styleOf(picker, ".option-name");
      expect(alert.color).not.toBe(name.color);
      expect(Number(alert.fontWeight)).toBeGreaterThan(Number(name.fontWeight));
    });

    it("marks a pick the dish no longer offers as a refusal, not as prose", async () => {
      const { el } = await mountWidget<TillModifierPicker>("till-modifier-picker", {
        product: burger,
        initialSelections: {
          extras: [
            { listId: "list-extras", productId: "p-gone", name: "Ido", price: "1.00", quantity: 1 },
          ],
          options: [{ listId: "list-cooked", labelId: "label-rare" }],
        },
      });
      expect(addButton(el).disabled).toBe(true);
      const alert = styleOf(el, '[role="alert"]');
      const name = styleOf(el, ".option-name");
      expect(alert.color).not.toBe(name.color);
      expect(Number(alert.fontWeight)).toBeGreaterThan(Number(name.fontWeight));
    });
  });

  describe("reaching the actions", () => {
    /** A dish with the lists a real burger carries — six extras and four cooking points. Its body is
     * taller than a phone screen, which is the case the actions have to survive. */
    const loadedBurger: TillProduct = {
      ...burger,
      offeredModifiers: [
        {
          ...(extrasList as OfferedModifier & { kind: "extras" }),
          items: [
            offeredItem("p-bacon", "Bacon", "1.50"),
            offeredItem("p-cheese", "Queso", "1.00", 3),
            offeredItem("p-egg", "Huevo", "1.20"),
            offeredItem("p-onion", "Cebolla caramelizada", "0.80"),
            offeredItem("p-jalapeno", "Jalapenos", "0.60"),
            offeredItem("p-avocado", "Aguacate", "1.80"),
          ],
          maxPicks: 6,
        },
        {
          ...(cookedList as OfferedModifier & { kind: "options" }),
          labels: [
            ...(cookedList as OfferedModifier & { kind: "options" }).labels,
            {
              id: "label-well",
              name: "Muy hecha",
              customerName: { es: "Muy hecha carta" },
              kitchenName: "Muy hecha KDS",
              available: true,
            },
            {
              id: "label-blue",
              name: "Vuelta y vuelta",
              customerName: { es: "Vuelta y vuelta carta" },
              kitchenName: "Vuelta y vuelta KDS",
              available: true,
            },
          ],
        },
      ],
    };

    /** Both viewports are measured with `page.viewport`, which resizes the iframe the components
     * actually render in; `commands.setViewportSize` resizes the outer page and leaves the iframe
     * at its default, so a width claim taken through it measures nothing (testing-guide.md). Each
     * case reads `window.innerWidth` back before it asserts anything about a layout. */
    it.each([
      [390, 844],
      [1024, 768],
    ])("keeps Cancel and Add on screen at %ix%i", async (width, height) => {
      await page.viewport(width, height);
      const { picker } = await openPicker(loadedBurger, "Burger", new WorkingOrderStore());
      expect(window.innerWidth).toBe(width);
      expect(window.innerHeight).toBe(height);
      const confirm = addButton(picker).getBoundingClientRect();
      const cancel = picker
        .shadowRoot!.querySelector<HTMLElement>(".cancel")!
        .getBoundingClientRect();
      expect(confirm.bottom).toBeLessThanOrEqual(height);
      expect(cancel.bottom).toBeLessThanOrEqual(height);
      expect(confirm.top).toBeGreaterThanOrEqual(0);
    });
  });

  describe("per-line note", () => {
    /** The note textarea inside the picker, or null when absent. */
    function noteBox(picker: TillModifierPicker): HTMLTextAreaElement | null {
      return picker.shadowRoot!.querySelector<HTMLTextAreaElement>('[data-test="line-note"]');
    }

    it("shows a note textarea for every product the picker opens over", async () => {
      const { picker } = await openPicker(burger, "Burger", new WorkingOrderStore());
      expect(noteBox(picker)).not.toBeNull();
      expect(noteBox(picker)!.maxLength).toBe(200);
    });

    it("carries the typed note on Add (through to the rung line)", async () => {
      const store = new WorkingOrderStore();
      const { el, picker } = await openPicker(burger, "Burger", store);
      const note = noteBox(picker)!;
      note.value = "well seasoned, no butter";
      note.dispatchEvent(new Event("input"));
      await picker.updateComplete;
      addButton(picker).click();
      await el.updateComplete;
      expect(store.lines[0]!.note).toBe("well seasoned, no butter");
    });

    it("folds a whitespace-only note to nothing (not chosen)", async () => {
      const store = new WorkingOrderStore();
      const optional: TillProduct = { ...burger, offeredModifiers: [extrasList] };
      const { el, picker } = await openPicker(optional, "Burger", store);
      const note = noteBox(picker)!;
      note.value = "   ";
      note.dispatchEvent(new Event("input"));
      await picker.updateComplete;
      addButton(picker).click();
      await el.updateComplete;
      expect(store.lines).toEqual([{ product: optional, quantity: "1" }]);
    });
  });
});

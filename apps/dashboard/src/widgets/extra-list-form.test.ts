import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import (not `import type`): pulls the module in for its `@customElement` side effect, so
// `mountWidget` can create `dashboard-extra-list-form`.
import { ExtraListForm } from "./extra-list-form.js";
import type { ExtraList, ExtraListInput, Product } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const BACON = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const EGG = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const BACON_ITEM = "11111111-1111-4111-8111-111111111111";
const EGG_ITEM = "22222222-2222-4222-8222-222222222222";

/**
 * The two products below are priced DIFFERENTLY on purpose: the inheritance hint is only checkable
 * when a placeholder taken from the wrong product would read differently from the right one.
 *
 * All THREE of a product's names read differently too (CLAUDE.md §3). A blank `kitchenName` would
 * fall back to the staff name, so a cell reading the kitchen name where the staff name belongs would
 * pass whichever one it read.
 */
function product(overrides: Partial<Product> = {}): Product {
  return {
    id: BACON,
    modifiers: [],
    catalogueId: "cat-1",
    categoryId: "category-1",
    labelIds: [],
    primaryCategoryId: "category-1",
    name: "Bacon",
    customerName: { es: "Bacon ahumado" },
    unitId: "unit-each",
    unit: { id: "unit-each", name: { es: "Unidad" }, precision: 0, abbreviation: { es: "ud" } },
    description: null,
    kitchenName: "BCN",
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "reduced",
    active: true,
    available: true,
    soldAlone: false,
    allergens: null,
    dietOverride: null,
    manualAllergens: null,
    image: null,
    variants: [],
    ...overrides,
  };
}

const products: Product[] = [
  product(),
  product({
    id: EGG,
    name: "Fried egg",
    customerName: { es: "Huevo frito" },
    kitchenName: "FRIEDEGG",
    unitPrice: "0.80",
  }),
];

/**
 * The three names read DIFFERENTLY everywhere in this fixture (CLAUDE.md §3): a surface that shows
 * the staff name where the customer name belongs fails instead of passing by coincidence.
 */
const addons: ExtraList = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Add-ons",
  customerName: { en: "Make it yours", es: "Añádele algo" },
  kitchenName: "ADD",
  minPicks: 0,
  maxPicks: 2,
  active: true,
  items: [
    { id: BACON_ITEM, productId: BACON, maxQuantity: 2, preselected: true, price: "2.00" },
    { id: EGG_ITEM, productId: EGG, maxQuantity: 1, preselected: false, price: null },
  ],
};

const languages = { defaultLanguage: "en", languages: ["en", "es"] };

async function mount(props: Partial<ExtraListForm> = {}) {
  return mountWidget<ExtraListForm>("dashboard-extra-list-form", {
    open: true,
    languages,
    products,
    ...props,
  });
}

function field<T extends Element>(el: ExtraListForm, name: string): T {
  return el.shadowRoot!.querySelector<T>(`[name="${name}"]`)!;
}

/** Type into a `wt-input` the way the primitive announces a change. */
async function type(el: ExtraListForm, name: string, value: string): Promise<void> {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

/** Flip a `wt-switch` the way the primitive announces a change. */
async function toggle(el: ExtraListForm, name: string, checked: boolean): Promise<void> {
  field(el, name).dispatchEvent(
    new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function click(el: ExtraListForm, testId: string): Promise<void> {
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${testId}"]`)!.click();
  await el.updateComplete;
}

function picker(el: ExtraListForm): HTMLElementTagNameMap["wt-combobox"] {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
    '[data-test="add-product"]',
  )!;
}

async function addItem(el: ExtraListForm, name: string): Promise<void> {
  const combobox = picker(el);
  await combobox.updateComplete;
  combobox.shadowRoot!.querySelector<HTMLElement>("button.trigger")!.click();
  await combobox.updateComplete;
  const option = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (row) => row.textContent!.trim() === name,
  );
  if (option === undefined) throw new Error(`the picker offers no product called ${name}`);
  option.click();
  await el.updateComplete;
  await click(el, "add-item");
}

function text(el: ExtraListForm, testId: string): string {
  return el.shadowRoot!.querySelector(`[data-test="${testId}"]`)!.textContent!.trim();
}

function summary(el: ExtraListForm): string[] {
  const box = el.shadowRoot!.querySelector("wt-form-error-summary")!;
  return [...box.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent!.trim());
}

/** Counts submissions as well as capturing the last one: a composed event re-emitted without
 * stopping the original arrives twice, and a single-shot listener cannot see that. */
function record(host: HTMLElement) {
  const seen: ExtraListInput[] = [];
  host.addEventListener("wt-submit", (event) => {
    seen.push((event as CustomEvent<{ value: ExtraListInput }>).detail.value);
  });
  return seen;
}

it("submits a new list once, minting an id for every item it was given", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Add-ons");
  await type(el, "customer-name-en", "Make it yours");
  await type(el, "customer-name-es", "Añádele algo");
  await type(el, "kitchen-name", "ADD");
  await type(el, "max-picks", "2");
  await addItem(el, "Bacon");
  await type(el, "item-0-max-quantity", "3");
  await toggle(el, "item-0-preselected", true);
  await type(el, "item-0-price", "2.00");
  await addItem(el, "Fried egg");
  await click(el, "save");

  expect(submitted).toHaveLength(1);
  const value = submitted[0]!;
  expect(value.items.map((item) => item.id)).toEqual([
    expect.stringMatching(UUID),
    expect.stringMatching(UUID),
  ]);
  expect(value).toEqual({
    name: "Add-ons",
    customerName: { en: "Make it yours", es: "Añádele algo" },
    kitchenName: "ADD",
    minPicks: 0,
    maxPicks: 2,
    active: true,
    items: [
      {
        id: value.items[0]!.id,
        productId: BACON,
        maxQuantity: 3,
        preselected: true,
        price: "2.00",
      },
      { id: value.items[1]!.id, productId: EGG, maxQuantity: 1, preselected: false, price: null },
    ],
  });
});

it("submits an edit under the ids it was given, keeping the fields it did not touch", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);

  await type(el, "item-0-max-quantity", "4");
  await toggle(el, "active", false);
  await click(el, "save");

  expect(submitted).toEqual([
    {
      name: "Add-ons",
      customerName: addons.customerName,
      kitchenName: "ADD",
      minPicks: 0,
      maxPicks: 2,
      active: false,
      items: [{ ...addons.items[0]!, maxQuantity: 4 }, { ...addons.items[1]! }],
    },
  ]);
});

it("shows each row's product by its STAFF name, not the customer-facing or kitchen one", async () => {
  const { el } = await mount({ value: addons });

  expect(text(el, "item-0-product")).toBe("Bacon");
  expect(text(el, "item-1-product")).toBe("Fried egg");
  expect(el.shadowRoot!.textContent).not.toContain("Bacon ahumado");
  expect(el.shadowRoot!.textContent).not.toContain("Huevo frito");
  expect(el.shadowRoot!.textContent).not.toContain("BCN");
  expect(el.shadowRoot!.textContent).not.toContain("FRIEDEGG");
});

it("hints an inherited price with the product's own and submits it as null", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Add-ons");
  await addItem(el, "Fried egg");
  await addItem(el, "Bacon");

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-price").value).toBe("");
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-price").placeholder).toBe("0.80");
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-1-price").placeholder).toBe("1.50");

  await click(el, "save");
  expect(submitted[0]!.items.map((item) => item.price)).toEqual([null, null]);
});

it("submits a typed price as a string, even when it is the product's own price", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Add-ons");
  await addItem(el, "Fried egg");
  await type(el, "item-0-price", "0.80");
  await click(el, "save");

  expect(submitted[0]!.items[0]!.price).toBe("0.80");
});

it("refuses a list with no staff name, beside the name field and in the summary", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await addItem(el, "Bacon");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "name").error).toBe(
    t("extras.name_required"),
  );
  expect(summary(el)).toEqual([t("extras.name_required")]);
});

it("refuses a maximum below the minimum on the MAXIMUM field, as the contract names it", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);

  await type(el, "min-picks", "3");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "max-picks").error).toBe(
    t("extras.max_picks_too_low"),
  );
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "min-picks").error).toBe("");
  expect(summary(el)).toEqual([t("extras.max_picks_too_low")]);
});

it("refuses a pick bound that is not a whole number within the allowed limit", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);

  // Above `MAX_MODIFIER_INTEGER` (packages/catalogue/src/modifier-limits.ts).
  await type(el, "min-picks", "2147483648");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "min-picks").error).toBe(
    t("extras.picks_invalid"),
  );
  expect(summary(el)).toEqual([t("extras.picks_invalid")]);

  await type(el, "min-picks", "1");
  await type(el, "max-picks", "one");
  await click(el, "save");
  expect(submitted).toEqual([]);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "max-picks").error).toBe(
    t("extras.picks_invalid"),
  );
});

it("refuses an in-use list with no products, and saves the same list once it is out of use", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Add-ons");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(text(el, "items-error")).toContain(t("extras.items_required"));
  expect(summary(el)).toContain(t("extras.items_required"));

  await toggle(el, "active", false);
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.items).toEqual([]);
});

it("refuses the same product offered twice, beside the second row and in the summary", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Add-ons");
  await addItem(el, "Bacon");
  await addItem(el, "Bacon");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(text(el, "item-1-product-error")).toBe(t("extras.duplicate_product"));
  expect(el.shadowRoot!.querySelector('[data-test="item-0-product-error"]')).toBeNull();
  expect(summary(el)).toEqual([t("extras.duplicate_product")]);

  await click(el, "remove-item-1");
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.items.map((item) => item.productId)).toEqual([BACON]);
});

it("refuses a maximum quantity that is not a whole number of at least 1", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);

  await type(el, "item-1-max-quantity", "0");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-1-max-quantity").error).toBe(
    t("extras.quantity_invalid"),
  );
  expect(summary(el)).toEqual([t("extras.quantity_invalid")]);
});

it("refuses a price the product-price rule does not accept", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);

  // `isProductPrice` (packages/catalogue/src/modifier-limits.ts) allows no leading zero and at most
  // two decimals, so both of these are refused where `1.50` and `0.80` are not.
  await type(el, "item-0-price", "007");
  await click(el, "save");
  expect(submitted).toEqual([]);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-price").error).toBe(
    t("extras.price_invalid"),
  );
  expect(summary(el)).toEqual([t("extras.price_invalid")]);

  await type(el, "item-0-price", "1.505");
  await click(el, "save");
  expect(submitted).toEqual([]);

  await type(el, "item-0-price", "1.50");
  await click(el, "save");
  expect(submitted[0]!.items[0]!.price).toBe("1.50");
});

it("puts a rejected field's message beside the input the server named and in the summary", async () => {
  const { el } = await mount({
    value: addons,
    fieldErrors: {
      kitchenName: "Too long for the kitchen.",
      "items.1.maxQuantity": "Too many of those.",
      "items.0.productId": "That product was deleted.",
    },
  });

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "kitchen-name").error).toBe(
    "Too long for the kitchen.",
  );
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-1-max-quantity").error).toBe(
    "Too many of those.",
  );
  expect(text(el, "item-0-product-error")).toBe("That product was deleted.");
  expect(summary(el).sort()).toEqual([
    "That product was deleted.",
    "Too long for the kitchen.",
    "Too many of those.",
  ]);
});

it("keeps a rejected item's message on that item after it is moved", async () => {
  const { el } = await mount({
    value: addons,
    fieldErrors: { "items.1.maxQuantity": "Too many of those." },
  });

  const handle = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${EGG_ITEM}"]`)!;
  handle.focus();
  await userEvent.keyboard("{ArrowUp}");
  await el.updateComplete;

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-max-quantity").error).toBe(
    "Too many of those.",
  );
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-1-max-quantity").error).toBe("");
});

it("submits the items in the order the operator moved them into", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);

  const handle = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${BACON_ITEM}"]`)!;
  handle.focus();
  await userEvent.keyboard("{ArrowDown}");
  await el.updateComplete;
  await click(el, "save");

  expect(submitted[0]!.items.map((item) => item.id)).toEqual([EGG_ITEM, BACON_ITEM]);
  expect(submitted[0]!.items.map((item) => item.productId)).toEqual([EGG, BACON]);
});

it("names a product it was given no row for rather than rendering an empty cell", async () => {
  const { el } = await mount({ value: addons, products: [products[0]!] });

  expect(text(el, "item-0-product")).toBe("Bacon");
  expect(text(el, "item-1-product")).toBe(t("extras.unknown_product"));
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-1-price").placeholder).toBe("");
});

it("offers every product it was given, and adds nothing until one is chosen", async () => {
  const { el } = await mount();

  expect(picker(el).options).toEqual([
    { value: BACON, label: "Bacon" },
    { value: EGG, label: "Fried egg" },
  ]);

  await click(el, "add-item");
  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(0);

  await addItem(el, "Bacon");
  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(picker(el).value).toBe("");
});

it("emits one wt-cancel, and neither event while it is saving", async () => {
  const { el, host } = await mount({ value: addons, busy: true });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);
  const submitted = record(host);

  await click(el, "cancel");
  await click(el, "save");
  expect(cancels).toBe(0);
  expect(submitted).toEqual([]);

  el.busy = false;
  await el.updateComplete;
  await click(el, "cancel");
  expect(cancels).toBe(1);
});

it("paints its own error text with the danger token and keeps the row controls tappable", async () => {
  const { el, host } = await mount();
  host.style.setProperty("--wt-color-danger", "rgb(13, 14, 15)");
  host.style.setProperty("--wt-tap-min", "44px");

  await type(el, "name", "Add-ons");
  await click(el, "save");

  const error = el.shadowRoot!.querySelector<HTMLElement>('[data-test="items-error"]')!;
  expect(getComputedStyle(error).color).toBe("rgb(13, 14, 15)");

  await addItem(el, "Bacon");
  await addItem(el, "Bacon");
  await click(el, "save");
  const duplicate = el.shadowRoot!.querySelector<HTMLElement>(
    '[data-test="item-1-product-error"]',
  )!;
  expect(getComputedStyle(duplicate).color).toBe("rgb(13, 14, 15)");

  const handle = el.shadowRoot!.querySelector<HTMLElement>(
    `[data-test="drag-${
      el.shadowRoot!.querySelector("tbody tr")!.getAttribute("data-item") ?? ""
    }"]`,
  )!;
  const { width, height } = handle.getBoundingClientRect();
  expect({ width: width >= 44, height: height >= 44 }).toEqual({ width: true, height: true });
});

// A lone `wt-input` in a `<td>` has no width of its own, so an automatic table layout gives the
// column whatever its HEADER needs and nothing more. Measured, not asserted on text — `.value` reads
// "12.50" either way.
it("shows a whole price, not a truncated one, at phone width", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(390, 844);
  try {
    const { el } = await mount({
      value: {
        ...addons,
        items: [
          { id: BACON_ITEM, productId: BACON, maxQuantity: 2, preselected: true, price: "12.50" },
        ],
      },
    });
    const priceInput = field<HTMLElement>(el, "item-0-price").shadowRoot!.querySelector("input")!;
    expect({
      value: priceInput.value,
      overflowing: priceInput.scrollWidth > priceInput.clientWidth,
    }).toEqual({ value: "12.50", overflowing: false });
  } finally {
    await page.viewport(width, height);
  }
});

it("puts each list-level refusal beside the input it names, and a switch's in the summary", async () => {
  const { el } = await mount({
    value: addons,
    fieldErrors: {
      customerName: "Needs a customer-facing name.",
      minPicks: "Too many required.",
      maxPicks: "Too many allowed.",
      active: "Cannot be switched off.",
    },
  });

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "customer-name-en").error).toBe(
    "Needs a customer-facing name.",
  );
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "customer-name-es").error).toBe("");
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "min-picks").error).toBe(
    "Too many required.",
  );
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "max-picks").error).toBe("Too many allowed.");
  expect(summary(el).sort()).toEqual([
    "Cannot be switched off.",
    "Needs a customer-facing name.",
    "Too many allowed.",
    "Too many required.",
  ]);
});

it("puts an item's price refusal beside that item's price, and its preselection's in the summary", async () => {
  const { el } = await mount({
    value: addons,
    fieldErrors: { "items.1.price": "Too cheap.", "items.0.preselected": "Not allowed here." },
  });

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-1-price").error).toBe("Too cheap.");
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-price").error).toBe("");
  expect(el.shadowRoot!.querySelector('[data-test="items-error"]')).toBeNull();
  expect(summary(el).sort()).toEqual(["Not allowed here.", "Too cheap."]);
});

it.each([
  ["an item as a whole", "items.0"],
  ["an item field with no cell", "items.0.id"],
  ["an item the form does not hold", "items.7.price"],
  ["a list field with no input", "items"],
])("shows a refusal naming %s under the items table", async (_what, path) => {
  const { el } = await mount({ value: addons, fieldErrors: { [path]: "Something is wrong." } });

  expect(text(el, "items-error")).toBe("Something is wrong.");
  expect(summary(el)).toEqual(["Something is wrong."]);
});

it("moves a rejected item's message under the items table once that item is removed", async () => {
  const { el } = await mount({ value: addons, fieldErrors: { "items.1.price": "Too cheap." } });
  expect(el.shadowRoot!.querySelector('[data-test="items-error"]')).toBeNull();

  await click(el, "remove-item-1");

  expect(text(el, "items-error")).toBe("Too cheap.");
  expect(summary(el)).toEqual(["Too cheap."]);
});

it("submits a blank minimum as 0, the contract's own default", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);

  await type(el, "min-picks", "  ");
  await click(el, "save");

  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.minPicks).toBe(0);
});

it("holds the dialog open against Escape only while it is saving", async () => {
  const { el } = await mount({ value: addons });
  const modal = el.shadowRoot!.querySelector("wt-modal")!;
  const press = (key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    modal.dispatchEvent(event);
    return event.defaultPrevented;
  };

  expect(press("Escape")).toBe(false);
  el.busy = true;
  await el.updateComplete;
  expect(press("Escape")).toBe(true);
  expect(press("Enter")).toBe(false);
});

it("ignores a drag whose row was removed mid-gesture, leaving the save's messages in place", async () => {
  const third = { id: "44444444-4444-4444-8444-444444444444", name: "Cheese", unitPrice: "1.00" };
  const { el, host } = await mount({
    value: {
      ...addons,
      items: [
        ...addons.items,
        { id: third.id, productId: third.id, maxQuantity: 1, preselected: false, price: null },
      ],
    },
    products: [...products, product(third)],
  });
  const submitted = record(host);
  const handle = el.shadowRoot!.querySelector<HTMLElement>(`[data-test="drag-${BACON_ITEM}"]`)!;
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));

  await click(el, "remove-item-0");
  await type(el, "name", "");
  await click(el, "save");
  expect(summary(el)).toEqual([t("extras.name_required")]);

  const firstRow = el.shadowRoot!.querySelector("tbody tr")!.getBoundingClientRect();
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 1,
      clientY: firstRow.top + firstRow.height / 2,
    }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));
  await el.updateComplete;

  expect(summary(el)).toEqual([t("extras.name_required")]);
  await type(el, "name", "Add-ons");
  await click(el, "save");
  expect(submitted[0]!.items.map((item) => item.id)).toEqual([EGG_ITEM, third.id]);
});

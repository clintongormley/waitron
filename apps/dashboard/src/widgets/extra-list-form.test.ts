import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { registerIcons } from "@waitron/ui";
import { DASHBOARD_ICONS } from "../icons.js";
import { cleanupWidgets, closeReportsDelivered, mountWidget } from "./test-helpers.js";
import { formMessageOf } from "@waitron/ui/src/test-helpers.js";
// Value import (not `import type`): pulls the module in for its `@customElement` side effect, so
// `mountWidget` can create `dashboard-extra-list-form`.
import { ExtraListForm } from "./extra-list-form.js";
import type { ExtraList, ExtraListInput, Product } from "../api/client.js";
import { setLocale, t } from "../i18n/t.js";

registerIcons(DASHBOARD_ICONS);
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
    primaryCategoryId: "category-1",
    name: "Bacon",
    customerName: { es: "Bacon ahumado" },
    unitId: "00000000-0000-0000-0000-000000000001",
    unit: {
      id: "00000000-0000-0000-0000-000000000001",
      name: { es: "Unidad" },
      precision: 0,
      abbreviation: { es: "ud" },
    },
    description: null,
    kitchenName: "BCN",
    dietaryDeclarations: [],
    pricingUnit: "each",
    unitPrice: "1.50",
    vatClass: "reduced",
    active: true,
    available: true,
    ordering: "not_sold_separately",
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

/** The picker offers no product the list holds, so a duplicate comes only from a list the form is
 * given. */
const baconTwice: ExtraList = {
  ...addons,
  id: "44444444-4444-4444-8444-444444444444",
  items: [
    { id: BACON_ITEM, productId: BACON, maxQuantity: 1, preselected: false, price: null },
    { id: EGG_ITEM, productId: BACON, maxQuantity: 1, preselected: false, price: null },
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

async function openPicker(el: ExtraListForm): Promise<HTMLElementTagNameMap["wt-combobox"]> {
  const combobox = picker(el);
  await combobox.updateComplete;
  combobox.shadowRoot!.querySelector<HTMLElement>("button.trigger")!.click();
  await combobox.updateComplete;
  return combobox;
}

async function addItem(el: ExtraListForm, name: string): Promise<void> {
  const combobox = await openPicker(el);
  const option = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (row) => row.textContent!.trim() === name,
  );
  if (option === undefined) throw new Error(`the picker offers no product called ${name}`);
  option.click();
  await el.updateComplete;
}

function text(el: ExtraListForm, testId: string): string {
  return el.shadowRoot!.querySelector(`[data-test="${testId}"]`)!.textContent!.trim();
}

async function bottomOf(el: ExtraListForm): Promise<string> {
  const actions = el.shadowRoot!.querySelector("wt-form-actions")!;
  return (await formMessageOf(actions))?.textContent?.trim() ?? "";
}

const saveOf = (el: ExtraListForm): HTMLElementTagNameMap["wt-button"] =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="save"]')!;

const errorOf = (el: ExtraListForm, name: string): string =>
  field<HTMLElementTagNameMap["wt-input"]>(el, name).error;

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

it("clears an item's maximum from two through one to no limit and submits null", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);
  const stepper = field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "item-0-max-quantity");
  const decrease = stepper.shadowRoot!.querySelector<HTMLButtonElement>('[data-step="-1"]')!;
  decrease.click();
  await el.updateComplete;
  expect(stepper.value).toBe("1");
  decrease.click();
  await el.updateComplete;
  expect(stepper.value).toBe("");
  expect(stepper.shadowRoot!.querySelector("input")!.placeholder).toBe("∞");
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.items[0]!.maxQuantity).toBeNull();
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

it("refuses a list with no staff name, beside the name field and in the bottom message", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await addItem(el, "Bacon");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "name").error).toBe(
    t("extras.name_required"),
  );
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(el.shadowRoot!.querySelector("wt-form-error-summary")).toBeNull();
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
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
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
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));

  await type(el, "min-picks", "1");
  await type(el, "max-picks", "one");
  await click(el, "save");
  expect(submitted).toEqual([]);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "max-picks").error).toBe(
    t("extras.picks_invalid"),
  );
});

it("refuses an active list with no products, and saves the same list once it is inactive", async () => {
  const { el, host } = await mount();
  const submitted = record(host);

  await type(el, "name", "Add-ons");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(text(el, "items-error")).toContain(t("extras.items_required"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);

  await toggle(el, "active", false);
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.items).toEqual([]);
});

it("refuses the same product offered twice, beside the second row and in the bottom message", async () => {
  const { el, host } = await mount({ value: baconTwice });
  const submitted = record(host);

  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(text(el, "item-1-product-error")).toBe(t("extras.duplicate_product"));
  expect(el.shadowRoot!.querySelector('[data-test="item-0-product-error"]')).toBeNull();
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));

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
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
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
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));

  await type(el, "item-0-price", "1.505");
  await click(el, "save");
  expect(submitted).toEqual([]);

  await type(el, "item-0-price", "1.50");
  await click(el, "save");
  expect(submitted[0]!.items[0]!.price).toBe("1.50");
});

it("puts a rejected field's message beside the input the server named, leaving Save working", async () => {
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
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).disabled).toBe(false);
});

it("keeps a rejected item's message on that item after it is moved", async () => {
  const { el } = await mount({
    value: addons,
    fieldErrors: { "items.1.maxQuantity": "Too many of those." },
  });
  // A refusal takes focus when it arrives; let it land before the handle is focused.
  await new Promise((resolve) => setTimeout(resolve));

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

it("offers every product it was given to an empty list, and adds nothing until one is chosen", async () => {
  const { el } = await mount();

  expect(picker(el).options).toEqual([
    { value: BACON, label: "Bacon" },
    { value: EGG, label: "Fried egg" },
  ]);

  const combobox = await openPicker(el);
  await userEvent.keyboard("{Escape}");
  await combobox.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(0);

  await addItem(el, "Bacon");
  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(picker(el).value).toBe("");
});

it.each([
  ["en", "Add a product", "Bacon added."],
  ["es", "Añadir un producto", "Se ha añadido Bacon."],
] as const)(
  "adds a chosen product at once and announces it in %s",
  async (locale, prompt, announcement) => {
    setLocale(locale);
    try {
      const { el } = await mount();
      const combobox = await openPicker(el);
      expect(combobox.placeholder).toBe(prompt);
      expect(el.shadowRoot!.querySelector('[data-test="add-item"]')).toBeNull();

      const bacon = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (row) => row.textContent!.trim() === "Bacon",
      )!;
      bacon.click();
      await el.updateComplete;
      await combobox.updateComplete;

      expect(text(el, "item-0-product")).toBe("Bacon");
      expect(combobox.value).toBe("");
      expect(combobox.shadowRoot!.activeElement).toBe(
        combobox.shadowRoot!.querySelector("button.trigger"),
      );
      expect(text(el, "added-status")).toBe(announcement);
    } finally {
      setLocale("en");
      cleanupWidgets();
    }
  },
);

it("adds nothing when the picker closes without a choice", async () => {
  const { el } = await mount();
  const combobox = await openPicker(el);

  await userEvent.keyboard("{Escape}");
  await combobox.updateComplete;
  await el.updateComplete;

  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(0);
  expect(combobox.value).toBe("");
});

it("announces a product again when it is removed and re-added", async () => {
  const { el } = await mount();
  await addItem(el, "Bacon");
  expect(text(el, "added-status")).toBe("Bacon added.");

  await click(el, "remove-item-0");
  expect(text(el, "added-status")).toBe("");
  await addItem(el, "Bacon");
  expect(text(el, "added-status")).toBe("Bacon added.");
  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(1);
});

it("adds and announces nothing from a change received while busy", async () => {
  const { el } = await mount({ busy: true });
  picker(el).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: BACON }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(0);
  expect(text(el, "added-status")).toBe("");
});

it("leaves out of the picker every product a new list already holds", async () => {
  const { el } = await mount();

  await addItem(el, "Bacon");

  expect(picker(el).options).toEqual([{ value: EGG, label: "Fried egg" }]);
});

it("leaves out of the picker every product an edited list already holds", async () => {
  const { el } = await mount({ value: { ...addons, items: [addons.items[0]!] } });

  expect(picker(el).options).toEqual([{ value: EGG, label: "Fried egg" }]);
});

it("offers a removed row's product again", async () => {
  const { el } = await mount({ value: addons });

  await click(el, "remove-item-0");

  expect(picker(el).options).toEqual([{ value: BACON, label: "Bacon" }]);
  await addItem(el, "Bacon");
  expect(text(el, "item-1-product")).toBe("Bacon");
});

it("says every product is already on the list once none is left to add, in English and Spanish", async () => {
  const expected = {
    en: "Every product is already on the list.",
    es: "Todos los productos ya están en la lista.",
  };
  for (const locale of ["en", "es"] as const) {
    setLocale(locale);
    try {
      const { el } = await mount({ value: addons });
      const combobox = await openPicker(el);

      expect(combobox.options, locale).toEqual([]);
      expect(combobox.shadowRoot!.querySelector(".empty")!.textContent!.trim(), locale).toBe(
        expected[locale],
      );

      await click(el, "remove-item-1");
      expect(picker(el).noResultsLabel, locale).toBe(t("extras.no_products_found"));
    } finally {
      setLocale("en");
      cleanupWidgets();
    }
  }
});

it("keeps the no-match sentence when it was given no products at all", async () => {
  const { el } = await mount({ products: [] });

  expect(picker(el).noResultsLabel).toBe(t("extras.no_products_found"));
});

it("says no product matches when a search finds none while products are left to add", async () => {
  const { el } = await mount({ value: { ...addons, items: [addons.items[0]!] } });
  const combobox = await openPicker(el);

  await userEvent.type(combobox.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "zzz");
  await combobox.updateComplete;

  expect(combobox.shadowRoot!.querySelector(".empty")!.textContent!.trim()).toBe(
    t("extras.no_products_found"),
  );
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

it("sends one wt-cancel when the dialog reports its close after the form has been closed", async () => {
  const { el, host } = await mount({ value: addons });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);

  await click(el, "cancel");
  el.open = false;
  await el.updateComplete;
  await el.shadowRoot!.querySelector("wt-modal")!.updateComplete;
  await closeReportsDelivered();

  expect(cancels).toBe(1);
});

it("sends one wt-cancel when its dialog is dismissed with Escape while the form is open", async () => {
  const { el, host } = await mount({ value: addons });
  let cancels = 0;
  host.addEventListener("wt-cancel", () => cancels++);

  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(cancels).toBe(1));
  await closeReportsDelivered();

  expect(el.shadowRoot!.querySelector("wt-modal")!.open).toBe(false);
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

  el.value = baconTwice;
  await el.updateComplete;
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

it("puts each list-level refusal beside the input it names, and a switch's in the bottom message", async () => {
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
  expect(await bottomOf(el)).toBe(`Cannot be switched off. ${t("form.fix_fields")}`);
});

it("puts an item's price refusal beside that item's price, and its preselection's in the bottom message", async () => {
  const { el } = await mount({
    value: addons,
    fieldErrors: { "items.1.price": "Too cheap.", "items.0.preselected": "Not allowed here." },
  });

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-1-price").error).toBe("Too cheap.");
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-price").error).toBe("");
  expect(el.shadowRoot!.querySelector('[data-test="items-error"]')).toBeNull();
  expect(await bottomOf(el)).toBe(`Not allowed here. ${t("form.fix_fields")}`);
});

it.each([
  ["an item as a whole", "items.0"],
  ["an item field with no cell", "items.0.id"],
  ["an item the form does not hold", "items.7.price"],
  ["a list field with no input", "items"],
])("shows a refusal naming %s under the items table", async (_what, path) => {
  const { el } = await mount({ value: addons, fieldErrors: { [path]: "Something is wrong." } });

  expect(text(el, "items-error")).toBe("Something is wrong.");
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).disabled).toBe(false);
});

it("moves a rejected item's message under the items table once that item is removed", async () => {
  const { el } = await mount({ value: addons, fieldErrors: { "items.1.price": "Too cheap." } });
  expect(el.shadowRoot!.querySelector('[data-test="items-error"]')).toBeNull();

  await click(el, "remove-item-1");

  expect(text(el, "items-error")).toBe("Too cheap.");
  // Removing the item was the change to the field the refusal named, so nothing is left to fix.
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
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
  expect(errorOf(el, "name")).toBe(t("extras.name_required"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));

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

  expect(errorOf(el, "name")).toBe(t("extras.name_required"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  await type(el, "name", "Add-ons");
  await click(el, "save");
  expect(submitted[0]!.items.map((item) => item.id)).toEqual([EGG_ITEM, third.id]);
});

function disclosure(el: ExtraListForm): HTMLElementTagNameMap["wt-disclosure"] {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-disclosure"]>(
    '[data-test="names-section"]',
  )!;
}

it("folds the customer-facing names into a closed section that lists them", async () => {
  const { el } = await mount({
    value: { ...addons, customerName: { es: "Añádele algo" }, kitchenName: "ADD" },
  });
  const section = disclosure(el);

  expect(section.tagName).toBe("WT-DISCLOSURE");
  expect(section.open).toBe(false);
  expect(section.heading).toBe(t("extras.customer_names"));
  for (const name of ["customer-name-en", "customer-name-es"])
    expect(field(el, name).closest("wt-disclosure"), name).toBe(section);
  expect(field(el, "name").closest("wt-disclosure")).toBeNull();
  expect(section.summaryFields).toEqual([
    { label: "EN", value: "Add-ons", placeholder: true },
    { label: "ES", value: "Añádele algo" },
  ]);

  await type(el, "customer-name-en", "Make it yours");
  expect(section.summaryFields).toEqual([
    { label: "EN", value: "Make it yours" },
    { label: "ES", value: "Añádele algo" },
  ]);
});

it.each([
  ["customerName", true],
  ["kitchenName", false],
  ["name", false],
])("opens the names section when the server refuses %s: %s", async (path, opened) => {
  const { el } = await mount({ value: addons, fieldErrors: { [path]: "Refused." } });
  await disclosure(el).updateComplete;
  expect({ hasError: disclosure(el).hasError, open: disclosure(el).open }).toEqual({
    hasError: opened,
    open: opened,
  });
});

it("draws the kitchen name as its own field directly under Name, shown while the names section is closed", async () => {
  const { el } = await mount({ value: addons });
  const kitchen = field<HTMLElementTagNameMap["wt-input"]>(el, "kitchen-name");

  expect(disclosure(el).open).toBe(false);
  expect(kitchen.closest("wt-disclosure")).toBeNull();
  expect(field(el, "name").nextElementSibling).toBe(kitchen);
  expect(kitchen.checkVisibility()).toBe(true);
  expect(kitchen.value).toBe("ADD");
});

it.each([
  ["en", "Customer-facing names"],
  ["es", "Nombres para el cliente"],
])("heads the folded section with the customer-facing names alone (%s)", async (locale, words) => {
  setLocale(locale);
  try {
    const { el } = await mount({ value: addons });
    expect(disclosure(el).heading).toBe(words);
  } finally {
    setLocale("en");
  }
});

it("hints each blank name with what it falls back to, following the fields it copies as they are typed", async () => {
  const { el } = await mount({ value: { ...addons, customerName: {}, kitchenName: null } });
  const hints = () =>
    ["kitchen-name", "customer-name-en", "customer-name-es"].map(
      (name) => field<HTMLElementTagNameMap["wt-input"]>(el, name).placeholder,
    );

  expect(hints()).toEqual(["Add-ons", "Add-ons", "Add-ons"]);
  await type(el, "customer-name-en", "Make it yours");
  expect(hints()).toEqual(["Add-ons", "Add-ons", "Make it yours"]);
  await type(el, "name", "Toppings");
  expect(hints()).toEqual(["Toppings", "Toppings", "Make it yours"]);
  await type(el, "customer-name-en", "");
  expect(hints()).toEqual(["Toppings", "Toppings", "Toppings"]);
});

it("never hints a customer-facing name with the kitchen name, which keeps its own text", async () => {
  const { el } = await mount({ value: { ...addons, customerName: {} } });
  const input = (name: string) => field<HTMLElementTagNameMap["wt-input"]>(el, name);
  const hints = () =>
    ["customer-name-en", "customer-name-es"].map((name) => input(name).placeholder);

  expect(input("kitchen-name").value).toBe("ADD");
  expect(hints()).toEqual(["Add-ons", "Add-ons"]);
  await type(el, "customer-name-en", "Make it yours");
  expect(hints()).toEqual(["Add-ons", "Make it yours"]);
  await type(el, "kitchen-name", "EXTRAS");
  expect(input("kitchen-name").value).toBe("EXTRAS");
  expect(hints()).toEqual(["Add-ons", "Make it yours"]);
});

it("lists the customer-facing names in the closed section's line, but not the kitchen name", async () => {
  const { el } = await mount({ value: addons });

  expect(disclosure(el).summaryFields).toEqual([
    { label: "EN", value: "Make it yours" },
    { label: "ES", value: "Añádele algo" },
  ]);
});

it("draws each language's code in bold with a colon, before its name, on the closed line", async () => {
  const { el } = await mount({ value: addons });
  const section = disclosure(el);
  await section.updateComplete;
  const line = section.shadowRoot!.querySelector(".summary")!;
  expect(line.textContent!.replace(/\s+/g, " ").trim()).toBe(
    "EN: Make it yours · ES: Añádele algo",
  );
  const codes = [...line.querySelectorAll(".summary-label")];
  expect(codes.map((code) => code.textContent)).toEqual(["EN:", "ES:"]);
  const bold = Number(getComputedStyle(codes[0]!).fontWeight);
  expect(bold).toBeGreaterThan(Number(getComputedStyle(line).fontWeight));
  expect(Number(getComputedStyle(codes[1]!).fontWeight)).toBe(bold);
});

/** The closed line beside what each blank field hints: the two must name the same fallback. */
function namesShown(el: ExtraListForm) {
  const input = (locale: string) =>
    field<HTMLElementTagNameMap["wt-input"]>(el, `customer-name-${locale}`);
  return {
    line: disclosure(el).summaryFields,
    hints: el.languages.languages.map((locale) =>
      input(locale).value ? "" : input(locale).placeholder,
    ),
  };
}

it("shows the staff name, in italic, for every language on the closed line while each customer-facing name is blank", async () => {
  const { el, host } = await mount({ value: { ...addons, customerName: null } });
  const submitted = record(host);

  expect(namesShown(el)).toEqual({
    line: [
      { label: "EN", value: "Add-ons", placeholder: true },
      { label: "ES", value: "Add-ons", placeholder: true },
    ],
    hints: ["Add-ons", "Add-ons"],
  });
  const section = disclosure(el);
  await section.updateComplete;
  const placeholders = [...section.shadowRoot!.querySelectorAll(".summary-placeholder")];
  expect(placeholders.map((part) => part.textContent)).toEqual(["Add-ons", "Add-ons"]);
  expect(placeholders.map((part) => getComputedStyle(part).fontStyle)).toEqual([
    "italic",
    "italic",
  ]);

  await type(el, "name", "Toppings");
  expect(namesShown(el)).toEqual({
    line: [
      { label: "EN", value: "Toppings", placeholder: true },
      { label: "ES", value: "Toppings", placeholder: true },
    ],
    hints: ["Toppings", "Toppings"],
  });
  for (const locale of ["en", "es"])
    expect(field<HTMLElementTagNameMap["wt-input"]>(el, `customer-name-${locale}`).value).toBe("");
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.customerName).toBeNull();
});

it("falls every blank language back to the default language's name on the closed line, and back to the staff name when it is cleared", async () => {
  const { el, host } = await mount({ value: { ...addons, customerName: { en: "Make it yours" } } });
  const submitted = record(host);

  expect(namesShown(el)).toEqual({
    line: [
      { label: "EN", value: "Make it yours" },
      { label: "ES", value: "Make it yours", placeholder: true },
    ],
    hints: ["", "Make it yours"],
  });
  await click(el, "save");
  expect(submitted[0]!.customerName).toEqual({ en: "Make it yours" });

  await type(el, "customer-name-en", "");
  expect(namesShown(el)).toEqual({
    line: [
      { label: "EN", value: "Add-ons", placeholder: true },
      { label: "ES", value: "Add-ons", placeholder: true },
    ],
    hints: ["Add-ons", "Add-ons"],
  });
});

it("never falls a blank default language back to another language's name on the closed line", async () => {
  const { el, host } = await mount({ value: { ...addons, customerName: { es: "Añádele algo" } } });
  const submitted = record(host);

  expect(namesShown(el)).toEqual({
    line: [
      { label: "EN", value: "Add-ons", placeholder: true },
      { label: "ES", value: "Añádele algo" },
    ],
    hints: ["Add-ons", ""],
  });
  await click(el, "save");
  expect(submitted[0]!.customerName).toEqual({ es: "Añádele algo" });
});

it("follows a change of default or content languages on the closed line, in the languages' order", async () => {
  const { el } = await mount({ value: { ...addons, customerName: { es: "Añádele algo" } } });

  el.languages = { defaultLanguage: "es", languages: ["es", "en"] };
  await el.updateComplete;
  expect(namesShown(el)).toEqual({
    line: [
      { label: "ES", value: "Añádele algo" },
      { label: "EN", value: "Añádele algo", placeholder: true },
    ],
    hints: ["", "Añádele algo"],
  });

  el.languages = { defaultLanguage: "en", languages: ["en", "ca"] };
  await el.updateComplete;
  expect(namesShown(el)).toEqual({
    line: [
      { label: "EN", value: "Add-ons", placeholder: true },
      { label: "CA", value: "Add-ons", placeholder: true },
    ],
    hints: ["Add-ons", "Add-ons"],
  });
});

it("leaves a language out of the closed line while nothing at all names the list", async () => {
  const { el } = await mount();

  expect(disclosure(el).summaryFields).toEqual([]);
  await type(el, "customer-name-es", "Añádele algo");
  expect(disclosure(el).summaryFields).toEqual([{ label: "ES", value: "Añádele algo" }]);
  await type(el, "name", "Add-ons");
  expect(disclosure(el).summaryFields).toEqual([
    { label: "EN", value: "Add-ons", placeholder: true },
    { label: "ES", value: "Añádele algo" },
  ]);
});

it("shows a kitchen-name refusal under the kitchen field without marking the names section", async () => {
  const { el } = await mount({ value: addons, fieldErrors: { kitchenName: "Too long." } });
  await disclosure(el).updateComplete;

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "kitchen-name").error).toBe("Too long.");
  expect({ hasError: disclosure(el).hasError, open: disclosure(el).open }).toEqual({
    hasError: false,
    open: false,
  });
});

it("focuses the kitchen field when a refusal naming it arrives, leaving the names section closed", async () => {
  const { el } = await mount({ value: addons });
  el.fieldErrors = { kitchenName: "Too long." };
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));

  const kitchen = field<HTMLElement>(el, "kitchen-name");
  expect(disclosure(el).open).toBe(false);
  expect(kitchen.shadowRoot!.activeElement).toBe(kitchen.shadowRoot!.querySelector("input"));
});

it("puts the minimum and maximum choices side by side as clearable steppers from 1, each showing None while empty", async () => {
  const { el } = await mount({ value: addons });
  const row = el.shadowRoot!.querySelector('[data-test="picks-row"]')!;
  const min = field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "min-picks");
  const max = field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "max-picks");

  expect([min.tagName, max.tagName]).toEqual(["WT-NUMBER-STEPPER", "WT-NUMBER-STEPPER"]);
  expect([min.parentElement, max.parentElement]).toEqual([row, row]);
  expect([min.label, max.label]).toEqual([t("extras.min_picks"), t("extras.max_picks")]);
  expect([min.placeholder, max.placeholder]).toEqual([
    t("extras.picks_none"),
    t("extras.picks_none"),
  ]);
  expect([min.hint, max.hint]).toEqual(["", ""]);
  const maxInput = max.shadowRoot!.querySelector("input")!;
  expect(maxInput.value).toBe("2");
  expect(maxInput.hasAttribute("aria-describedby")).toBe(false);
  expect([min.min, max.min]).toEqual([1, 1]);
  expect([min.clearable, max.clearable]).toEqual([true, true]);
  expect(min.increaseLabel(min.label)).toBe(
    t("action.increase").replace("{label}", t("extras.min_picks")),
  );
  expect(max.decreaseLabel(max.label)).toBe(
    t("action.decrease").replace("{label}", t("extras.max_picks")),
  );
});

it("saves the minimum one higher after its + button is pressed", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);

  field(el, "min-picks").shadowRoot!.querySelector<HTMLButtonElement>('[data-step="1"]')!.click();
  await el.updateComplete;
  await click(el, "save");

  expect(submitted[0]!.minPicks).toBe(1);
});

it("sets the choices under a Number of choices heading, in English and Spanish, with no line under it", async () => {
  for (const [locale, heading] of [
    ["en", "Number of choices"],
    ["es", "Número de selecciones"],
  ] as const) {
    setLocale(locale);
    try {
      const { el } = await mount({ value: addons });
      const group = el.shadowRoot!.querySelector<HTMLFieldSetElement>(
        'fieldset[data-test="picks"]',
      )!;
      const legend = group.querySelector("legend")!;
      expect(legend.textContent!.trim(), locale).toBe(heading);
      expect(group.contains(el.shadowRoot!.querySelector('[data-test="picks-row"]'))).toBe(true);
      expect(group.querySelector("p")).toBeNull();
      expect(group.hasAttribute("aria-describedby")).toBe(false);
    } finally {
      setLocale("en");
      cleanupWidgets();
    }
  }
});

it("paints the choices heading from tokens", async () => {
  const { el, host } = await mount({ value: addons });
  host.style.setProperty("--wt-color-text-muted", "rgb(41, 42, 43)");
  host.style.setProperty("--wt-font-size-sm", "11px");
  host.style.setProperty("--wt-space-3", "13px");
  const group = el.shadowRoot!.querySelector('fieldset[data-test="picks"]')!;
  const legend = group.querySelector("legend")!;
  expect(getComputedStyle(legend).color).toBe("rgb(41, 42, 43)");
  expect(getComputedStyle(legend).fontSize).toBe("11px");
  expect(getComputedStyle(legend).marginBlockEnd).toBe("13px");
  expect(getComputedStyle(group).borderTopStyle).toBe("none");
});

it("leaves the product editor's group-heading gap between the choices heading and the boxes", async () => {
  const { el } = await mount({ value: addons });
  const group = el.shadowRoot!.querySelector('fieldset[data-test="picks"]')!;
  const legend = group.querySelector("legend")!;
  const row = el.shadowRoot!.querySelector('[data-test="picks-row"]')!;
  const space = parseFloat(getComputedStyle(group).getPropertyValue("--wt-space-3"));
  expect(space).toBeGreaterThan(0);
  const gap = row.getBoundingClientRect().top - legend.getBoundingClientRect().bottom;
  expect(gap).toBeCloseTo(space, 0);
});

it.each([
  [1280, "en", "None"],
  [1280, "es", "Ninguna"],
  [390, "en", "None"],
  [390, "es", "Ninguna"],
] as const)(
  "shows the whole None in both empty boxes at %ipx in %s",
  async (frame, locale, word) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(frame, 844);
    setLocale(locale);
    try {
      const { el } = await mount({ value: { ...addons, minPicks: 0, maxPicks: null } });
      for (const name of ["min-picks", "max-picks"]) {
        const input = field(el, name).shadowRoot!.querySelector("input")!;
        expect([input.value, input.placeholder], name).toEqual(["", word]);
        expect(input.matches(":placeholder-shown"), name).toBe(true);
        expect(input.hasAttribute("aria-describedby"), name).toBe(false);
        expect(field(el, name).shadowRoot!.querySelector("[data-hint]"), name).toBeNull();
        const style = getComputedStyle(input);
        const probe = document.createElement("span");
        probe.style.font = style.font;
        probe.style.position = "absolute";
        probe.style.whiteSpace = "pre";
        probe.textContent = input.placeholder;
        document.body.append(probe);
        const needed = probe.getBoundingClientRect().width;
        probe.remove();
        const room =
          input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        expect(needed, `${name} at ${frame}px in ${locale}`).toBeLessThanOrEqual(room);
      }
    } finally {
      setLocale("en");
      await page.viewport(width, height);
    }
  },
);

it("shows a saved minimum of 0 as the empty box, and saves it back as 0", async () => {
  const { el, host } = await mount({ value: { ...addons, minPicks: 0 } });
  const submitted = record(host);
  const min = field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "min-picks");
  expect(min.value).toBe("");
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.minPicks).toBe(0);
});

it("starts a new list with an empty minimum", async () => {
  const { el } = await mount();
  expect(field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "min-picks").value).toBe("");
});

it("clears a minimum of 1 with its − button, and saves the list with a minimum of 0", async () => {
  const { el, host } = await mount({ value: { ...addons, minPicks: 1, maxPicks: 2 } });
  const submitted = record(host);
  const min = field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "min-picks");

  min.shadowRoot!.querySelector<HTMLButtonElement>('[data-step="-1"]')!.click();
  await el.updateComplete;
  await min.updateComplete;
  expect(min.value).toBe("");
  await click(el, "save");

  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.minPicks).toBe(0);
});

it("saves an empty minimum with a maximum of 1", async () => {
  const { el, host } = await mount({ value: { ...addons, minPicks: 0, maxPicks: 1 } });
  const submitted = record(host);
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect([submitted[0]!.minPicks, submitted[0]!.maxPicks]).toEqual([0, 1]);
});

it("keeps a typed minimum of 0 as typed, and saves it as 0", async () => {
  const { el, host } = await mount({ value: { ...addons, minPicks: 1 } });
  const submitted = record(host);
  await type(el, "min-picks", "0");
  expect(field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "min-picks").value).toBe("0");
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.minPicks).toBe(0);
});

it("refuses a typed maximum of 0 beside the field and in the bottom message", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);

  await type(el, "max-picks", "0");
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(errorOf(el, "max-picks")).toBe(t("extras.max_picks_zero"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(t("extras.max_picks_zero")).toBe("Enter 1 or more, or leave it empty for no limit.");
});

it("clears a maximum of 1 with its − button, and saves the list with no limit", async () => {
  const { el, host } = await mount({ value: { ...addons, maxPicks: 1 } });
  const submitted = record(host);
  const max = field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "max-picks");

  max.shadowRoot!.querySelector<HTMLButtonElement>('[data-step="-1"]')!.click();
  await el.updateComplete;
  await max.updateComplete;
  expect(max.value).toBe("");
  expect(max.shadowRoot!.querySelector("input")!.value).toBe("");
  await click(el, "save");

  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.maxPicks).toBeNull();
});

it("gives the maximum the standard stepper width, not a wider one of its own", async () => {
  const { el } = await mount({ value: addons });
  const root = getComputedStyle(el).getPropertyValue("--wt-stepper-field-width").trim();
  for (const name of ["min-picks", "max-picks"]) {
    expect(
      getComputedStyle(field(el, name)).getPropertyValue("--wt-stepper-field-width").trim(),
      name,
    ).toBe(root);
  }
  expect(root).toBe("88px");
});

it("sets Maximum choices just after Minimum choices on a wide screen, not at the far side of the form", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(1280, 844);
  try {
    const { el, host } = await mount({ value: addons });
    host.style.setProperty("--wt-space-3", "12px");
    const boxOf = (name: string) =>
      field(el, name).shadowRoot!.querySelector(".field")!.getBoundingClientRect();
    const min = boxOf("min-picks");
    const max = boxOf("max-picks");
    expect(max.top).toBe(min.top);
    expect(max.left - min.right).toBe(12);
  } finally {
    await page.viewport(width, height);
  }
});

it.each([
  [390, "es"],
  [640, "es"],
  [640, "en"],
  [1280, "es"],
] as const)(
  "keeps both choices' refusals inside the choices row at %ipx in %s",
  async (frame, locale) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(frame, 844);
    setLocale(locale);
    try {
      const { el } = await mount({ value: addons });
      await type(el, "min-picks", "-1");
      await type(el, "max-picks", "-1");
      await click(el, "save");
      const row = el.shadowRoot!.querySelector('[data-test="picks-row"]')!.getBoundingClientRect();
      for (const name of ["min-picks", "max-picks"]) {
        const stepper = field<HTMLElementTagNameMap["wt-number-stepper"]>(el, name);
        await stepper.updateComplete;
        const message = stepper.shadowRoot!.querySelector<HTMLElement>("[data-error]")!;
        expect(message.textContent, name).toBe(t("extras.picks_invalid"));
        const at = `${name} at ${frame}px in ${locale}`;
        expect(stepper.getBoundingClientRect().right, at).toBeLessThanOrEqual(row.right + 0.5);
        expect(message.getBoundingClientRect().right, at).toBeLessThanOrEqual(row.right + 0.5);
        expect(message.scrollWidth, at).toBeLessThanOrEqual(message.clientWidth);
      }
    } finally {
      setLocale("en");
      await page.viewport(width, height);
    }
  },
);

it("stacks the two choices steppers on a phone and sets them side by side on a wide screen", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  try {
    for (const [w, sideBySide] of [
      [1280, true],
      [390, false],
    ] as const) {
      await page.viewport(w, 844);
      expect(window.innerWidth).toBe(w);
      const { el } = await mount({ value: addons });
      const min = field(el, "min-picks").getBoundingClientRect();
      const max = field(el, "max-picks").getBoundingClientRect();
      expect(sideBySide ? max.top === min.top : max.top >= min.bottom, `at ${w}px`).toBe(true);
      cleanupWidgets();
    }
  } finally {
    await page.viewport(width, height);
  }
});

it.each([
  [1280, "en"],
  [1280, "es"],
  [390, "en"],
  [390, "es"],
] as const)("keeps extras controls beside the product at %ipx in %s", async (frame, locale) => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  await page.viewport(frame, 844);
  setLocale(locale);
  try {
    const { el } = await mount({ value: addons, products });
    const cells = el
      .shadowRoot!.querySelector(`tr[data-item="${BACON_ITEM}"]`)!
      .querySelectorAll("td");
    const handle = cells[0]!.querySelector<HTMLElement>("[data-test^=drag-]")!;
    const preselected = cells[3]!.querySelector("wt-switch")!;
    const remove = cells[6]!.querySelector("wt-button")!;
    expect(cells[0]!.getBoundingClientRect().width).toBeLessThanOrEqual(
      handle.getBoundingClientRect().width + 2,
    );
    expect(cells[1]!.getBoundingClientRect().width).toBeGreaterThan(
      cells[0]!.getBoundingClientRect().width,
    );
    expect(cells[3]!.getBoundingClientRect().width, "Preselected column").toBeLessThanOrEqual(
      preselected.getBoundingClientRect().width + 8,
    );
    expect(cells[6]!.getBoundingClientRect().width, "remove column").toBeLessThanOrEqual(
      remove.getBoundingClientRect().width + 2,
    );
  } finally {
    setLocale("en");
    await page.viewport(width, height);
  }
});

it.each([
  [1280, "en"],
  [1280, "es"],
  [390, "en"],
  [390, "es"],
] as const)(
  "keeps an empty extras table's Preselected heading readable at %ipx in %s",
  async (frame, locale) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(frame, 844);
    setLocale(locale);
    try {
      const { el } = await mount({ value: { ...addons, items: [] } });
      const heading = el.shadowRoot!.querySelectorAll("thead th")[3]!;
      const range = document.createRange();
      range.selectNodeContents(heading);
      expect(range.getClientRects().length, `${frame}px in ${locale}`).toBeLessThanOrEqual(2);
      const text = range.getBoundingClientRect();
      const table = el.shadowRoot!.querySelector("table")!.getBoundingClientRect();
      expect(text.left, `${frame}px in ${locale}`).toBeGreaterThanOrEqual(table.left);
      expect(text.right, `${frame}px in ${locale}`).toBeLessThanOrEqual(table.right);
      const quantity = el
        .shadowRoot!.querySelectorAll("thead th")[2]!
        .querySelector(".quantity-heading")!;
      expect(text.left, `after Maximum quantity at ${frame}px in ${locale}`).toBeGreaterThanOrEqual(
        quantity.getBoundingClientRect().right,
      );
    } finally {
      setLocale("en");
      await page.viewport(width, height);
    }
  },
);

it.each([
  [1280, "en"],
  [1280, "es"],
  [390, "en"],
  [390, "es"],
] as const)(
  "keeps extras columns in place when a longer product is added at %ipx in %s",
  async (frame, locale) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(frame, 844);
    setLocale(locale);
    try {
      const longer = "Croquetas caseras con jamón y queso";
      const { el } = await mount({
        value: { ...addons, items: [addons.items[0]!] },
        products: [products[0]!, product({ ...products[1]!, name: longer })],
      });
      const starts = () =>
        [...el.shadowRoot!.querySelectorAll("thead th")]
          .slice(2)
          .map((heading) => heading.getBoundingClientRect().left);
      const before = starts();
      await addItem(el, longer);
      const after = starts();
      for (let index = 0; index < before.length; index++) {
        expect(after[index], `column ${index + 3} at ${frame}px in ${locale}`).toBeCloseTo(
          before[index]!,
          0,
        );
      }
    } finally {
      setLocale("en");
      await page.viewport(width, height);
    }
  },
);

it.each([1280, 390])("wraps an unbroken product name inside its cell at %ipx", async (frame) => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  await page.viewport(frame, 844);
  try {
    const { el } = await mount({
      value: { ...addons, items: [addons.items[0]!] },
      products: [product({ name: "Supercalifragilisticexpialidociouscroquetas" })],
    });
    const productCell = el.shadowRoot!.querySelector(
      `tr[data-item="${BACON_ITEM}"] td:nth-child(2)`,
    ) as HTMLElement;
    expect(productCell.scrollWidth, `${frame}px`).toBeLessThanOrEqual(productCell.clientWidth);
  } finally {
    await page.viewport(width, height);
  }
});

it("refuses a maximum quantity of 0 TYPED into its stepper", async () => {
  const { el, host } = await mount({ value: addons });
  const submitted = record(host);
  const stepper = field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "item-1-max-quantity");
  expect(stepper.tagName).toBe("WT-NUMBER-STEPPER");
  expect(stepper.min).toBe(1);
  expect(stepper.hideLabel).toBe(true);

  const input = stepper.shadowRoot!.querySelector("input")!;
  input.value = "0";
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  await el.updateComplete;
  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(stepper.error).toBe(t("extras.quantity_invalid"));
});

const KG = {
  id: "unit-kg",
  name: { en: "Kilogram", es: "Kilogramo" },
  precision: 3,
  abbreviation: { en: "kg", es: "kilo" },
};

it("requires a weighed extra portion and hints the price for that portion", async () => {
  const { el, host } = await mount({
    products: [product({ unitId: KG.id, unit: KG, unitPrice: "100.00" })],
  });
  const submitted = record(host);
  await type(el, "name", "Extras");
  await addItem(el, "Bacon");

  const portion = field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-portion");
  expect(portion).not.toBeNull();
  expect(field<HTMLElementTagNameMap["wt-price-input"]>(el, "item-0-price").placeholder).toBe("");
  await click(el, "save");
  expect(submitted).toHaveLength(0);
  expect(portion.error).toBe(t("extras.portion_required"));

  await type(el, "item-0-portion", "0.050");
  expect(field<HTMLElementTagNameMap["wt-price-input"]>(el, "item-0-price").placeholder).toBe(
    "5.00",
  );
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.items[0]!.portion).toBe("0.050");
});

it("keeps an unchanged saved portion after its unit loses precision", async () => {
  const { el, host } = await mount({
    value: {
      ...addons,
      items: [{ ...addons.items[0]!, portion: "0.055" }],
    },
    products: [product({ unitId: KG.id, unit: { ...KG, precision: 2 } })],
  });
  const submitted = record(host);

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-portion").value).toBe("0.055");
  expect(text(el, "item-0-portion-warning")).toContain("0.055");
  await type(el, "name", "Updated extras");
  await click(el, "save");
  expect(submitted[0]!.items[0]!.portion).toBe("0.055");

  await type(el, "item-0-portion", "0.056");
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-portion").error).toBe(
    t("extras.portion_invalid"),
  );

  await type(el, "item-0-portion", "0.06");
  await click(el, "save");
  expect(submitted[1]!.items[0]!.portion).toBe("0.06");
});

it("marks malformed portion input beside its field without crashing the form", async () => {
  const { el, host } = await mount({
    products: [product({ unitId: KG.id, unit: KG, unitPrice: "100.00" })],
  });
  const submitted = record(host);
  await type(el, "name", "Extras");
  await addItem(el, "Bacon");
  await type(el, "item-0-portion", "nope");
  await click(el, "save");
  expect(submitted).toHaveLength(0);
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-portion").error).toBe(
    t("extras.portion_invalid"),
  );
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
});
const PORTION = {
  id: "unit-portion",
  name: { en: "Portion", es: "Ración" },
  precision: 0,
  abbreviation: {},
};

it("shows each price with its own product's unit, as text, abbreviated where it can be", async () => {
  const { el } = await mount({
    value: addons,
    products: [
      product({ unitId: KG.id, unit: KG }),
      product({ id: EGG, name: "Fried egg", unitPrice: "0.80", unitId: PORTION.id, unit: PORTION }),
    ],
  });
  const first = field<HTMLElementTagNameMap["wt-price-input"]>(el, "item-0-price");
  const second = field<HTMLElementTagNameMap["wt-price-input"]>(el, "item-1-price");

  expect([first.tagName, first.unit, second.unit]).toEqual(["WT-PRICE-INPUT", "kg", "Portion"]);
  expect([first.fixedUnit, first.hideLabel, first.label]).toEqual([true, true, t("extras.price")]);
  expect(first.shadowRoot!.querySelector("button")).toBeNull();
});

it("reads a unit in the FIRST content language", async () => {
  const { el } = await mount({
    value: addons,
    languages: { defaultLanguage: "en", languages: ["es", "en"] },
    products: [
      product({ unitId: KG.id, unit: KG }),
      product({ id: EGG, name: "Fried egg", unitPrice: "0.80", unitId: PORTION.id, unit: PORTION }),
    ],
  });
  expect(field<HTMLElementTagNameMap["wt-price-input"]>(el, "item-0-price").unit).toBe("kilo");
  expect(field<HTMLElementTagNameMap["wt-price-input"]>(el, "item-1-price").unit).toBe("Ración");
});

it("removes a product with an icon-only bin button that keeps its spoken name", async () => {
  const { el } = await mount({ value: addons });
  const remove = el.shadowRoot!.querySelector<HTMLElement>('[data-test="remove-item-1"]')!;

  expect(remove.getAttribute("aria-label")).toBe(`${t("extras.remove_item")}: Fried egg`);
  expect(remove.getAttribute("variant")).toBe("ghost");
  expect(remove.querySelector("wt-icon")!.getAttribute("name")).toBe("bin");
  expect(remove.textContent!.trim()).toBe("");
});

it("heads the price over the bin column too, with no heading of the bin's own", async () => {
  const { el } = await mount({ value: addons });
  const headings = [...el.shadowRoot!.querySelectorAll("thead th")];
  const rowCells = el.shadowRoot!.querySelector("tbody tr")!.children.length;

  expect(headings.at(-1)!.textContent!.trim()).toBe(t("extras.price"));
  expect(headings.at(-1)!.getAttribute("colspan")).toBe("2");
  expect(headings.reduce((sum, th) => sum + Number(th.getAttribute("colspan") ?? 1), 0)).toBe(
    rowCells,
  );
});

/** A zero-size inline-block's bottom edge is its baseline, so where one lands says where the text
 * line it joined has its baseline. */
function probe(): HTMLElement {
  const mark = document.createElement("span");
  mark.style.cssText = "display: inline-block; width: 0; height: 0; vertical-align: baseline";
  return mark;
}

function textBaseline(parent: Element): number {
  const mark = probe();
  parent.append(mark);
  const top = mark.getBoundingClientRect().top;
  mark.remove();
  return top;
}

/** An `<input>` takes no children, so the mark joins the input's own baseline group in the flex or
 * grid box around it instead, placed straight after the input so it shares the input's line when a
 * unit has wrapped under it. The input is set to baseline alignment for the reading, and the
 * reading is refused if that moved it. */
function inputBaseline(control: Element): number {
  const input = control.shadowRoot!.querySelector("input")!;
  const before = input.getBoundingClientRect();
  const mark = probe();
  mark.style.alignSelf = "baseline";
  mark.style.gridRow = "1";
  mark.style.gridColumn = getComputedStyle(input.parentElement!).display.includes("grid")
    ? "2"
    : "auto";
  const alignSelf = input.style.alignSelf;
  input.style.alignSelf = "baseline";
  input.after(mark);
  const top = mark.getBoundingClientRect().top;
  const after = input.getBoundingClientRect();
  mark.remove();
  input.style.alignSelf = alignSelf;
  expect({ top: after.top, height: after.height }).toEqual({
    top: before.top,
    height: before.height,
  });
  return top;
}

it.each([1280, 390])("lines up the text baselines across a product row at %ipx", async (frame) => {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(frame, 844);
  try {
    const { el } = await mount({ value: addons });
    const row = el.shadowRoot!.querySelector(`tr[data-item="${BACON_ITEM}"]`)!;
    const name = textBaseline(row.querySelector('[data-test="item-0-product"]')!);
    const quantity = inputBaseline(row.querySelector("wt-number-stepper")!);
    const price = inputBaseline(row.querySelector("wt-price-input")!);
    expect(window.innerWidth).toBe(frame);
    expect(Math.abs(quantity - name), "quantity").toBeLessThanOrEqual(1);
    expect(Math.abs(price - name), "price").toBeLessThanOrEqual(1);
  } finally {
    await page.viewport(width, height);
  }
});

it("drops each row's Preselected text, where the column heading names it", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  try {
    for (const frame of [1280, 390] as const) {
      await page.viewport(frame, 844);
      expect(window.innerWidth).toBe(frame);
      const { el } = await mount({ value: addons });
      const toggle = field(el, "item-0-preselected");
      expect(toggle.shadowRoot!.querySelector("label"), `at ${frame}px`).toBeNull();
      expect(toggle.shadowRoot!.querySelector("input")!.getAttribute("aria-label")).toBe(
        t("extras.preselected"),
      );
      cleanupWidgets();
    }
  } finally {
    await page.viewport(width, height);
  }
});

it.each([1280, 390])(
  "names a Preselected switch without drawing its repeated label at %ipx",
  async (frame) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    await page.viewport(frame, 844);
    try {
      const { el } = await mount({ value: addons });
      const toggle = field<HTMLElementTagNameMap["wt-switch"]>(el, "item-0-preselected");
      expect(toggle.shadowRoot!.querySelector("label")).toBeNull();
      expect(toggle.shadowRoot!.querySelector("input")!.getAttribute("aria-label")).toBe(
        t("extras.preselected"),
      );
    } finally {
      await page.viewport(width, height);
    }
  },
);

it("on a phone the price's unit moves under the amount and keeps its inset in the field box", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(390, 844);
  try {
    const { el } = await mount({
      value: addons,
      products: [
        product({ unitId: PORTION.id, unit: PORTION }),
        product({
          id: EGG,
          name: "Fried egg",
          unitPrice: "0.80",
          unitId: PORTION.id,
          unit: PORTION,
        }),
      ],
    });
    const root = field(el, "item-0-price").shadowRoot!;
    const box = root.querySelector(".field")!.getBoundingClientRect();
    const amount = root.querySelector("input")!.getBoundingClientRect();
    const unit = root.querySelector('[part="unit"]')!;
    const text = document.createRange();
    text.selectNodeContents(unit);
    const drawn = text.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(unit).getPropertyValue("--wt-space-2"));
    expect(window.innerWidth).toBe(390);
    expect(inset).toBeGreaterThan(0);
    expect(drawn.top, "under the amount").toBeGreaterThanOrEqual(amount.bottom);
    expect(drawn.left - box.left, "start inset").toBeGreaterThanOrEqual(inset);
    expect(box.bottom - drawn.bottom, "bottom inset").toBeGreaterThanOrEqual(inset);
  } finally {
    await page.viewport(width, height);
  }
});

it("draws every row's price box the same width, whatever its unit", async () => {
  const { el } = await mount({
    value: addons,
    products: [
      product({ unitId: KG.id, unit: KG }),
      product({ id: EGG, name: "Fried egg", unitPrice: "0.80", unitId: PORTION.id, unit: PORTION }),
    ],
  });
  const box = (name: string) =>
    field(el, name).shadowRoot!.querySelector("input")!.getBoundingClientRect().width;
  expect(box("item-0-price")).toBe(box("item-1-price"));
});

it("reads a product with no unit as sold by the each, as the product editor does", async () => {
  const unknown = "cccccccc-3333-4333-8333-cccccccccccc";
  const { el } = await mount({
    value: {
      ...addons,
      items: [
        ...addons.items,
        {
          id: "55555555-5555-4555-8555-555555555555",
          productId: unknown,
          maxQuantity: 1,
          preselected: false,
          price: "1.00",
        },
      ],
    },
    products: [
      product({ unitId: undefined, unit: undefined }),
      product({ id: EGG, name: "Fried egg", unitPrice: "0.80", unitId: KG.id, unit: KG }),
    ],
  });
  const unit = (name: string) => field<HTMLElementTagNameMap["wt-price-input"]>(el, name).unit;

  expect(unit("item-0-price")).toBe(t("editor.unit_each"));
  expect(unit("item-1-price")).toBe("kg");
  // A product this form was given no row for has no known unit, so it claims none.
  expect(unit("item-2-price")).toBe("");
});

it("marks Maximum quantity as optional when an item can have no limit", async () => {
  const { el } = await mount({ value: addons });
  const heading = [...el.shadowRoot!.querySelectorAll("thead th")][2]!;
  const marker = heading.querySelector<HTMLElement>("[data-required]");

  expect(marker).toBeNull();
  expect(heading.textContent!.trim()).toBe(t("extras.max_quantity"));
  expect(
    field<HTMLElementTagNameMap["wt-number-stepper"]>(el, "item-0-max-quantity").required,
  ).toBe(false);
});

const GRAM = {
  id: "unit-g",
  name: { en: "Gram", es: "Gramo" },
  precision: 0,
  abbreviation: { en: "g", es: "g" },
};
const LONG_ABBREVIATION = {
  id: "unit-kilos",
  name: { en: "Kilogram", es: "Kilogramo" },
  precision: 3,
  abbreviation: { en: "kilogramos", es: "kilogramos" },
};
const ONE_LONG_WORD = {
  id: "unit-pack",
  name: { en: "Packing unit", es: "Unidad de embalaje" },
  precision: 0,
  abbreviation: { en: "Unidadesdeembalaje", es: "Unidadesdeembalaje" },
};
const LONG_NAME = {
  id: "unit-half",
  name: { en: "Large half portion", es: "Media ración grande" },
  precision: 0,
  abbreviation: {},
};

/** How far the items table scrolls sideways with two four-digit prices in `unit`, and whether any
 * price's digits are cut off. */
async function phoneOverflow(unit: Product["unit"]) {
  const { el } = await mount({
    value: {
      ...addons,
      items: addons.items.map((item) => ({ ...item, price: "9999.99" })),
    },
    products: products.map((each) => ({ ...each, unitId: unit!.id, unit })),
  });
  const wrap = el.shadowRoot!.querySelector<HTMLElement>(".table-wrap")!;
  const clipped = ["item-0-price", "item-1-price"].some((name) => {
    const input = field(el, name).shadowRoot!.querySelector("input")!;
    return input.scrollWidth > input.clientWidth;
  });
  const overflow = wrap.querySelector("table")!.scrollWidth - wrap.clientWidth;
  cleanupWidgets();
  return { overflow, clipped };
}

it("keeps a long unit from widening the table on a phone, in English and Spanish", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(390, 844);
  try {
    expect(window.innerWidth).toBe(390);
    for (const locale of ["en", "es"] as const) {
      setLocale(locale);
      const short = await phoneOverflow(GRAM);
      expect(short.overflow, locale).toBeGreaterThan(0);
      for (const unit of [LONG_ABBREVIATION, ONE_LONG_WORD, LONG_NAME]) {
        const long = await phoneOverflow(unit);
        expect(long.clipped, `${locale} ${unit.id}`).toBe(false);
        expect(long.overflow, `${locale} ${unit.id}`).toBeLessThanOrEqual(short.overflow);
      }
    }
  } finally {
    setLocale("en");
    await page.viewport(width, height);
  }
});

it("draws the euro sign in each item's price where the language writes it, on a wide screen and a phone", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  try {
    for (const [locale, side] of [
      ["en-GB", "before"],
      ["es-ES", "after"],
    ] as const)
      for (const frame of [1280, 390]) {
        setLocale(locale);
        await page.viewport(frame, 844);
        const { el } = await mount({
          value: {
            ...addons,
            items: addons.items.map((item) => ({ ...item, price: "9999.99" })),
          },
        });
        // The field measures its sign after layout, and pads the amount clear of it then.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const at = `${locale} at ${frame}px`;
        const price = field<HTMLElement & { locale: string }>(el, "item-0-price");
        expect(price.locale, at).toBe(locale);
        const sign = price.shadowRoot!.querySelector<HTMLElement>('[part~="currency"]')!;
        expect(sign.textContent, at).toBe("€");
        const input = price.shadowRoot!.querySelector("input")!;
        const box = input.getBoundingClientRect();
        const signBox = sign.getBoundingClientRect();
        // Inside the amount box, on its side, and never over the typed amount.
        expect(signBox.left, at).toBeGreaterThanOrEqual(box.left);
        expect(signBox.right, at).toBeLessThanOrEqual(box.right);
        const middle = (box.left + box.right) / 2;
        if (side === "before") expect(signBox.right, at).toBeLessThan(middle);
        else expect(signBox.left, at).toBeGreaterThan(middle);
        expect(input.scrollWidth, `${at}: the amount is cut off`).toBeLessThanOrEqual(
          input.clientWidth,
        );
        cleanupWidgets();
      }
  } finally {
    setLocale("en");
    await page.viewport(width, height);
  }
});

it("puts the unit under the amount on a phone and beside it on a wide screen", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  try {
    for (const [frame, under] of [
      [1280, false],
      [390, true],
    ] as const) {
      await page.viewport(frame, 844);
      expect(window.innerWidth).toBe(frame);
      const { el } = await mount({
        value: addons,
        products: [product({ unitId: KG.id, unit: KG }), products[1]!],
      });
      const price = field(el, "item-0-price").shadowRoot!;
      const input = price.querySelector("input")!.getBoundingClientRect();
      const unit = price.querySelector(".unit")!.getBoundingClientRect();
      expect(
        under
          ? unit.top >= input.bottom && unit.left === input.left
          : unit.top === input.top && unit.left === input.right,
        `at ${frame}px: ${JSON.stringify({ input, unit })}`,
      ).toBe(true);
      cleanupWidgets();
    }
  } finally {
    await page.viewport(width, height);
  }
});

it("keeps a price's baseline on its amount when the unit sits under it on a phone", async () => {
  const width = window.innerWidth,
    height = window.innerHeight;
  await page.viewport(390, 844);
  try {
    const { el } = await mount({
      value: addons,
      products: [product({ unitId: LONG_NAME.id, unit: LONG_NAME }), products[1]!],
    });
    const row = el.shadowRoot!.querySelector(`tr[data-item="${BACON_ITEM}"]`)!;
    const name = textBaseline(row.querySelector('[data-test="item-0-product"]')!);
    const price = row.querySelector("wt-price-input")!;
    const input = price.shadowRoot!.querySelector("input")!.getBoundingClientRect();

    expect(window.innerWidth).toBe(390);
    expect(
      price.shadowRoot!.querySelector(".unit")!.getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(input.bottom);
    expect(Math.abs(inputBaseline(price) - name)).toBeLessThanOrEqual(1);
  } finally {
    await page.viewport(width, height);
  }
});

// ---------------------------------------------------------------------------
// When it speaks about errors

it("says nothing about errors before the first submission, and Save works", async () => {
  const { el } = await mount({ value: addons });
  await type(el, "name", "");
  await type(el, "item-0-price", "007");

  expect(errorOf(el, "name")).toBe("");
  expect(errorOf(el, "item-0-price")).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("on an invalid submission focuses the first invalid field, keeps what was typed and disables Save", async () => {
  const { el } = await mount({ value: addons });
  await type(el, "kitchen-name", "ADDS");
  await type(el, "item-1-price", "007");
  await click(el, "save");
  await new Promise((resolve) => setTimeout(resolve));

  const price = field<HTMLElement>(el, "item-1-price");
  expect(price.shadowRoot!.activeElement).toBe(price.shadowRoot!.querySelector("input"));
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "kitchen-name").value).toBe("ADDS");
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);
});

it("focuses the items table when the items are all that is wrong", async () => {
  const { el } = await mount();
  await type(el, "name", "Add-ons");
  await click(el, "save");
  await new Promise((resolve) => setTimeout(resolve));

  expect(el.shadowRoot!.activeElement).toBe(el.shadowRoot!.querySelector(".table-wrap"));
});

it("re-checks every change after a failed submission, and Save works again once all are fixed", async () => {
  const { el } = await mount({ value: addons });
  await type(el, "name", " ");
  await type(el, "item-0-price", "007");
  await click(el, "save");

  await type(el, "name", "Add-ons");
  expect(errorOf(el, "name")).toBe("");
  expect(errorOf(el, "item-0-price")).toBe(t("extras.price_invalid"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);

  await type(el, "name", "");
  expect(errorOf(el, "name")).toBe(t("extras.name_required"));

  await type(el, "name", "Add-ons");
  await type(el, "item-0-price", "0.70");
  expect(errorOf(el, "item-0-price")).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("keeps a field's refusal until that field changes, with Save working throughout", async () => {
  const { el } = await mount({ value: addons, fieldErrors: { "items.1.price": "Too cheap." } });
  expect(saveOf(el).disabled).toBe(false);

  await type(el, "item-0-price", "0.90");
  expect(errorOf(el, "item-1-price")).toBe("Too cheap.");
  expect(saveOf(el).disabled).toBe(false);

  await type(el, "item-1-price", "1.20");
  expect(errorOf(el, "item-1-price")).toBe("");
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("clears a translated name's refusal only when that language's value changes", async () => {
  const { el } = await mount({
    value: addons,
    fieldErrors: { customerName: "Rejected English." },
  });

  await type(el, "customer-name-es", "Ponle algo");
  expect(errorOf(el, "customer-name-en")).toBe("Rejected English.");
  expect(saveOf(el).disabled).toBe(false);

  await type(el, "customer-name-en", "Add something");
  expect(errorOf(el, "customer-name-en")).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("clears a refusal about the items as a whole once the items change", async () => {
  const { el } = await mount({ value: addons, fieldErrors: { items: "Something is wrong." } });
  expect(saveOf(el).disabled).toBe(false);

  await toggle(el, "item-0-preselected", true);

  expect(el.shadowRoot!.querySelector('[data-test="items-error"]')).toBeNull();
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

it("focuses the field a refusal names when the refusal arrives, opening its folded section", async () => {
  const { el } = await mount({ value: addons });
  el.fieldErrors = { customerName: "Too long." };
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve));

  const customer = field<HTMLElement>(el, "customer-name-en");
  expect(disclosure(el).open).toBe(true);
  expect(customer.shadowRoot!.activeElement).toBe(customer.shadowRoot!.querySelector("input"));
});

it("keeps a refusal naming no field in the bottom message alone, leaving Save working until it is submitted again", async () => {
  const { el, host } = await mount({ value: addons, fieldErrors: { _form: "Not found." } });
  const submitted = record(host);

  expect(await bottomOf(el)).toBe("Not found.");
  expect(el.shadowRoot!.querySelector('[data-test="items-error"]')).toBeNull();
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);

  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(await bottomOf(el)).toBe("");
});

it("starts again when reopened: no messages and Save working", async () => {
  const { el } = await mount();
  await click(el, "save");
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);

  el.open = false;
  await el.updateComplete;
  el.open = true;
  await el.updateComplete;

  expect(errorOf(el, "name")).toBe("");
  expect(el.shadowRoot!.querySelector('[data-test="items-error"]')).toBeNull();
  expect(await bottomOf(el)).toBe("");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
});

const WINE = "cccccccc-3333-4333-8333-cccccccccccc";
const CIDER = "dddddddd-4444-4444-8444-dddddddddddd";

function variant(name: string, flags: { active: boolean; available: boolean }) {
  return {
    id: crypto.randomUUID(),
    name,
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice: null,
    ...flags,
    effective: { unitPrice: "4.00", vatClass: "general" as const, primaryCategoryId: null },
  };
}

/** Wine's only Active variant is Unavailable, which the server still refuses
 * (`assertNoParentsWithVariants`, packages/catalogue/src/extras.ts); cider's only variant is
 * Inactive, which it accepts. */
const withVariants: Product[] = [
  ...products,
  product({
    id: WINE,
    name: "Wine",
    customerName: { es: "Vino de la casa" },
    kitchenName: "WINE",
    variants: [variant("Glass", { active: true, available: false })],
  }),
  product({
    id: CIDER,
    name: "Cider",
    customerName: { es: "Sidra" },
    kitchenName: "CIDER",
    variants: [variant("Bottle", { active: false, available: true })],
  }),
];

it("offers a product with an Active variant greyed, saying why on its second line, in English and Spanish", async () => {
  const expected = {
    en: "Has variants, so it can't be an extra",
    es: "Tiene variantes, así que no puede ser un extra",
  };
  for (const locale of ["en", "es"] as const) {
    setLocale(locale);
    try {
      const { el } = await mount({ products: withVariants });
      expect(picker(el).options, locale).toEqual([
        { value: BACON, label: "Bacon" },
        { value: EGG, label: "Fried egg" },
        { value: WINE, label: "Wine", disabled: true, description: expected[locale] },
        { value: CIDER, label: "Cider" },
      ]);
    } finally {
      setLocale("en");
      cleanupWidgets();
    }
  }
});

it("adds no row for a greyed product pressed in the picker", async () => {
  const { el } = await mount({ products: withVariants });
  const combobox = await openPicker(el);
  const wine = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (row) => row.querySelector(".option-label")?.textContent === "Wine",
  )!;
  expect(wine.getAttribute("aria-disabled")).toBe("true");

  wine.click();
  await el.updateComplete;

  expect(el.shadowRoot!.querySelectorAll("tbody tr")).toHaveLength(0);
  expect(text(el, "added-status")).toBe("");
});

it("finds a greyed product by a search, with its reason, rather than coming up empty", async () => {
  const { el } = await mount({ products: withVariants });
  const combobox = await openPicker(el);

  await userEvent.type(combobox.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "win");
  await combobox.updateComplete;

  const rows = [...combobox.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')];
  expect(
    rows.map((row) => [
      row.querySelector(".option-label")!.textContent,
      row.querySelector(".option-description")!.textContent,
      row.getAttribute("aria-disabled"),
    ]),
  ).toEqual([["Wine", "Has variants, so it can't be an extra", "true"]]);
  expect(combobox.shadowRoot!.querySelector(".empty")).toBeNull();
});

const wineOnList: ExtraList = {
  ...addons,
  items: [
    { id: BACON_ITEM, productId: WINE, maxQuantity: 1, preselected: false, price: null },
    { id: EGG_ITEM, productId: EGG, maxQuantity: 1, preselected: false, price: null },
  ],
};

it("marks a listed product that has an Active variant on its row before any save, in English and Spanish", async () => {
  const expected = {
    en: "Has variants, so it can't be an extra. Remove it from this list.",
    es: "Tiene variantes, así que no puede ser un extra. Quítalo de esta lista.",
  };
  for (const locale of ["en", "es"] as const) {
    setLocale(locale);
    try {
      const { el } = await mount({ value: wineOnList, products: withVariants });
      expect(text(el, "item-0-product-error"), locale).toBe(expected[locale]);
      expect(el.shadowRoot!.querySelector('[data-test="item-1-product-error"]')).toBeNull();
      expect(await bottomOf(el), locale).toBe("");
      expect(saveOf(el).hasAttribute("disabled"), locale).toBe(false);
    } finally {
      setLocale("en");
      cleanupWidgets();
    }
  }
});

it("does not mark a listed product whose only variant is Inactive", async () => {
  const { el } = await mount({
    value: { ...wineOnList, items: [{ ...wineOnList.items[0]!, productId: CIDER }] },
    products: withVariants,
  });
  expect(el.shadowRoot!.querySelector('[data-test="item-0-product-error"]')).toBeNull();
});

it("refuses to save a list holding a product with an Active variant, and saves once that row is removed", async () => {
  const { el, host } = await mount({ value: wineOnList, products: withVariants });
  const submitted = record(host);

  await click(el, "save");

  expect(submitted).toEqual([]);
  expect(text(el, "item-0-product-error")).toBe(t("extras.has_variants_remove"));
  expect(await bottomOf(el)).toBe(t("form.fix_fields"));
  expect(saveOf(el).hasAttribute("disabled")).toBe(true);

  await click(el, "remove-item-0");
  expect(saveOf(el).hasAttribute("disabled")).toBe(false);
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.items.map((item) => item.productId)).toEqual([EGG]);
});

// ---------------------------------------------------------------------------
// Portion, in a column of its own beside Price

/** The id a product read reports for a product sold by the unit (`EACH_UNIT_ID`,
 * packages/catalogue/src/unit-validation.ts). */
const EACH_ID = "00000000-0000-0000-0000-000000000001";
const EACH = {
  id: EACH_ID,
  name: { en: "Each", es: "Unidad" },
  precision: 0,
  abbreviation: { en: "ea", es: "ud" },
};
/** Like GRAM above, this measure has no decimals, so only the unit's identity tells it from Each. */
const MILLILITRE = {
  id: "unit-ml",
  name: { en: "Millilitre", es: "Mililitro" },
  precision: 0,
  abbreviation: { en: "ml" },
};

const eachBacon = product({ unitId: EACH_ID, unit: EACH });
const eachEgg = product({
  id: EGG,
  name: "Fried egg",
  unitPrice: "0.80",
  unitId: EACH_ID,
  unit: EACH,
});

function portionCell(el: ExtraListForm, index: number): HTMLTableCellElement {
  return el.shadowRoot!.querySelector<HTMLTableCellElement>(
    `[data-test="item-${index}-portion-cell"]`,
  )!;
}

function headingTexts(el: ExtraListForm): string[] {
  return [...el.shadowRoot!.querySelectorAll("thead th")].map((th) => th.textContent!.trim());
}

it("heads Portion and Price as two columns, Portion first, even when every item is sold by the unit", async () => {
  const { el } = await mount({ value: addons, products: [eachBacon, eachEgg] });
  const headings = headingTexts(el);
  const portionAt = headings.indexOf(t("extras.portion"));

  expect(portionAt).toBeGreaterThan(-1);
  expect(headings[portionAt + 1]).toBe(t("extras.price"));
  const row = el.shadowRoot!.querySelector(`tr[data-item="${BACON_ITEM}"]`)!;
  const cells = [...row.children];
  expect(cells.indexOf(portionCell(el, 0))).toBe(portionAt);
  expect(cells[portionAt + 1]!.querySelector("wt-price-input")).not.toBeNull();
  expect(portionCell(el, 0).querySelector("wt-price-input")).toBeNull();
});

it("shows a saved unit-sold item's portion as a plain 1, and saves one unit", async () => {
  const { el, host } = await mount({
    value: { ...addons, items: addons.items.map((item) => ({ ...item, portion: "1.000" })) },
    products: [eachBacon, eachEgg],
  });
  const submitted = record(host);

  expect(portionCell(el, 1).textContent!.trim()).toBe("1");
  expect(field(el, "item-1-portion")).toBeNull();
  expect(portionCell(el, 1).querySelector("wt-input, input, .required")).toBeNull();
  expect(field<HTMLElementTagNameMap["wt-price-input"]>(el, "item-1-price").placeholder).toBe(
    "0.80",
  );

  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.items.map((item) => item.portion)).toEqual([undefined, undefined]);
});

it("neither multiplies the inherited price by a stale saved portion nor sends it back", async () => {
  const { el, host } = await mount({
    value: { ...addons, items: [{ ...addons.items[1]!, portion: "2.000" }] },
    products: [eachBacon, eachEgg],
  });
  const submitted = record(host);

  expect(portionCell(el, 0).textContent!.trim()).toBe("1");
  expect(field<HTMLElementTagNameMap["wt-price-input"]>(el, "item-0-price").placeholder).toBe(
    "0.80",
  );
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect("portion" in submitted[0]!.items[0]!).toBe(false);
});

it("shows a newly added unit-sold item's portion as 1 and saves it with no portion error", async () => {
  const { el, host } = await mount({ products: [eachBacon, eachEgg] });
  const submitted = record(host);
  await type(el, "name", "Extras");
  await addItem(el, "Fried egg");

  expect(portionCell(el, 0).textContent!.trim()).toBe("1");
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect("portion" in submitted[0]!.items[0]!).toBe(false);
});

it.each([
  ["a weighed product with decimals", KG],
  ["a whole-gram product", GRAM],
  ["a whole-millilitre product", MILLILITRE],
])("asks for %s's portion in the Portion column as soon as it is added", async (_what, unit) => {
  const { el, host } = await mount({
    products: [product({ unitId: unit.id, unit, unitPrice: "100.00" })],
  });
  const submitted = record(host);
  await type(el, "name", "Extras");
  await addItem(el, "Bacon");

  const portion = field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-portion");
  expect(portion.closest("td")).toBe(portionCell(el, 0));
  expect(portion.required).toBe(true);
  expect(portion.value).toBe("");
  await click(el, "save");
  expect(submitted).toHaveLength(0);
  expect(portion.error).toBe(t("extras.portion_required"));

  await type(el, "item-0-portion", "2");
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect(submitted[0]!.items[0]!.portion).toBe("2");
});

it("marks the Portion heading required only while a row asks for a portion", async () => {
  const { el } = await mount({ value: addons, products: [eachBacon, eachEgg] });
  const heading = () =>
    [...el.shadowRoot!.querySelectorAll("thead th")].find(
      (th) => th.textContent!.trim().replaceAll("*", "").trim() === t("extras.portion"),
    )!;
  expect(heading().querySelector(".required")).toBeNull();

  el.products = [product({ unitId: MILLILITRE.id, unit: MILLILITRE }), eachEgg];
  await el.updateComplete;
  expect(heading().querySelector(".required")).not.toBeNull();
});

it("holds a mixed list's two kinds of row apart", async () => {
  const { el, host } = await mount({
    value: {
      ...addons,
      items: [
        { ...addons.items[0]!, portion: "250.000" },
        { ...addons.items[1]!, portion: "1.000" },
      ],
    },
    products: [product({ unitId: MILLILITRE.id, unit: MILLILITRE }), eachEgg],
  });
  const submitted = record(host);

  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-portion").value).toBe("250.000");
  expect(portionCell(el, 1).textContent!.trim()).toBe("1");
  expect(field(el, "item-1-portion")).toBeNull();
  await click(el, "save");
  expect(submitted[0]!.items.map((item) => item.portion)).toEqual(["250.000", undefined]);
  expect(submitted[0]!.items[0]!.price).toBe("2.00");
});

it("switches a row between an editable portion and a fixed 1 when its product's unit changes", async () => {
  const { el, host } = await mount({ products: [eachBacon] });
  const submitted = record(host);
  await type(el, "name", "Extras");
  await addItem(el, "Bacon");
  expect(portionCell(el, 0).textContent!.trim()).toBe("1");

  el.products = [product({ unitId: MILLILITRE.id, unit: MILLILITRE })];
  await el.updateComplete;
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-0-portion").required).toBe(true);
  await click(el, "save");
  expect(submitted).toHaveLength(0);
  expect(errorOf(el, "item-0-portion")).toBe(t("extras.portion_required"));

  el.products = [eachBacon];
  await el.updateComplete;
  expect(field(el, "item-0-portion")).toBeNull();
  expect(portionCell(el, 0).textContent!.trim()).toBe("1");
  await click(el, "save");
  expect(submitted).toHaveLength(1);
  expect("portion" in submitted[0]!.items[0]!).toBe(false);
});

it("shows the same Portion cells before a save and after the list is reopened with what the server returns, and saves them again", async () => {
  const { el, host } = await mount({
    products: [product({ unitId: MILLILITRE.id, unit: MILLILITRE }), eachEgg],
  });
  const submitted = record(host);
  await type(el, "name", "Extras");
  await addItem(el, "Fried egg");
  await addItem(el, "Bacon");
  await type(el, "item-1-portion", "250");
  const before = [
    portionCell(el, 0).textContent!.trim(),
    field<HTMLElementTagNameMap["wt-input"]>(el, "item-1-portion").value,
  ];
  await click(el, "save");
  const sent = submitted[0]!;

  el.open = false;
  await el.updateComplete;
  el.value = {
    id: "55555555-5555-4555-8555-555555555555",
    ...sent,
    items: sent.items.map((item) => ({
      id: item.id!,
      productId: item.productId,
      maxQuantity: item.maxQuantity,
      preselected: item.preselected,
      price: item.price,
      portion: item.portion === undefined ? "1.000" : `${item.portion}.000`,
    })),
  } as ExtraList;
  el.open = true;
  await el.updateComplete;

  expect(before).toEqual(["1", "250"]);
  expect(portionCell(el, 0).textContent!.trim()).toBe("1");
  expect(field(el, "item-0-portion")).toBeNull();
  expect(field<HTMLElementTagNameMap["wt-input"]>(el, "item-1-portion").value).toBe("250.000");

  await click(el, "save");
  expect(submitted).toHaveLength(2);
  const resent = submitted[1]!.items;
  expect(resent.map((item) => item.productId)).toEqual([EGG, BACON]);
  expect("portion" in resent[0]!, "the Each row sends no portion").toBe(false);
  expect(resent[1]!.portion).toBe("250.000");
});

/** A text's FIRST line box, however many lines it wraps to. */
function firstLine(node: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(node);
  return range.getClientRects()[0]!;
}

it.each([
  [1280, "light"],
  [1280, "dark"],
  [390, "light"],
  [390, "dark"],
] as const)(
  "draws the drag handle's icon within the first line of a tall row's product name at %ipx (%s)",
  async (frame, theme) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(frame, 844);
    try {
      const { el } = await mountWidget<ExtraListForm>(
        "dashboard-extra-list-form",
        {
          open: true,
          languages,
          value: {
            ...addons,
            items: [{ ...addons.items[0]!, portion: "0.055" }, addons.items[1]!],
          },
          products: [
            product({
              name: "Smoked streaky bacon from the farm down the road, cut thick and fried until it is crisp at the edges",
              unitId: KG.id,
              unit: { ...KG, precision: 2 },
            }),
            products[1]!,
          ],
        },
        theme,
      );
      expect(el.parentElement!.getAttribute("data-theme")).toBe(theme);
      const row = el.shadowRoot!.querySelector<HTMLElement>(`tr[data-item="${BACON_ITEM}"]`)!;
      const name = row.querySelector('[data-test="item-0-product"]')!;
      const handle = row.querySelector<HTMLElement>(`[data-test="drag-${BACON_ITEM}"]`)!;
      const icon = handle.querySelector("wt-icon") ?? handle;
      const box = icon.getBoundingClientRect();
      const handleBox = handle.getBoundingClientRect();
      const nameLines = (() => {
        const range = document.createRange();
        range.selectNodeContents(name);
        return range.getClientRects().length;
      })();

      expect(window.innerWidth).toBe(frame);
      // Only a row taller than its handle can tell the first line from the row's middle.
      expect(row.getBoundingClientRect().height).toBeGreaterThan(handleBox.height * 1.5);
      expect(nameLines, "the name wraps").toBeGreaterThan(1);
      const line = firstLine(name);
      const iconMiddle = (box.top + box.bottom) / 2;
      // The middle, not the whole icon: line boxes differ by a pixel between machines' fonts.
      expect(
        iconMiddle >= line.top && iconMiddle <= line.bottom,
        JSON.stringify({ icon: box, line }),
      ).toBe(true);
      expect({ width: handleBox.width >= 44, height: handleBox.height >= 44 }).toEqual({
        width: true,
        height: true,
      });
    } finally {
      await page.viewport(width, height);
    }
  },
);

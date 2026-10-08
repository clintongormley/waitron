import { afterEach, expect, it } from "vitest";
import { html, render } from "lit";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import: pulls the module in for its `@customElement` side effect.
import { SectionAddProducts } from "./section-add-products.js";
import type { CategorySummary } from "../api/client.js";
import { setContentLanguages } from "@waitron/ui";
import { setLocale, t } from "../i18n/t.js";

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
  setContentLanguages({ defaultLanguage: "es", languages: ["es"] });
});

const category = (id: string, name: string, parentId: string | null): CategorySummary => ({
  id,
  name,
  parentId,
  color: null,
});

const categories = [
  category("c-drinks", "Bebidas", null),
  category("c-beer", "Cerveza", "c-drinks"),
  category("c-mains", "Principales", null),
];

const products = [
  { id: "p-lemonade", name: "Lemonade", categoryId: "c-drinks" },
  { id: "p-lager", name: "Lager", categoryId: "c-beer" },
  { id: "p-ipa", name: "IPA", categoryId: "c-beer" },
  { id: "p-burger", name: "Burger", categoryId: "c-mains" },
  { id: "p-water", name: "Water", categoryId: null },
];

async function mount(props: Partial<SectionAddProducts> = {}) {
  const { el } = await mountWidget<SectionAddProducts>("dashboard-section-add-products", {
    products,
    categories,
    inSection: [],
    onMenu: ["p-burger", "p-lemonade"],
    ...props,
  });
  return el;
}

function q<T extends Element = HTMLElement>(el: SectionAddProducts, selector: string): T {
  return el.shadowRoot!.querySelector<T>(selector)!;
}

function listed(el: SectionAddProducts): string[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="product"]')].map(
    (box) => box.value,
  );
}

it.each(["en-GB", "es-ES"])(
  "offers decimal-named products and category paths by value in %s",
  async (locale) => {
    setLocale(locale);
    const separator = locale === "es-ES" ? "," : ".";
    const el = await mount({
      products: [
        { id: "half", name: `Bag 0${separator}5 kg`, categoryId: "half" },
        { id: "quarter", name: `Bag 0${separator}25 kg`, categoryId: "quarter" },
        { id: "two", name: "Bag 2 kg", categoryId: "half" },
      ],
      categories: [
        category("half", `0${separator}5 kg`, null),
        category("quarter", `0${separator}25 kg`, null),
      ],
    });
    expect(listed(el)).toEqual(["quarter", "half", "two"]);
    expect(categoryBox(el).options.map(({ label }) => label)).toEqual([
      t("add_products.all_categories"),
      `0${separator}25 kg`,
      `0${separator}5 kg`,
    ]);
  },
);

async function filterBy(el: SectionAddProducts, categoryId: string): Promise<void> {
  await chooseOption(q(el, 'wt-combobox[name="category"]'), categoryId);
  await el.updateComplete;
}

type CategoryBox = HTMLElement & {
  value: string;
  label: string;
  placeholder: string;
  search: string;
  disabled: boolean;
  options: { value: string; label: string }[];
  updateComplete: Promise<unknown>;
};

const categoryBox = (el: SectionAddProducts): CategoryBox =>
  q<CategoryBox>(el, 'wt-combobox[name="category"]');

/** What the closed dropdown shows on its trigger, not what its properties say it holds. */
async function shownCategory(el: SectionAddProducts): Promise<string | undefined> {
  const box = categoryBox(el);
  await box.updateComplete;
  return box.shadowRoot!.querySelector(".trigger .value")?.textContent?.trim();
}

async function search(el: SectionAddProducts, value: string): Promise<void> {
  q(el, 'wt-input[name="search"]').dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await el.updateComplete;
}

async function tick(el: SectionAddProducts, productId: string): Promise<void> {
  q<HTMLInputElement>(el, `input[name="product"][value="${productId}"]`).click();
  await el.updateComplete;
}

function capture(el: HTMLElement): { productIds: string[] }[] {
  const seen: { productIds: string[] }[] = [];
  el.addEventListener("wt-add-products", (event) =>
    seen.push((event as CustomEvent<{ productIds: string[] }>).detail),
  );
  return seen;
}

it("filters by category from the shared dropdown, with All categories as its prompt and a row", async () => {
  const el = await mount();
  const box = categoryBox(el);
  expect(box).not.toBeNull();
  expect(box.label).toBe(t("add_products.category"));
  expect(box.search).toBe("auto");
  expect(box.placeholder).toBe(t("add_products.all_categories"));
  expect(box.options).toEqual([
    { value: "", label: t("add_products.all_categories") },
    { value: "c-drinks", label: "Bebidas" },
    { value: "c-beer", label: "Bebidas › Cerveza" },
    { value: "c-mains", label: "Principales" },
  ]);
  expect(box.value).toBe("");
  expect(await shownCategory(el)).toBe(t("add_products.all_categories"));
  await chooseOption(box, "c-mains");
  await el.updateComplete;
  expect(listed(el)).toEqual(["p-burger"]);
  expect(await shownCategory(el)).toBe("Principales");
});

it("keeps the category filter's width, and the search field beside it, whatever category is shown", async () => {
  const el = await mount();
  const box = categoryBox(el);
  const searchField = q(el, 'wt-input[name="search"]');
  const measure = () => ({
    width: box.getBoundingClientRect().width,
    searchLeft: searchField.getBoundingClientRect().left,
  });
  const before = measure();
  expect(before.width).toBeGreaterThan(0);
  await chooseOption(box, "c-mains");
  await el.updateComplete;
  expect(await shownCategory(el)).toBe("Principales");
  expect(measure().width).toBeCloseTo(before.width, 0);
  expect(measure().searchLeft).toBeCloseTo(before.searchLeft, 0);
  await chooseOption(box, "c-beer");
  await el.updateComplete;
  expect(await shownCategory(el)).toBe("Bebidas › Cerveza");
  expect(measure().width).toBeCloseTo(before.width, 0);
  expect(measure().searchLeft).toBeCloseTo(before.searchLeft, 0);
});

it("lists every product by name until a filter is chosen", async () => {
  const el = await mount();
  expect(listed(el)).toEqual(["p-burger", "p-ipa", "p-lager", "p-lemonade", "p-water"]);
});

it("offers every reporting category by its path", async () => {
  const el = await mount();
  const options = categoryBox(el).options;
  expect(options.map((option) => option.value)).toEqual(["", "c-drinks", "c-beer", "c-mains"]);
  expect(options[2]!.label).toBe("Bebidas › Cerveza");
});

it("filtering by Drinks also lists what sits under Beer, and not Mains", async () => {
  const el = await mount();
  await filterBy(el, "c-drinks");
  expect(listed(el)).toEqual(["p-ipa", "p-lager", "p-lemonade"]);
  expect(categoryBox(el).value).toBe("c-drinks");
  expect(await shownCategory(el)).toBe("Bebidas");
  await filterBy(el, "c-beer");
  expect(listed(el)).toEqual(["p-ipa", "p-lager"]);
  await filterBy(el, "");
  expect(listed(el)).toHaveLength(5);
});

it("searches by name, ignoring case, within the chosen category", async () => {
  const el = await mount();
  await search(el, "  LA ");
  expect(listed(el)).toEqual(["p-lager"]);
  await filterBy(el, "c-mains");
  expect(listed(el)).toEqual([]);
  expect(q(el, '[data-test="no-matches"]').textContent!.trim()).toBe(t("add_products.no_matches"));
});

it("selecting three and confirming emits one event carrying the three ids", async () => {
  const el = await mount();
  const adds = capture(el);
  await tick(el, "p-water");
  await tick(el, "p-lager");
  await tick(el, "p-burger");
  expect(q(el, '[data-test="count"]').textContent!.trim()).toBe(
    t("add_products.selected").replace("{count}", "3"),
  );
  q(el, '[data-test="add"]').click();
  await el.updateComplete;
  expect(adds).toEqual([{ productIds: ["p-burger", "p-lager", "p-water"] }]);
});

it("keeps a ticked product chosen while a filter hides it, and a second tick unchooses", async () => {
  const el = await mount();
  const adds = capture(el);
  await tick(el, "p-burger");
  await tick(el, "p-ipa");
  await tick(el, "p-lemonade");
  await tick(el, "p-lemonade");
  await filterBy(el, "c-beer");
  q(el, '[data-test="add"]').click();
  expect(adds).toEqual([{ productIds: ["p-burger", "p-ipa"] }]);
});

it("leaves out a product already in this section, and marks one elsewhere on the menu, which can be added", async () => {
  const el = await mount({ inSection: ["p-lemonade"] });
  const adds = capture(el);
  expect(listed(el)).toEqual(["p-burger", "p-ipa", "p-lager", "p-water"]);
  const marks = (id: string) =>
    [...q(el, `li[data-product="${id}"]`).querySelectorAll(".mark")].map((mark) =>
      mark.textContent!.trim(),
    );
  expect(marks("p-burger")).toEqual([t("add_products.on_menu")]);
  expect(marks("p-lager")).toEqual([]);
  // The mark is part of the checkbox's name, not only something seen beside it.
  const burger = q<HTMLInputElement>(el, 'input[value="p-burger"]');
  expect(burger.closest("label")!.textContent).toContain(t("add_products.on_menu"));
  await tick(el, "p-burger");
  q(el, '[data-test="add"]').click();
  expect(adds).toEqual([{ productIds: ["p-burger"] }]);
});

it("offers a product again once the section no longer holds it", async () => {
  const el = await mount({ inSection: ["p-lemonade"] });
  el.inSection = [];
  await el.updateComplete;
  expect(listed(el)).toContain("p-lemonade");
});

it("drops a ticked product from what it adds once the section holds it", async () => {
  const el = await mount();
  const adds = capture(el);
  await tick(el, "p-lemonade");
  await tick(el, "p-ipa");
  el.inSection = ["p-lemonade"];
  await el.updateComplete;
  expect(q(el, '[data-test="count"]').textContent!.trim()).toBe(
    t("add_products.selected").replace("{count}", "1"),
  );
  q(el, '[data-test="add"]').click();
  expect(adds).toEqual([{ productIds: ["p-ipa"] }]);
});

it("says every product is already in the section when it holds them all", async () => {
  const el = await mount({ inSection: products.map(({ id }) => id) });
  expect(listed(el)).toEqual([]);
  expect(q(el, '[data-test="all-in-section"]').textContent!.trim()).toBe(
    t("add_products.all_in_section"),
  );
  expect(el.shadowRoot!.querySelector('[data-test="no-matches"]')).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="empty"]')).toBeNull();
});

it("shows no On this menu mark outside a menu", async () => {
  const el = await mount({ onMenu: null });
  expect(el.shadowRoot!.textContent).not.toContain(t("add_products.on_menu"));
});

it("explains, rather than emitting, when confirmed with nothing left to add", async () => {
  const el = await mount();
  const adds = capture(el);
  await tick(el, "p-lemonade");
  el.inSection = ["p-lemonade"];
  await el.updateComplete;
  q(el, '[data-test="add"]').click();
  await el.updateComplete;
  expect(adds).toEqual([]);
  expect(q(el, '[data-test="error"]').textContent!.trim()).toBe(t("add_products.none_chosen"));
  expect(q(el, "fieldset").getAttribute("aria-describedby")).toBe(q(el, '[data-test="error"]').id);
  await tick(el, "p-ipa");
  expect(el.shadowRoot!.querySelector('[data-test="error"]')).toBeNull();
});

it("while busy, disables its controls and emits nothing", async () => {
  const el = await mount({ busy: true });
  const adds = capture(el);
  expect(categoryBox(el).disabled).toBe(true);
  expect(q<HTMLInputElement>(el, 'input[value="p-ipa"]').disabled).toBe(true);
  expect((q(el, '[data-test="add"]') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
  q(el, '[data-test="add"]').click();
  await el.updateComplete;
  expect(adds).toEqual([]);
  expect(el.shadowRoot!.querySelector('[data-test="error"]')).toBeNull();
});

it("says so when there are no products at all", async () => {
  const el = await mount({ products: [] });
  expect(listed(el)).toEqual([]);
  expect(q(el, '[data-test="empty"]').textContent!.trim()).toBe(t("add_products.empty"));
  expect(el.shadowRoot!.querySelector('[data-test="no-matches"]')).toBeNull();
});

it("puts a Cancel the host supplies beside its own action", async () => {
  const { el } = await mountWidget<SectionAddProducts>("dashboard-section-add-products", {
    products,
    categories,
  });
  render(html`<button slot="cancel" data-test="host-cancel">Cancel</button>`, el);
  await el.updateComplete;
  const slot = q<HTMLSlotElement>(el, 'slot[name="cancel"]');
  expect(slot.assignedElements().map((node) => node.getAttribute("data-test"))).toEqual([
    "host-cancel",
  ]);
  expect(slot.getAttribute("slot")).toBe("cancel");
});

it("returns to every category when the chosen one is deleted", async () => {
  const el = await mount();
  await filterBy(el, "c-beer");
  el.categories = categories.filter((item) => item.id !== "c-beer");
  await el.updateComplete;
  expect(categoryBox(el).value).toBe("");
  expect(await shownCategory(el)).toBe(t("add_products.all_categories"));
  expect(listed(el)).toHaveLength(5);
});

it("widens the chosen filter when a category is added beneath it", async () => {
  const el = await mount({
    products: [...products, { id: "p-cider", name: "Cider", categoryId: "c-cider" }],
  });
  await filterBy(el, "c-drinks");
  expect(listed(el)).toEqual(["p-ipa", "p-lager", "p-lemonade"]);
  el.categories = [...categories, category("c-cider", "Sidra", "c-drinks")];
  await el.updateComplete;
  expect(listed(el)).toEqual(["p-cider", "p-ipa", "p-lager", "p-lemonade"]);
  expect(categoryBox(el).options.find((option) => option.value === "c-cider")!.label).toBe(
    "Bebidas › Sidra",
  );
});

it("names the categories by their one name whatever language is in force", async () => {
  const el = await mount();
  setContentLanguages({ defaultLanguage: "es", languages: ["es", "en"] });
  setLocale("en");
  await search(el, "a");
  expect(categoryBox(el).options.find((option) => option.value === "c-beer")!.label).toBe(
    "Bebidas › Cerveza",
  );
});

const header = (el: SectionAddProducts): HTMLInputElement =>
  q<HTMLInputElement>(el, 'input[data-test="select-listed"]');

async function tickHeader(el: SectionAddProducts): Promise<void> {
  header(el).click();
  await el.updateComplete;
}

function ticked(el: SectionAddProducts): string[] {
  return [
    ...el.shadowRoot!.querySelectorAll<HTMLInputElement>('input[name="product"]:checked'),
  ].map((box) => box.value);
}

it("names the header checkbox for what it does, and shows a shorter label beside it", async () => {
  const el = await mount();
  const box = header(el);
  expect(box.getAttribute("aria-label")).toBe(t("add_products.select_listed_label"));
  expect(box.closest("label")!.textContent!.trim()).toBe(t("add_products.select_listed"));
  expect(box.checked).toBe(false);
  expect(box.indeterminate).toBe(false);
  expect(box.disabled).toBe(false);
});

it("puts the header checkbox above the list, in line with the product checkboxes", async () => {
  const el = await mount();
  const box = header(el).getBoundingClientRect();
  const first = q<HTMLInputElement>(el, 'input[name="product"]').getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.left).toBeCloseTo(first.left, 0);
  expect(box.width).toBeCloseTo(first.width, 0);
  expect(box.top).toBeLessThan(first.top);
});

it("the header checkbox chooses only the products the filters list", async () => {
  const el = await mount();
  await filterBy(el, "c-beer");
  await tickHeader(el);
  expect(ticked(el)).toEqual(["p-ipa", "p-lager"]);
  expect(header(el).checked).toBe(true);
  expect(header(el).indeterminate).toBe(false);
  expect(q(el, '[data-test="count"]').textContent!.trim()).toBe(
    t("add_products.selected").replace("{count}", "2"),
  );
  await filterBy(el, "");
  expect(ticked(el)).toEqual(["p-ipa", "p-lager"]);
});

it("the header checkbox chooses only what a search lists", async () => {
  const el = await mount();
  await search(el, "la");
  await tickHeader(el);
  await search(el, "");
  expect(ticked(el)).toEqual(["p-lager"]);
});

it("shows mixed while some listed products are chosen, and a click then chooses every listed one", async () => {
  const el = await mount();
  await filterBy(el, "c-drinks");
  await tick(el, "p-lager");
  expect(header(el).indeterminate).toBe(true);
  expect(header(el).checked).toBe(false);
  await tickHeader(el);
  expect(ticked(el)).toEqual(["p-ipa", "p-lager", "p-lemonade"]);
  expect(header(el).indeterminate).toBe(false);
  expect(header(el).checked).toBe(true);
});

it("unchooses only the listed products, keeping those a filter hides", async () => {
  const el = await mount();
  const adds = capture(el);
  await tick(el, "p-burger");
  await tick(el, "p-ipa");
  await tick(el, "p-lager");
  await filterBy(el, "c-beer");
  expect(header(el).checked).toBe(true);
  await tickHeader(el);
  expect(ticked(el)).toEqual([]);
  expect(header(el).checked).toBe(false);
  expect(header(el).indeterminate).toBe(false);
  expect(q(el, '[data-test="count"]').textContent!.trim()).toBe(
    t("add_products.selected").replace("{count}", "1"),
  );
  q(el, '[data-test="add"]').click();
  expect(adds).toEqual([{ productIds: ["p-burger"] }]);
});

it("reads its state from the listed products alone, not from chosen ones a filter hides", async () => {
  const el = await mount();
  await tick(el, "p-burger");
  await tick(el, "p-water");
  expect(header(el).indeterminate).toBe(true);
  await filterBy(el, "c-beer");
  expect(header(el).checked).toBe(false);
  expect(header(el).indeterminate).toBe(false);
});

it("adds what the header chose together with chosen products the filter now hides", async () => {
  const el = await mount();
  const adds = capture(el);
  await tick(el, "p-water");
  await filterBy(el, "c-beer");
  await tickHeader(el);
  q(el, '[data-test="add"]').click();
  expect(adds).toEqual([{ productIds: ["p-ipa", "p-lager", "p-water"] }]);
});

it("disables the header checkbox while no product matches the filters", async () => {
  const el = await mount();
  await tick(el, "p-burger");
  await filterBy(el, "c-beer");
  await search(el, "zzz");
  expect(q(el, '[data-test="no-matches"]')).not.toBeNull();
  expect(header(el).disabled).toBe(true);
  expect(header(el).checked).toBe(false);
  expect(header(el).indeterminate).toBe(false);
  await search(el, "");
  expect(header(el).disabled).toBe(false);
});

it("draws no header checkbox when there is nothing the filters could list", async () => {
  const none = await mount({ products: [] });
  expect(none.shadowRoot!.querySelector('[data-test="select-listed"]')).toBeNull();
  cleanupWidgets();
  const held = await mount({ inSection: products.map(({ id }) => id) });
  expect(held.shadowRoot!.querySelector('[data-test="select-listed"]')).toBeNull();
});

it("disables the header checkbox while busy", async () => {
  const el = await mount({ busy: true });
  expect(header(el).disabled).toBe(true);
});

it("clears the nothing-chosen explanation once the header checkbox chooses", async () => {
  const el = await mount();
  await tick(el, "p-lemonade");
  el.inSection = ["p-lemonade"];
  await el.updateComplete;
  q(el, '[data-test="add"]').click();
  await el.updateComplete;
  expect(q(el, '[data-test="error"]')).not.toBeNull();
  await tickHeader(el);
  expect(el.shadowRoot!.querySelector('[data-test="error"]')).toBeNull();
});

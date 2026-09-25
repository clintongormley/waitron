import { afterEach, expect, it } from "vitest";
import { html, render } from "lit";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import: pulls the module in for its `@customElement` side effect.
import { SectionAddProducts } from "./section-add-products.js";
import type { CategorySummary } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

const category = (
  id: string,
  en: string,
  es: string,
  parentId: string | null,
): CategorySummary => ({
  id,
  name: { en, es },
  image: null,
  color: null,
  parentId,
});

const categories = [
  category("c-drinks", "Drinks", "Bebidas", null),
  category("c-beer", "Beer", "Cerveza", "c-drinks"),
  category("c-mains", "Mains", "Principales", null),
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
    inSection: ["p-lemonade"],
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

async function filterBy(el: SectionAddProducts, categoryId: string): Promise<void> {
  const select = q<HTMLSelectElement>(el, 'select[name="category"]');
  select.value = categoryId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await el.updateComplete;
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

it("lists every product by name until a filter is chosen", async () => {
  const el = await mount();
  expect(listed(el)).toEqual(["p-burger", "p-ipa", "p-lager", "p-lemonade", "p-water"]);
});

it("offers every reporting category by its path", async () => {
  const el = await mount();
  const options = [...el.shadowRoot!.querySelectorAll('select[name="category"] option')];
  expect(options.map((option) => (option as HTMLOptionElement).value)).toEqual([
    "",
    "c-drinks",
    "c-beer",
    "c-mains",
  ]);
  expect(options[2]!.textContent!.trim()).toBe("Bebidas / Cerveza");
});

it("filtering by Drinks also lists what sits under Beer, and not Mains", async () => {
  const el = await mount();
  await filterBy(el, "c-drinks");
  expect(listed(el)).toEqual(["p-ipa", "p-lager", "p-lemonade"]);
  expect(q<HTMLOptionElement>(el, 'option[value="c-drinks"]').selected).toBe(true);
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

it("marks In this section and On this menu with two different texts, and both can still be added", async () => {
  const el = await mount();
  const adds = capture(el);
  const marks = (id: string) =>
    [...q(el, `li[data-product="${id}"]`).querySelectorAll(".mark")].map((mark) =>
      mark.textContent!.trim(),
    );
  expect(t("add_products.in_section")).not.toBe(t("add_products.on_menu"));
  expect(marks("p-lemonade")).toEqual([t("add_products.in_section"), t("add_products.on_menu")]);
  expect(marks("p-burger")).toEqual([t("add_products.on_menu")]);
  expect(marks("p-lager")).toEqual([]);
  // The mark is part of the checkbox's name, not only something seen beside it.
  const lemonade = q<HTMLInputElement>(el, 'input[value="p-lemonade"]');
  expect(lemonade.closest("label")!.textContent).toContain(t("add_products.in_section"));
  expect(lemonade.disabled).toBe(false);
  await tick(el, "p-lemonade");
  await tick(el, "p-burger");
  q(el, '[data-test="add"]').click();
  expect(adds).toEqual([{ productIds: ["p-burger", "p-lemonade"] }]);
});

it("shows no On this menu mark outside a menu", async () => {
  const el = await mount({ onMenu: null });
  expect(el.shadowRoot!.textContent).not.toContain(t("add_products.on_menu"));
  expect(q(el, 'li[data-product="p-lemonade"]').textContent).toContain(
    t("add_products.in_section"),
  );
});

it("explains, rather than emitting, when confirmed with nothing chosen", async () => {
  const el = await mount();
  const adds = capture(el);
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
  expect(q<HTMLSelectElement>(el, 'select[name="category"]').disabled).toBe(true);
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
  expect(q<HTMLSelectElement>(el, 'select[name="category"]').value).toBe("");
  expect(listed(el)).toHaveLength(5);
});

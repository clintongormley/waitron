import { afterEach, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
// Value import: pulls the module in for its `@customElement` side effect.
import { MenuStructureTree } from "./menu-structure-tree.js";
import type { MenuStructureNode } from "../api/client.js";
import { t } from "../i18n/t.js";

afterEach(cleanupWidgets);

/** Staff names; the fixtures elsewhere give each product a different customer and kitchen name, and
 * this widget is handed the staff name alone. */
const products = [
  { id: "p-lager", name: "Lager" },
  { id: "p-lemonade", name: "Lemonade" },
  { id: "p-burger", name: "Burger" },
];

/** Each section's customer names read differently from its internal name, so a tree showing the
 * customer wording fails rather than passing by coincidence. */
const sections = [
  { id: "s-drinks", internalName: "Drinks", names: { es: "Bebidas frías" } },
  { id: "s-beer", internalName: "Beer", names: { es: "Cervezas" } },
  { id: "s-fav", internalName: "Favourites", names: { es: "Favoritos" } },
];

const drinks = (memberId: string): MenuStructureNode => ({
  memberId,
  ref: { kind: "section", sectionId: "s-drinks" },
  children: [
    { memberId: "m-lager", ref: { kind: "product", productId: "p-lager" } },
    {
      memberId: "m-beer",
      ref: { kind: "section", sectionId: "s-beer" },
      children: [{ memberId: "m-lager-2", ref: { kind: "product", productId: "p-lager" } }],
    },
    { memberId: "m-lemonade", ref: { kind: "product", productId: "p-lemonade" } },
  ],
});

/** Drinks sits at the top and again inside Favourites, so it has two paths. */
const nodes = (): MenuStructureNode[] => [
  { memberId: "m-burger", ref: { kind: "product", productId: "p-burger" } },
  drinks("m-drinks"),
  {
    memberId: "m-fav",
    ref: { kind: "section", sectionId: "s-fav" },
    children: [drinks("m-fav-drinks")],
  },
];

async function mount(props: Partial<MenuStructureTree> = {}) {
  const { el } = await mountWidget<MenuStructureTree>("dashboard-menu-structure-tree", {
    nodes: nodes(),
    products,
    sections,
    label: "Lunch Menu",
    ...props,
  });
  return el;
}

function q<T extends Element = HTMLElement>(el: MenuStructureTree, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
}

/** The visible entries, as their path keys, in document order. */
function shown(el: MenuStructureTree): string[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>("li[data-path]")]
    .filter((item) => item.checkVisibility())
    .map((item) => item.dataset.path!);
}

function nameOf(el: MenuStructureTree, path: string): string {
  return q(el, `li[data-path="${path}"] > .row [data-test="name"]`)!.textContent!.trim();
}

async function toggle(el: MenuStructureTree, path: string): Promise<void> {
  q(el, `[data-test="toggle-${path}"]`)!.click();
  await el.updateComplete;
}

it("shows the root's members in order, sections by internal name and products by staff name", async () => {
  const el = await mount();
  expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
  expect(nameOf(el, "m-burger")).toBe("Burger");
  expect(nameOf(el, "m-drinks")).toBe("Drinks");
  expect(el.shadowRoot!.textContent).not.toContain("Bebidas");
  const kinds = [...el.shadowRoot!.querySelectorAll('[data-test="kind"]')].map((kind) =>
    kind.textContent!.trim(),
  );
  expect(kinds).toEqual([
    t("members.kind_product"),
    t("members.kind_section"),
    t("members.kind_section"),
  ]);
});

it("expanding a section shows its members inline, and collapsing hides them again", async () => {
  const el = await mount();
  const button = q(el, '[data-test="toggle-m-drinks"]')!;
  expect(button.getAttribute("aria-expanded")).toBe("false");
  // The glyph alone would also give the button a name, so axe cannot see this one go missing.
  expect(button.getAttribute("aria-label")).toBe(t("menus.expand").replace("{name}", "Drinks"));
  await toggle(el, "m-drinks");
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.getAttribute("aria-label")).toBe(t("menus.collapse").replace("{name}", "Drinks"));
  expect(shown(el)).toEqual([
    "m-burger",
    "m-drinks",
    "m-drinks/m-lager",
    "m-drinks/m-beer",
    "m-drinks/m-lemonade",
    "m-fav",
  ]);
  expect(nameOf(el, "m-drinks/m-lemonade")).toBe("Lemonade");
  await toggle(el, "m-drinks");
  expect(shown(el)).toEqual(["m-burger", "m-drinks", "m-fav"]);
});

it("keeps each place a section appears open or closed on its own", async () => {
  const el = await mount();
  await toggle(el, "m-fav");
  await toggle(el, "m-fav/m-fav-drinks");
  expect(shown(el)).toEqual([
    "m-burger",
    "m-drinks",
    "m-fav",
    "m-fav/m-fav-drinks",
    "m-fav/m-fav-drinks/m-lager",
    "m-fav/m-fav-drinks/m-beer",
    "m-fav/m-fav-drinks/m-lemonade",
  ]);
});

it("asks to edit a section by the path followed to it, once", async () => {
  const el = await mount();
  await toggle(el, "m-fav");
  const seen: { path: string[] }[] = [];
  const outside: Event[] = [];
  el.addEventListener("wt-structure-edit", (event) =>
    seen.push((event as CustomEvent<{ path: string[] }>).detail),
  );
  document.body.addEventListener("wt-structure-edit", (event) => outside.push(event), {
    once: true,
  });
  q(el, '[data-test="edit-m-fav/m-fav-drinks"]')!.click();
  expect(seen).toEqual([{ path: ["m-fav", "m-fav-drinks"] }]);
  // Bubbles and composed, so a host outside this shadow root hears it.
  expect(outside).toHaveLength(1);
});

it("marks the list being edited and opens the way to it", async () => {
  const el = await mount({ current: ["m-fav", "m-fav-drinks", "m-beer"] });
  expect(shown(el)).toContain("m-fav/m-fav-drinks/m-beer");
  expect(q(el, '[data-test="edit-m-fav/m-fav-drinks/m-beer"]')!.getAttribute("aria-current")).toBe(
    "true",
  );
  expect(q(el, '[data-test="edit-m-drinks/m-beer"]')).toBeNull();
  expect(q(el, '[data-test="edit-m-drinks"]')!.hasAttribute("aria-current")).toBe(false);
});

it("says when the menu holds nothing yet", async () => {
  const el = await mount({ nodes: [] });
  expect(q(el, '[data-test="empty"]')!.textContent!.trim()).toBe(t("menus.structure_empty"));
  expect(shown(el)).toEqual([]);
});

it("names a member it does not know as no longer available", async () => {
  const el = await mount({
    nodes: [{ memberId: "m-gone", ref: { kind: "product", productId: "p-gone" } }],
  });
  expect(nameOf(el, "m-gone")).toBe(t("members.missing"));
});

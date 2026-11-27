import { afterEach, beforeEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { TillProduct } from "../api/menu-api.js";
import { DraftStore } from "../state/draft-sync.js";
import type { TillBasket } from "../widgets/basket.js";
import { cleanupWidgets } from "../widgets/test-helpers.js";
import { setLocale } from "../i18n/t.js";
import { beer, flan, mount, resized } from "./till-table-order-screen.test-helpers.js";
import type { TillTableOrderScreen } from "./till-table-order-screen.js";

beforeEach(async () => {
  setLocale("en");
  await page.viewport(1280, 1800);
});
afterEach(() => {
  setLocale("en");
  cleanupWidgets();
});

const tortilla: TillProduct = {
  ...beer,
  id: "tortilla",
  menuItemId: "offer-tortilla",
  name: "Tortilla",
  customerName: { en: "Spanish omelette for guests" },
  description: { en: "Potato and onion omelette" },
  allergens: { eggs: {}, gluten: { kinds: ["wheat"] } },
  dietaryDeclarations: ["vegetarian"],
};
const unreviewed: TillProduct = { ...flan, allergens: null };
const noneDeclared: TillProduct = { ...flan, id: "bread", name: "Bread", allergens: {} };

async function open(products: TillProduct[]) {
  const draft = new DraftStore();
  draft.loadFrom(
    "draft",
    products.map((product) => ({ product, quantity: "1", place: { kind: "fire" as const } })),
  );
  const { el } = await mount({ draftStore: draft });
  el.style.width = "1280px";
  await resized(el);
  await settled(el);
  return el;
}

async function settled(el: TillTableOrderScreen) {
  await el.updateComplete;
  for (const basket of el.shadowRoot!.querySelectorAll<TillBasket>("till-basket"))
    await basket.updateComplete;
}

const opened = (el: TillTableOrderScreen, index: number) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-draft-open="${index}"]`);
const info = (el: TillTableOrderScreen, index: number) =>
  opened(el, index)?.querySelector<HTMLElement>("[data-draft-open-info]") ?? null;
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";

async function tapRow(el: TillTableOrderScreen, index: number) {
  const basket = [...el.shadowRoot!.querySelectorAll<TillBasket>("till-basket")].find((each) =>
    each.lineIndexes?.includes(index),
  )!;
  await userEvent.click(
    basket.shadowRoot!.querySelector<HTMLElement>(`[data-draft-row="${index}"]`)!,
  );
  await settled(el);
}

it("an opened dish shows its description, allergens by name and diet labels above its controls", async () => {
  const el = await open([tortilla]);
  await tapRow(el, 0);
  const facts = info(el, 0)!;
  expect(text(facts.querySelector("[data-description]"))).toBe("Potato and onion omelette");
  const muted = document.createElement("span");
  muted.style.color = "var(--wt-color-text-muted)";
  facts.append(muted);
  expect(getComputedStyle(facts.querySelector("[data-description]")!).color).toBe(
    getComputedStyle(muted).color,
  );
  muted.remove();
  expect(text(facts)).toContain("Contains");
  const allergens = [...facts.querySelectorAll("[data-allergens] li")].map(text);
  expect(allergens).toEqual(["Eggs", "Cereals containing gluten (Wheat)"]);
  expect(
    [...facts.querySelectorAll("[data-allergens] wt-icon")].map((icon) =>
      icon.getAttribute("name"),
    ),
  ).toEqual(["allergen-eggs", "allergen-gluten"]);
  expect([...facts.querySelectorAll("[data-diet] li")].map(text)).toEqual([
    "Vegetarian",
    "No meat",
    "No fish",
  ]);
  // The information reads as the dish's, before the stepper, Options and Note.
  const options = opened(el, 0)!.querySelector("[data-draft-open-options]")!;
  expect(facts.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(facts.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    options.getBoundingClientRect().top,
  );
  // No (i), availability switch or Add to order in the box, and no guest-facing name.
  const box = opened(el, 0)!;
  expect(box.querySelector("[data-availability]")).toBeNull();
  expect(box.querySelector("[data-add]")).toBeNull();
  expect(box.querySelector("[data-info]")).toBeNull();
  expect(text(box)).not.toContain("Spanish omelette for guests");
  expect(text(box)).not.toContain("Sold out");
  expect(text(box)).not.toContain("Add to order");
});

it("an opened dish whose allergens are not yet reviewed says so, with no empty description", async () => {
  const el = await open([unreviewed]);
  await tapRow(el, 0);
  const facts = info(el, 0)!;
  expect(text(facts)).toContain("Allergens not yet reviewed");
  expect(facts.querySelector("[data-allergens]")).toBeNull();
  expect(facts.querySelector("[data-description]")).toBeNull();
  expect(facts.querySelector("[data-diet]")).toBeNull();
});

it("an opened dish with no allergens declared says so", async () => {
  const el = await open([noneDeclared]);
  await tapRow(el, 0);
  const facts = info(el, 0)!;
  expect(text(facts)).toContain("No declared allergens");
  expect(text(facts)).not.toContain("Allergens not yet reviewed");
  expect(facts.querySelector("[data-allergens]")).toBeNull();
});

it("a closed row shows none of the dish's information", async () => {
  const el = await open([tortilla, flan]);
  await tapRow(el, 1);
  expect(info(el, 1)).not.toBeNull();
  expect(info(el, 0)).toBeNull();
  expect(el.shadowRoot!.querySelectorAll("[data-draft-open-info]")).toHaveLength(1);
  await tapRow(el, 1);
  expect(el.shadowRoot!.querySelector("[data-draft-open-info]")).toBeNull();
});

it("shows the dish's information in Spanish", async () => {
  setLocale("es");
  const el = await open([tortilla, unreviewed]);
  await tapRow(el, 0);
  const facts = info(el, 0)!;
  expect(text(facts)).toContain("Contiene");
  expect([...facts.querySelectorAll("[data-allergens] li")].map(text)).toEqual([
    "Huevos",
    "Cereales con gluten (Trigo)",
  ]);
  expect([...facts.querySelectorAll("[data-diet] li")].map(text)).toEqual([
    "Vegetariano",
    "Sin carne",
    "Sin pescado",
  ]);
  await tapRow(el, 1);
  expect(text(info(el, 1))).toContain("Alérgenos pendientes de revisión");
});

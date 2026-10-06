import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type {
  FrozenOfferVariant,
  MenuDocument,
  MenuTarget,
} from "@waitron/catalogue/src/menu-document-types.js";
import { menuTargetKey } from "@waitron/catalogue/src/menu-navigation.js";
import { CustomerMenu } from "./customer-menu.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";

afterEach(cleanupWidgets);

function fixture(): MenuDocument {
  const nested = documentSection("drinks", "Counter drinks", [documentProduct("mi", "burger")]);
  const doc = menuDocument(
    [
      nested,
      documentSection("included", "Other", [structuredClone(nested)]),
      documentSection("empty", "Empty", []),
    ],
    { burger: "Counter burger" },
    "Frozen title",
  );
  const offer = doc.offers.mi!;
  Object.assign(offer, {
    customerName: { en: "House burger", es: "Hamburguesa" },
    description: { en: "Dish description", es: "Descripción" },
    unitPrice: "3.50",
    grossPrice: "99.00",
    image: "lemon slice.jpg",
    ordering: "staff_only",
    allergens: { milk: { presence: "may_contain", source: "cream" } },
    diet: { vegan: "unknown", vegetarian: "yes", contains: [] },
    dietDerivation: { origins: [], pending: true },
    dietaryDeclarations: ["vegetarian"],
  });
  const base = {
    name: offer.name,
    customerName: offer.customerName,
    kitchenName: offer.kitchenName,
    image: offer.image,
    unitPrice: offer.unitPrice,
    unit: offer.unit,
    vatClass: offer.vatClass,
    allergens: offer.allergens,
    diet: offer.diet,
    dietDerivation: offer.dietDerivation,
    dietOverride: offer.dietOverride,
    dietaryDeclarations: offer.dietaryDeclarations,
  };
  offer.variants = [
    {
      ...base,
      id: "small",
      name: "Counter small",
      customerName: { en: "Small" },
      unitPrice: "0.00",
      menuPrice: null,
      pricingUnit: "each",
      image: "small.jpg",
    },
    {
      ...base,
      id: "large",
      name: "Counter large",
      customerName: null,
      unitPrice: "10.00",
      menuPrice: "100.00",
      pricingUnit: "each",
      image: null,
    },
  ] satisfies FrozenOfferVariant[];
  offer.offeredModifiers = [
    {
      kind: "options",
      id: "cook",
      name: "Counter cooking",
      customerName: { en: "Cooking" },
      kitchenName: "COOK",
      defaultLabelId: "rare",
      labels: [
        { id: "rare", name: "Counter rare", customerName: { en: "Rare" }, kitchenName: "RARE" },
        {
          id: "well",
          name: "Counter well",
          customerName: { en: "Well done" },
          kitchenName: "WELL",
        },
      ],
    },
    ...["a", "b"].map((id) => ({
      kind: "extras" as const,
      id,
      name: `Counter ${id}`,
      customerName: { en: `Extras ${id}` },
      kitchenName: "EXTRA",
      minPicks: 1,
      maxPicks: id === "a" ? 2 : null,
      items: [
        {
          productId: "lemon",
          portion: "0.12345",
          unit: offer.unit,
          name: "Counter lemon",
          customerName: { en: "Lemon" },
          kitchenName: "LEMON",
          image: null,
          price: id === "a" ? "1.50" : "2.75",
          vatClass: offer.vatClass,
          maxQuantity: id === "a" ? 1 : 3,
          preselected: id === "a",
          addAllergens: null,
          suitableFor: [],
        },
      ],
    })),
  ];
  return doc;
}
const labels: Record<string, string> = {
  missing_translation: "Missing {language}",
  staff_fallback: "Staff name",
  internal_title: "Internal title",
  empty: "Empty section",
  unavailable_target: "Target unavailable",
  no_allergens: "No declared allergens",
  allergens_unknown: "Allergens unknown",
  diet_unknown: "Diet unknown",
  missing_value: "No value",
  amount: "{amount}",
  changed: "Changed",
  back: "Back",
  min_picks: "Choose at least {min}",
  max_picks: "At most {max}",
  unlimited: "No maximum",
  preselected: "Preselected",
  conflict: "Saved choices exceed limits",
  portion: "Portion",
  max_quantity: "Maximum quantity",
  ordering: "Standalone ordering",
  variants: "Variants",
  price: "Price",
  override: "Price override",
  unit: "Unit",
  image: "Image",
  name: "Name",
  description: "Description",
  allergens: "Allergens",
  diet: "Diet",
  contains: "Contains",
  may_contain: "May contain",
};
function label(key: string, values?: Readonly<Record<string, string>>) {
  let result = labels[key] ?? key;
  for (const [name, value] of Object.entries(values ?? {}))
    result = result.replace(`{${name}}`, value);
  return result;
}
async function mount(doc = fixture(), theme?: "light" | "dark") {
  return mountWidget<CustomerMenu>(
    "dashboard-customer-menu",
    {
      document: doc,
      view: { kind: "customer", language: "en" },
      languages: { defaultLanguage: "en", languages: ["en", "es"] },
      label,
      mediaUrl: (filename) => `/media/${encodeURIComponent(filename)}`,
    },
    theme,
  );
}
function q<T extends HTMLElement = HTMLElement>(el: CustomerMenu, selector: string) {
  return el.shadowRoot!.querySelector<T>(selector)!;
}
function target(
  extra: Partial<Extract<MenuTarget, { kind: "product" }>> = {},
): Extract<MenuTarget, { kind: "product" }> {
  return {
    kind: "product",
    sectionIds: ["drinks"],
    menuItemId: "mi",
    productId: "burger",
    field: { kind: "summary" },
    ...extra,
  };
}
function destination(el: CustomerMenu, value: MenuTarget) {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>("[data-change-target]")].find(
    (node) => node.dataset.changeTarget === menuTargetKey(value),
  )!;
}
async function nativeInput(el: CustomerMenu, selector: string) {
  const field = q<HTMLElement & { updateComplete: Promise<unknown> }>(el, selector);
  await field.updateComplete;
  return field.shadowRoot!.querySelector<HTMLInputElement>("input")!;
}

it("renders frozen title and translated nested, repeated and empty sections", async () => {
  const { el } = await mount();
  expect(el.shadowRoot!.textContent).toContain("Frozen title");
  expect(el.shadowRoot!.textContent).toContain("Internal title");
  await el.reveal({ kind: "section", sectionIds: ["included"], field: { kind: "summary" } });
  expect(el.shadowRoot!.querySelectorAll("[data-section]")).toHaveLength(4);
  await el.reveal({ kind: "section", sectionIds: ["empty"], field: { kind: "summary" } });
  expect(el.shadowRoot!.textContent).toContain("Empty section");
  await el.reveal(target({ sectionIds: ["included", "drinks"] }));
  expect(destination(el, target({ sectionIds: ["included", "drinks"] }))).toBe(
    el.shadowRoot!.activeElement,
  );
});
it("opens customer detail with effective range and own variant price and image", async () => {
  const { el } = await mount();
  await el.reveal(target());
  expect(q(el, "[data-detail]").textContent).toContain("Dish description");
  expect(el.shadowRoot!.textContent).toContain("0.00 – 10.00");
  expect(q<HTMLImageElement>(el, "[data-detail] img").getAttribute("src")).toBe("/media/small.jpg");
  expect(q(el, "[data-detail] [data-field=price]").textContent).toContain("0.00");
  expect(q(el, "[data-detail]").textContent).not.toContain("100.00");
  expect(q(el, "[data-detail]").textContent).not.toContain("COCINA");
});
it("uses each variant's own fallback and frozen parent description in Spanish", async () => {
  const { el } = await mount();
  el.view = { kind: "customer", language: "es" };
  await el.reveal(target({ variantId: "large", field: { kind: "price" } }));
  expect(q(el, "[data-detail]").textContent).toContain("Counter large");
  expect(q(el, "[data-detail]").textContent).toContain("Missing es");
  expect(q(el, "[data-detail]").textContent).toContain("Descripción");
  expect(q(el, "[data-detail] [data-field=price]").textContent).toContain("10.00");
  expect(q(el, "[data-detail]").textContent).not.toContain("Counter burger");
});
it("labels actual fallback language and switches names only in Internal view", async () => {
  const { el } = await mount();
  el.view = { kind: "customer", language: "es" };
  await el.reveal(target());
  expect(q(el, "[data-detail] [lang=en]").textContent).toContain("Small");
  el.view = { kind: "internal" };
  await el.updateComplete;
  expect(q(el, "[data-detail]").textContent).toContain("Counter small");
  expect(q(el, "[data-detail]").textContent).toContain("Dish description");
});
it("keeps modifier order, frozen defaults, portions and distinct list prices", async () => {
  const { el } = await mount();
  await el.reveal(target());
  expect(
    [...el.shadowRoot!.querySelectorAll("[data-modifier]")].map((n) =>
      n.getAttribute("data-modifier"),
    ),
  ).toEqual(["cook", "a", "b"]);
  expect(q<HTMLButtonElement>(el, '[data-option="rare"]').getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect((await nativeInput(el, 'wt-number-stepper[data-list="a"]')).value).toBe("1");
  expect((await nativeInput(el, 'wt-number-stepper[data-list="b"]')).value).toBe("0");
  expect(q(el, '[data-modifier="a"]').textContent).toContain("1.50");
  expect(q(el, '[data-modifier="b"]').textContent).toContain("2.75");
  expect(q(el, '[data-modifier="b"]').textContent).toContain("0.12345");
  expect(q(el, '[data-modifier="b"]').textContent).toContain("Choose at least 1");
});
it("changes only the addressed list and enforces item and summed list caps", async () => {
  const doc = fixture();
  const a = doc.offers.mi!.offeredModifiers[1]!;
  if (a.kind !== "extras") throw Error("fixture");
  a.items.push({
    ...a.items[0]!,
    productId: "onion",
    name: "Onion",
    preselected: false,
    maxQuantity: null,
  });
  const { el } = await mount(doc);
  await el.reveal(target());
  const b = q(el, 'wt-number-stepper[data-list="b"]');
  b.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "2" } }));
  await el.updateComplete;
  expect((await nativeInput(el, 'wt-number-stepper[data-list="b"]')).value).toBe("2");
  expect((await nativeInput(el, 'wt-number-stepper[data-list="a"]')).value).toBe("1");
  b.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "9" } }));
  await el.updateComplete;
  expect((await nativeInput(el, 'wt-number-stepper[data-list="b"]')).value).toBe("3");
  const onion = q(el, 'wt-number-stepper[data-product="onion"]');
  onion.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "5" } }));
  await el.updateComplete;
  expect((await nativeInput(el, 'wt-number-stepper[data-product="onion"]')).value).toBe("1");
});
it("explains zero caps and conflicting saved preselection without mutating the snapshot", async () => {
  const doc = fixture();
  const a = doc.offers.mi!.offeredModifiers[1]!;
  if (a.kind !== "extras") throw Error("fixture");
  a.maxPicks = 0;
  const before = structuredClone(doc);
  const { el } = await mount(doc);
  await el.reveal(target());
  expect(q(el, '[data-modifier="a"]').textContent).toContain("At most 0");
  expect(q(el, '[data-modifier="a"]').textContent).toContain("Saved choices exceed limits");
  expect((await nativeInput(el, 'wt-number-stepper[data-list="a"]')).value).toBe("1");
  q(el, '[data-option="well"]').click();
  await el.updateComplete;
  expect(q(el, '[data-option="well"]').getAttribute("aria-pressed")).toBe("true");
  expect(doc).toEqual(before);
});
it("distinguishes unknown allergens and pending diet from reviewed empty declarations", async () => {
  const doc = fixture();
  doc.offers.mi!.variants = [];
  doc.offers.mi!.allergens = null;
  const { el } = await mount(doc);
  await el.reveal(target());
  expect(q(el, "[data-detail]").textContent).toContain("Allergens unknown");
  expect(q(el, "[data-detail]").textContent).toContain("Diet unknown");
  expect(q(el, "[data-detail]").textContent).not.toContain("No declared allergens");
  const next = structuredClone(doc);
  next.offers.mi!.allergens = {};
  el.document = next;
  await el.reveal(target());
  expect(q(el, "[data-detail]").textContent).toContain("No declared allergens");
});
it("renders presence and source and ordering as an inspection fact", async () => {
  const { el } = await mount();
  await el.reveal(target());
  expect(q(el, "[data-detail]").textContent).toContain("May contain milk (cream)");
  expect(q(el, "[data-detail]").textContent).toContain("Standalone ordering");
  expect(q(el, "[data-detail]").textContent).toContain("staff_only");
});
it("keeps the name and detail accessible after image failure", async () => {
  const doc = fixture();
  doc.offers.mi!.variants = [];
  const { el } = await mount(doc);
  await el.reveal(target());
  const img = q<HTMLImageElement>(el, "[data-detail] img");
  expect(img.getAttribute("src")).toBe("/media/lemon%20slice.jpg");
  expect(img.alt).toBe("");
  img.dispatchEvent(new Event("error"));
  expect(img.hidden).toBe(true);
  expect(q(el, "[data-detail]").textContent).toContain("House burger");
  expect(await el.reveal(target({ field: { kind: "image" } }))).toBe(true);
  expect(destination(el, target({ field: { kind: "image" } }))).toBe(el.shadowRoot!.activeElement);
});
it("focuses exact nested fields including missing text without a name-based selector", async () => {
  const { el } = await mount();
  const t = target({
    sectionIds: ["included", "drinks"],
    listId: "b",
    extraProductId: "lemon",
    field: { kind: "portion" },
  });
  expect(await el.reveal(t)).toBe(true);
  expect(destination(el, t)).toBe(el.shadowRoot!.activeElement);
  expect(destination(el, t).textContent).toContain("0.12345");
  const missing = target({ field: { kind: "description", language: "fr" } });
  expect(await el.reveal(missing)).toBe(true);
  expect(destination(el, missing).textContent).toContain("No value");
});
it("refuses an unresolved identity with a named explanation and resets local choices on snapshot replacement", async () => {
  const { el } = await mount();
  expect(await el.reveal(target({ listId: "wrong", extraProductId: "lemon" }))).toBe(false);
  expect(el.shadowRoot!.textContent).toContain("Target unavailable");
  await el.reveal(target());
  q(el, '[data-option="well"]').click();
  await el.updateComplete;
  el.document = structuredClone(fixture());
  await el.reveal(target());
  expect(q(el, '[data-option="rare"]').getAttribute("aria-pressed")).toBe("true");
});
it("returns keyboard focus to the exact product opener after Back", async () => {
  const { el } = await mount();
  await el.reveal({ kind: "section", sectionIds: ["drinks"], field: { kind: "summary" } });
  const opener = q<HTMLButtonElement>(el, "button[data-product-open]");
  opener.click();
  await el.updateComplete;
  q(el, "button[data-back]").click();
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(opener);
  expect(el.shadowRoot!.querySelector("[data-detail]")).toBeNull();
});
it("paints detail chrome with theme tokens", async () => {
  const { el, host } = await mount();
  host.style.setProperty("--wt-color-surface", "rgb(12, 34, 56)");
  await el.reveal(target());
  expect(getComputedStyle(q(el, "[data-detail]")).backgroundColor).toBe("rgb(12, 34, 56)");
});

it("shows units beside summary prices and focuses the dish's effective price even with variants", async () => {
  const { el } = await mount();
  await el.reveal({ kind: "section", sectionIds: ["drinks"], field: { kind: "summary" } });
  expect(q(el, "button[data-product-open]").textContent).toContain("ea");
  const priceTarget = target({ field: { kind: "price" } });
  expect(await el.reveal(priceTarget)).toBe(true);
  expect(destination(el, priceTarget).textContent).toContain("3.50");
});
it.each(["a", "cook"])("focuses the exact modifier members group %s", async (listId) => {
  const { el } = await mount();
  const group = target({ listId, field: { kind: "members" } });
  expect(await el.reveal(group)).toBe(true);
  expect(destination(el, group)).toBe(el.shadowRoot!.activeElement);
  expect(destination(el, group).textContent).toContain(listId === "a" ? "Lemon" : "Rare");
});
it("uses a validated colour only when a thumbnail is absent", async () => {
  const doc = fixture();
  doc.offers.mi!.image = null;
  doc.offers.mi!.color = "#b3261e";
  const { el } = await mount(doc);
  await el.reveal({ kind: "section", sectionIds: ["drinks"], field: { kind: "summary" } });
  const swatch = q(el, "button[data-product-open] .image");
  expect(getComputedStyle(swatch).backgroundColor).toBe("rgb(179, 38, 30)");
  const next = structuredClone(doc);
  next.offers.mi!.color = "not-a-color";
  el.document = next;
  await el.reveal({ kind: "section", sectionIds: ["drinks"], field: { kind: "summary" } });
  expect(
    q(el, "button[data-product-open] .image").style.getPropertyValue("--menu-image-fill"),
  ).toBe("");
});
it("keeps source data unchanged through all local inspection selections", async () => {
  const doc = fixture();
  const before = structuredClone(doc);
  const { el } = await mount(doc);
  await el.reveal(target());
  q(el, '[data-variant="large"]').click();
  q(el, '[data-option="well"]').click();
  q(el, 'wt-number-stepper[data-list="b"]').dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "2" } }),
  );
  await el.updateComplete;
  el.view = { kind: "customer", language: "es" };
  await el.reveal(
    target({
      sectionIds: ["included", "drinks"],
      listId: "b",
      extraProductId: "lemon",
      field: { kind: "maxQuantity" },
    }),
  );
  expect(doc).toEqual(before);
});

it("does not pretend missing descriptions or kitchen names are customer content", async () => {
  const doc = fixture();
  doc.offers.mi!.description = null;
  const { el } = await mount(doc);
  await el.reveal(target());
  expect(q(el, "[data-detail]").textContent).not.toContain("Description");
  expect(q(el, "[data-detail]").textContent).not.toContain("COCINA");
  const description = target({ field: { kind: "description", language: "en" } });
  await el.reveal(description);
  expect(destination(el, description).textContent).toContain("No value");
});
it("selects the exact variant and parent image destinations separately", async () => {
  const { el } = await mount();
  const variant = target({ variantId: "small", field: { kind: "image" } });
  await el.reveal(variant);
  expect(destination(el, variant).querySelector("img")!.getAttribute("src")).toBe(
    "/media/small.jpg",
  );
  const parent = target({ field: { kind: "image" } });
  await el.reveal(parent);
  expect(destination(el, parent).querySelector("img")!.getAttribute("src")).toBe(
    "/media/lemon%20slice.jpg",
  );
});
it("marks the addressed changed value with text and an outline", async () => {
  const { el } = await mount();
  const changed = target({ listId: "b", extraProductId: "lemon", field: { kind: "portion" } });
  el.highlighted = [changed];
  await el.reveal(changed);
  expect(destination(el, changed).textContent).toContain("Changed");
  expect(getComputedStyle(destination(el, changed)).outlineStyle).toBe("solid");
});
it("keeps zero, invalid and fractional input within local whole-pick limits", async () => {
  const { el } = await mount();
  await el.reveal(target());
  const stepper = q(el, 'wt-number-stepper[data-list="b"]');
  for (const [value, want] of [
    ["1.9", "1"],
    ["NaN", "1"],
    ["-4", "0"],
    ["", "0"],
  ]) {
    stepper.dispatchEvent(new CustomEvent("wt-change", { detail: { value } }));
    await el.updateComplete;
    expect((await nativeInput(el, 'wt-number-stepper[data-list="b"]')).value).toBe(want);
  }
});

it.each([
  [{ kind: "name", audience: "staff" }, "Counter drinks"],
  [{ kind: "name", audience: "customer", language: "es" }, "Counter drinks para clientes"],
  [{ kind: "color" }, "No value"],
] as const)("reveals the exact section inspection field %j", async (field, want) => {
  const { el } = await mount();
  const address: MenuTarget = { kind: "section", sectionIds: ["included", "drinks"], field };
  expect(await el.reveal(address)).toBe(true);
  expect(destination(el, address).textContent).toContain(want);
  expect(destination(el, address)).toBe(el.shadowRoot!.activeElement);
});
it.each([
  [{ field: { kind: "name", audience: "staff" } }, "Counter burger"],
  [{ field: { kind: "name", audience: "kitchen" } }, "BURGER"],
  [{ field: { kind: "name", audience: "customer", language: "es" } }, "Hamburguesa"],
  [{ field: { kind: "name", audience: "customer", language: "fr" } }, "No value"],
  [{ field: { kind: "override" } }, "99.00"],
  [{ field: { kind: "vat" } }, "reduced"],
  [{ field: { kind: "color" } }, "No value"],
  [{ variantId: "large", field: { kind: "override" } }, "100.00"],
  [{ variantId: "small", field: { kind: "override" } }, "No value"],
  [{ listId: "a", extraProductId: "lemon", field: { kind: "name", audience: "kitchen" } }, "LEMON"],
  [
    { listId: "cook", optionLabelId: "rare", field: { kind: "name", audience: "staff" } },
    "Counter rare",
  ],
] satisfies [Partial<Extract<MenuTarget, { kind: "product" }>>, string][])(
  "reveals stored inspection field %j",
  async (extra, want) => {
    const { el } = await mount();
    const address = target(extra);
    expect(await el.reveal(address)).toBe(true);
    expect(destination(el, address).textContent).toContain(want);
    expect(destination(el, address)).toBe(el.shadowRoot!.activeElement);
  },
);
it.each([
  { kind: "title", menuId: "wrong" },
  { kind: "home", device: "handheld", field: "columns" },
  { kind: "section", sectionIds: ["missing"], field: { kind: "summary" } },
  { kind: "list", sectionIds: ["missing"] },
  target({ sectionIds: ["drinks"], productId: "wrong" }),
  target({ variantId: "missing" }),
  target({ listId: "cook", extraProductId: "lemon" }),
  target({ listId: "cook", optionLabelId: "missing" }),
  target({ listId: "a", optionLabelId: "rare" }),
  target({ extraProductId: "lemon" }),
] satisfies MenuTarget[])(
  "refuses unresolved target %j without replacing the snapshot",
  async (address) => {
    const doc = fixture();
    const before = structuredClone(doc);
    const { el } = await mount(doc);
    expect(await el.reveal(address)).toBe(false);
    expect(el.shadowRoot!.textContent).toContain("Target unavailable");
    expect(doc).toEqual(before);
  },
);
it("opens and collapses section lists through their real buttons", async () => {
  const { el } = await mount();
  const button = q<HTMLButtonElement>(el, "button[aria-expanded]");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  button.click();
  await el.updateComplete;
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(q(el, "button[data-product-open]").textContent).toContain("House burger");
  button.click();
  await el.updateComplete;
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(el.shadowRoot!.querySelector("button[data-product-open]")).toBeNull();
});

it("marks a changed modifier member list at its focus destination", async () => {
  const { el } = await mount();
  const changed = target({ listId: "a", field: { kind: "members" } });
  el.highlighted = [changed];
  await el.reveal(changed);
  expect(destination(el, changed).textContent).toContain("Changed");
  expect(destination(el, changed).hasAttribute("data-highlighted")).toBe(true);
});

it("ignores detached inspection controls after a snapshot has replaced their owner", async () => {
  const { el } = await mount();
  await el.reveal(target());
  const oldOption = q(el, '[data-option="well"]');
  const oldVariant = q(el, '[data-variant="large"]');
  const oldPick = q(el, 'wt-number-stepper[data-list="b"]');
  el.document = structuredClone(fixture());
  await el.reveal(target());
  oldOption.click();
  oldVariant.click();
  oldPick.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "2" } }));
  await el.updateComplete;
  expect(q(el, '[data-option="rare"]').getAttribute("aria-pressed")).toBe("true");
  expect(q(el, '[data-variant="small"]').getAttribute("aria-pressed")).toBe("true");
  expect((await nativeInput(el, 'wt-number-stepper[data-list="b"]')).value).toBe("0");
});
it("focuses root and nested lists and the frozen title", async () => {
  const { el } = await mount();
  for (const address of [
    { kind: "title", menuId: "menu-lunch" },
    { kind: "list", sectionIds: [] },
    { kind: "list", sectionIds: ["included", "drinks"] },
  ] satisfies MenuTarget[]) {
    expect(await el.reveal(address)).toBe(true);
    expect(destination(el, address)).toBe(el.shadowRoot!.activeElement);
  }
});
it("renders the effective dish price without variants and accepts no default option", async () => {
  const doc = fixture();
  doc.offers.mi!.variants = [];
  const options = doc.offers.mi!.offeredModifiers[0]!;
  if (options.kind !== "options") throw Error("fixture");
  options.defaultLabelId = null;
  doc.offers.mi!.diet = null;
  doc.offers.mi!.allergens = { milk: { presence: "contains" } };
  const { el } = await mount(doc);
  await el.reveal(target());
  expect(q(el, "[data-detail] [data-field=price]").textContent).toContain("3.50");
  expect(q(el, "[data-detail]").textContent).toContain("Contains milk");
  expect(q(el, '[data-option="rare"]').getAttribute("aria-pressed")).toBe("false");
  expect(q(el, '[data-modifier="cook"] [data-field="default"]').textContent).toContain("No value");
});
it("offers unlimited extra counts when both item and list have no cap", async () => {
  const doc = fixture();
  const b = doc.offers.mi!.offeredModifiers[2]!;
  if (b.kind !== "extras") throw Error("fixture");
  b.items[0]!.maxQuantity = null;
  b.items[0]!.suitableFor = ["vegan"];
  const { el } = await mount(doc);
  await el.reveal(target());
  q(el, 'wt-number-stepper[data-list="b"]').dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "20" } }),
  );
  await el.updateComplete;
  expect((await nativeInput(el, 'wt-number-stepper[data-list="b"]')).value).toBe("20");
  expect(q(el, '[data-modifier="b"]').textContent).toContain("vegan");
});

it("keeps a partial document navigable and cuts only the current section cycle", async () => {
  const repeated = documentSection("loop", "Loop", [
    documentSection("loop", "Loop repeated", [documentProduct("unreachable", "hidden")]),
  ]);
  const doc = menuDocument([repeated, documentProduct("missing", "missing")], {
    hidden: "Hidden",
    missing: "Missing",
  });
  delete doc.offers.missing;
  const { el } = await mount(doc);
  await el.reveal({ kind: "section", sectionIds: ["loop"], field: { kind: "summary" } });
  expect(el.shadowRoot!.querySelectorAll("[data-section]")).toHaveLength(1);
  expect(el.shadowRoot!.textContent).not.toContain("Hidden");
  expect(
    await el.reveal(target({ sectionIds: [], menuItemId: "missing", productId: "missing" })),
  ).toBe(false);
});
it("reports a missing field destination and remains usable afterwards", async () => {
  const { el } = await mount();
  expect(await el.reveal(target({ field: { kind: "portion" } }))).toBe(false);
  expect(el.shadowRoot!.textContent).toContain("Target unavailable");
  expect(await el.reveal(target())).toBe(true);
  expect(el.shadowRoot!.textContent).not.toContain("Target unavailable");
});
it("renders unknown fields with named fallbacks and exposes the frozen contains tags", async () => {
  const doc = fixture();
  doc.offers.mi!.variants = [];
  doc.offers.mi!.unit.abbreviation = {};
  doc.offers.mi!.diet = { vegan: "no", vegetarian: "no", contains: ["meat"] };
  doc.offers.mi!.dietDerivation = null;
  doc.offers.mi!.dietaryDeclarations = [];
  doc.offers.mi!.customerName = {};
  const { el } = await mount(doc);
  await el.reveal(target());
  expect(q(el, "[data-detail]").textContent).toContain("Counter burger");
  expect(q(el, "[data-detail] [data-field=unit]").textContent).toContain("No value");
  expect(q(el, "[data-detail] [data-field=diet]").textContent).toContain("meat");
});
it("supports its default inspection adapter and an empty initial snapshot", async () => {
  const { el } = await mountWidget<CustomerMenu>("dashboard-customer-menu", {});
  expect(el.shadowRoot!.textContent).toBe("");
  expect(await el.reveal(target())).toBe(false);
  el.document = fixture();
  await el.reveal(target());
  expect(q(el, "[data-detail]").textContent).toContain("House burger");
  expect(q<HTMLImageElement>(el, "[data-detail] img").getAttribute("src")).toBe("small.jpg");
});
it("opens a product through native Enter and Space without trapping keyboard focus", async () => {
  const { el } = await mount();
  await el.reveal({ kind: "section", sectionIds: ["drinks"], field: { kind: "summary" } });
  const opener = q<HTMLButtonElement>(el, "button[data-product-open]");
  for (const key of ["{Enter}", " "]) {
    opener.focus();
    await userEvent.keyboard(key);
    await el.updateComplete;
    expect(q(el, "[data-detail]").textContent).toContain("House burger");
    q(el, "button[data-back]").click();
    await el.updateComplete;
    expect(el.shadowRoot!.activeElement).toBe(opener);
  }
});

const sizes = ["en", "es"].flatMap((language) =>
  ["light", "dark"].flatMap((theme) =>
    [390, 1280].map((width) => ({ language, theme: theme as "light" | "dark", width })),
  ),
);
it.each(sizes)(
  "keeps actual $width px $language $theme inspection inside its viewport",
  async ({ language, theme, width }) => {
    await page.viewport(width, 850);
    expect(window.innerWidth).toBe(width);
    const doc = fixture();
    doc.menuName = "AReallyLongUnbrokenFrozenMenuTitle".repeat(5);
    const { el, host } = await mount(doc, theme);
    host.style.width = "100%";
    el.view = { kind: "customer", language };
    await el.reveal(target({ listId: "b", extraProductId: "lemon", field: { kind: "portion" } }));
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    expect(q(el, "[data-detail]").getBoundingClientRect().right).toBeLessThanOrEqual(width);
    await page.viewport(414, 850);
  },
);

it("lets the injected interface adapter format every frozen price without recomputing it", async () => {
  const doc = fixture();
  const before = structuredClone(doc);
  const { el } = await mount(doc);
  el.label = (key, values) =>
    key === "amount" ? `${values!.amount!.replace(".", ",")} €` : label(key, values);
  await el.reveal(target());
  expect(q(el, "[data-detail] [data-field=price]").textContent).toContain("0,00 €");
  expect(q(el, "button[data-product-open]").textContent).toContain("0,00 € – 10,00 €");
  expect(q(el, '[data-modifier="b"]').textContent).toContain("2,75 €");
  expect(q(el, '[data-variant="large"]').textContent).toContain("10,00 €");
  expect(doc).toEqual(before);
});
it("paints an absent thumbnail with the neutral background", async () => {
  const doc = fixture();
  doc.offers.mi!.image = null;
  const { el, host } = await mount(doc);
  await el.reveal({ kind: "section", sectionIds: ["drinks"], field: { kind: "summary" } });
  expect(getComputedStyle(q(el, "button[data-product-open] .image")).backgroundColor).toBe(
    getComputedStyle(host).backgroundColor,
  );
});
it("explains a stored zero item cap even when the list itself is uncapped", async () => {
  const doc = fixture();
  const b = doc.offers.mi!.offeredModifiers[2]!;
  if (b.kind !== "extras") throw Error("fixture");
  b.items[0]!.maxQuantity = 0;
  b.items[0]!.preselected = true;
  const { el } = await mount(doc);
  await el.reveal(target());
  expect(q(el, '[data-modifier="b"]').textContent).toContain("Saved choices exceed limits");
  expect((await nativeInput(el, 'wt-number-stepper[data-list="b"]')).value).toBe("1");
});
it("names an absent kitchen value and defaults an omitted translation target language", async () => {
  const { el } = await mount();
  const kitchen = target({ listId: "b", field: { kind: "name", audience: "kitchen" } });
  el.document!.offers.mi!.offeredModifiers[2]!.kitchenName = null;
  await el.reveal(kitchen);
  expect(destination(el, kitchen).textContent).toContain("No value");
  const name = target({ field: { kind: "name", audience: "customer" } });
  await el.reveal(name);
  expect(destination(el, name).textContent).toContain("House burger");
});

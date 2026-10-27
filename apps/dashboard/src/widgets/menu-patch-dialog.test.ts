import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { chooseOption } from "@waitron/ui/src/test-helpers.js";
import type {
  FrozenExtraItem,
  FrozenOfferVariant,
  MenuDocument,
} from "@waitron/catalogue/src/menu-document-types.js";
import "./menu-patch-dialog.js";
import type { MenuPatchDialog } from "./menu-patch-dialog.js";
import type { DashboardApi, LiveMenu } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";

const savedLanguages = currentContentLanguages();

beforeEach(() => {
  setLocale("en");
  setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
});
afterEach(() => {
  setLocale("es-ES");
  setContentLanguages(savedLanguages);
  cleanupWidgets();
});

function variant(id: string, name: string): FrozenOfferVariant {
  return {
    id,
    name,
    customerName: null,
    kitchenName: null,
    image: null,
    unitPrice: "2.00",
    menuPrice: null,
    unit: {} as FrozenOfferVariant["unit"],
    pricingUnit: {} as FrozenOfferVariant["pricingUnit"],
    vatClass: "reduced",
    allergens: null,
    diet: null,
    dietDerivation: null,
    dietOverride: null,
    dietaryDeclarations: [],
  };
}

function extra(productId: string, name: string): FrozenExtraItem {
  return {
    productId,
    presentation: {} as FrozenExtraItem["presentation"],
    portion: "1",
    unit: {} as FrozenExtraItem["unit"],
    name,
    customerName: null,
    kitchenName: null,
    price: "1.00",
    vatClass: "reduced",
    maxQuantity: null,
    preselected: false,
    addAllergens: null,
    suitableFor: [],
    image: null,
  };
}

/** Starters [Soup, Salad], Drinks [Lemonade with Small and Large]; Soup offers Toppings [Bread]. */
function lunch(soupName = "Soup"): MenuDocument {
  const document = menuDocument(
    [
      documentSection("sec-starters", "Starters", [
        documentProduct("mi-soup", "p-soup"),
        documentProduct("mi-salad", "p-salad"),
      ]),
      documentSection("sec-drinks", "Drinks", [documentProduct("mi-lemonade", "p-lemonade")]),
    ],
    { "p-soup": soupName, "p-salad": "Salad", "p-lemonade": "Lemonade" },
  );
  document.offers["mi-lemonade"]!.variants = [
    variant("v-small", "Small"),
    variant("v-large", "Large"),
  ];
  document.offers["mi-soup"]!.offeredModifiers = [
    {
      kind: "extras",
      id: "l-toppings",
      name: "Toppings",
      customerName: null,
      kitchenName: null,
      minPicks: 0,
      maxPicks: null,
      items: [extra("p-bread", "Bread")],
    },
  ];
  return document;
}

function live(number = 3, document = lunch()): LiveMenu {
  return { versionId: `v-${number}`, number, since: "2026-10-27T09:00:00.000Z", document };
}

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
  return {
    getLiveMenu: vi.fn(async () => live()),
    imageLibraryRequest: vi.fn(),
    ...overrides,
  } as unknown as DashboardApi & { getLiveMenu: ReturnType<typeof vi.fn> };
}

async function flush(el: MenuPatchDialog): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
}

async function mount(api: DashboardApi = stubApi()): Promise<MenuPatchDialog> {
  const { el } = await mountWidget<MenuPatchDialog>("dashboard-menu-patch-dialog", {
    api,
    menuId: "menu-lunch",
    menuName: "Lunch Menu",
    open: true,
  });
  await flush(el);
  return el;
}

const modal = (el: MenuPatchDialog) => el.shadowRoot!.querySelector("wt-modal")!;

const nodes = (el: MenuPatchDialog) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-test="tree"] button'),
];

const treeLabels = (el: MenuPatchDialog) =>
  [...el.shadowRoot!.querySelectorAll('[data-test="tree"] [data-test="label"]')].map((label) =>
    label.textContent!.trim(),
  );

function node(el: MenuPatchDialog, label: string): HTMLButtonElement {
  const found = nodes(el).find(
    (button) => button.querySelector('[data-test="label"]')!.textContent!.trim() === label,
  );
  if (found === undefined) throw new Error(`no tree item ${label}`);
  return found;
}

async function pick(el: MenuPatchDialog, label: string): Promise<void> {
  node(el, label).click();
  await el.updateComplete;
}

const form = (el: MenuPatchDialog) => el.shadowRoot!.querySelector('[data-test="form"]')!;

/** Each field in the form, by its input name; the picture by its element. */
const fieldNames = (el: MenuPatchDialog) =>
  [
    ...form(el).querySelectorAll("wt-input, wt-price-input, wt-combobox, dashboard-image-upload"),
  ].map((field) => field.getAttribute("name") ?? field.localName);

function field<K extends "wt-input" | "wt-price-input">(el: MenuPatchDialog, tag: K, name: string) {
  return el.shadowRoot!.querySelector<HTMLElementTagNameMap[K]>(`${tag}[name="${name}"]`)!;
}

async function type(
  el: MenuPatchDialog,
  tag: "wt-input" | "wt-price-input",
  name: string,
  value: string,
): Promise<void> {
  const host = field(el, tag, name);
  await userEvent.fill(page.elementLocator(host.shadowRoot!.querySelector("input")!), value);
  await el.updateComplete;
}

const changedDot = (el: MenuPatchDialog, label: string) =>
  node(el, label).querySelector('[data-test="changed"]');

const soup = { kind: "offer", menuItemId: "mi-soup" } as const;

it("names the live version's number and the menu in its heading", async () => {
  const el = await mount();
  expect(modal(el).open).toBe(true);
  expect(modal(el).heading).toBe("Patch version 3 of Lunch Menu");
});

it("lists the menu with each dish's variants, then the extras and options", async () => {
  const el = await mount();
  expect(treeLabels(el)).toEqual([
    "Starters",
    "Soup",
    "Salad",
    "Drinks",
    "Lemonade",
    "Small",
    "Large",
    "Extras and options",
    "Toppings",
    "Bread",
  ]);
  // The group is a heading, not an item to pick.
  expect(nodes(el).map((button) => button.textContent!.trim())).not.toContain("Extras and options");
});

it("narrows the tree to the items whose name matches the search, keeping their place", async () => {
  const el = await mount();
  await type(el, "wt-input", "search", "LEMON");
  expect(treeLabels(el)).toEqual(["Drinks", "Lemonade", "Small", "Large"]);
  await type(el, "wt-input", "search", "bre");
  expect(treeLabels(el)).toEqual(["Extras and options", "Toppings", "Bread"]);
  await type(el, "wt-input", "search", "nothing like it");
  expect(treeLabels(el)).toEqual([]);
  expect(el.shadowRoot!.querySelector('[data-test="no-matches"]')!.textContent!.trim()).toBe(
    "No items match the search.",
  );
});

it("finds a name whatever its accents", async () => {
  const el = await mount(
    stubApi({ getLiveMenu: vi.fn(async () => live(3, lunch("Sopa de calabacín"))) }),
  );
  await type(el, "wt-input", "search", "calabacin");
  expect(treeLabels(el)).toEqual(["Starters", "Sopa de calabacín"]);
});

it("asks for an item to be picked before showing any form", async () => {
  const el = await mount();
  expect(form(el)).toBeNull();
  expect(el.shadowRoot!.querySelector('[data-test="pick-prompt"]')!.textContent!.trim()).toBe(
    "Pick an item to patch.",
  );
});

it("shows a dish's patchable fields and nothing else, in every content language", async () => {
  const el = await mount();
  await pick(el, "Soup");
  expect(form(el).querySelector("h3")!.textContent!.trim()).toBe("Soup");
  expect(fieldNames(el)).toEqual([
    "name",
    "customer-name-en",
    "customer-name-es",
    "kitchen-name",
    "description-en",
    "description-es",
    "dashboard-image-upload",
    "price",
    "tax",
  ]);
  expect(field(el, "wt-input", "name").value).toBe("Soup");
  expect(field(el, "wt-input", "name").required).toBe(true);
  expect(field(el, "wt-input", "customer-name-es").value).toBe("Soup para clientes");
  expect(field(el, "wt-input", "kitchen-name").value).toBe("SOUP COCINA");
  expect(field(el, "wt-price-input", "price").value).toBe("3.00");
  expect(form(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox")!.value).toBe(
    "reduced",
  );
  expect(node(el, "Soup").getAttribute("aria-current")).toBe("true");
  expect(node(el, "Salad").hasAttribute("aria-current")).toBe(false);
  expect(form(el).querySelector('[data-test="variants-note"]')).toBeNull();
});

it("shows a section's internal name, customer names and picture", async () => {
  const el = await mount();
  await pick(el, "Drinks");
  expect(fieldNames(el)).toEqual([
    "internal-name",
    "names-en",
    "names-es",
    "dashboard-image-upload",
  ]);
  expect(field(el, "wt-input", "internal-name").required).toBe(true);
  expect(field(el, "wt-input", "names-es").value).toBe("Drinks para clientes");
});

it("marks an item changed when its price is edited, and unmarks it when set back", async () => {
  const el = await mount();
  await pick(el, "Soup");
  expect(changedDot(el, "Soup")).toBeNull();
  await type(el, "wt-price-input", "price", "3.5");
  expect(changedDot(el, "Soup")).not.toBeNull();
  expect(changedDot(el, "Salad")).toBeNull();
  expect(el.changes).toEqual([{ target: soup, field: "price", value: "3.50" }]);
  await type(el, "wt-price-input", "price", "3");
  expect(changedDot(el, "Soup")).toBeNull();
  expect(el.changes).toEqual([]);
});

it("reads a price as the Spanish dashboard writes it", async () => {
  setLocale("es");
  const el = await mount();
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "5,5");
  expect(el.changes).toEqual([{ target: soup, field: "price", value: "5.50" }]);
});

it("stages a translated name as every content language's text", async () => {
  const el = await mount();
  await pick(el, "Soup");
  await type(el, "wt-input", "customer-name-en", "Daily soup");
  expect(el.changes).toEqual([
    {
      target: soup,
      field: "customerName",
      value: { en: "Daily soup", es: "Soup para clientes" },
    },
  ]);
});

it("stages a kitchen name, a VAT class and a picture", async () => {
  const el = await mount();
  await pick(el, "Soup");
  await type(el, "wt-input", "kitchen-name", "SOPA");
  await chooseOption(form(el).querySelector("wt-combobox")!, "general");
  form(el)
    .querySelector("dashboard-image-upload")!
    .dispatchEvent(
      new CustomEvent("image-changed", {
        detail: { image: "media:soup" },
        bubbles: true,
        composed: true,
      }),
    );
  await el.updateComplete;
  expect(el.changes).toEqual([
    { target: soup, field: "kitchenName", value: "SOPA" },
    { target: soup, field: "vatClass", value: "general" },
    { target: soup, field: "image", value: "media:soup" },
  ]);
  expect(form(el).querySelector("dashboard-image-upload")!.image).toBe("media:soup");
});

it("hands the picture chooser the venue's image library and no more", async () => {
  const api = stubApi();
  const el = await mount(api);
  await pick(el, "Soup");
  const upload = form(el).querySelector("dashboard-image-upload")!;
  expect(upload.api).toEqual({ imageLibraryRequest: api.imageLibraryRequest });
});

it("shows a blank staff name's error under the field and stages nothing", async () => {
  const el = await mount();
  await pick(el, "Soup");
  await type(el, "wt-input", "name", "Broth");
  expect(el.changes).toHaveLength(1);
  await type(el, "wt-input", "name", "  ");
  expect(field(el, "wt-input", "name").error).toBe("Enter a name.");
  expect(field(el, "wt-input", "name").value).toBe("  ");
  expect(el.changes).toEqual([]);
  expect(changedDot(el, "Soup")).toBeNull();
  await type(el, "wt-input", "name", "Broth");
  expect(field(el, "wt-input", "name").error).toBe("");
});

it("shows a blank section name's error under the field", async () => {
  const el = await mount();
  await pick(el, "Drinks");
  await type(el, "wt-input", "internal-name", "");
  expect(field(el, "wt-input", "internal-name").error).toBe("Enter an internal name.");
  expect(el.changes).toEqual([]);
});

it("shows a price the patch refuses under the field", async () => {
  const el = await mount();
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "3.555");
  expect(field(el, "wt-price-input", "price").error).toBe(
    "Enter a nonnegative price with at most two decimal places.",
  );
  expect(el.changes).toEqual([]);
});

it("shows a translated name the patch refuses under the language that breaks it", async () => {
  const el = await mount();
  await pick(el, "Soup");
  await type(el, "wt-input", "customer-name-es", "x".repeat(4097));
  expect(field(el, "wt-input", "customer-name-es").error).toBe(
    codeMessage("content.translation_invalid"),
  );
  expect(field(el, "wt-input", "customer-name-en").error).toBe("");
  expect(el.changes).toEqual([]);
});

it("shows a VAT class the patch refuses under the field", async () => {
  const el = await mount();
  await pick(el, "Soup");
  const tax = form(el).querySelector("wt-combobox")!;
  await chooseOption(tax, "standard");
  await el.updateComplete;
  expect(tax.error).toBe("Check this value.");
  expect(el.changes).toEqual([]);
});

it("stays open when a dialog inside it closes", async () => {
  const el = await mount();
  await pick(el, "Soup");
  form(el)
    .querySelector("dashboard-image-upload")!
    .dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(el.open).toBe(true);
  expect(modal(el).open).toBe(true);
});

it("lists a dish's variants as links that pick them, and says it sells through them", async () => {
  const el = await mount();
  await pick(el, "Lemonade");
  expect(form(el).querySelector('[data-test="variants-note"]')!.textContent!.trim()).toBe(
    "Sold through its variants: the till charges each variant's own price and VAT class.",
  );
  const links = [...form(el).querySelectorAll<HTMLElement>('[data-test="variant-link"]')];
  expect(links.map((link) => link.textContent!.trim())).toEqual(["Small", "Large"]);
  links[1]!.click();
  await el.updateComplete;
  expect(form(el).querySelector("h3")!.textContent!.trim()).toBe("Large");
  expect(node(el, "Large").getAttribute("aria-current")).toBe("true");
  expect(fieldNames(el)).toEqual([
    "name",
    "customer-name-en",
    "customer-name-es",
    "kitchen-name",
    "dashboard-image-upload",
    "price",
    "tax",
  ]);
  expect(form(el).querySelector('[data-test="variants-note"]')).toBeNull();
});

it("shows only a list's three name fields", async () => {
  const el = await mount();
  await pick(el, "Toppings");
  expect(fieldNames(el)).toEqual(["name", "customer-name-en", "customer-name-es", "kitchen-name"]);
  await type(el, "wt-input", "name", "Add-ons");
  expect(el.changes).toEqual([
    {
      target: { kind: "list", listKind: "extras", listId: "l-toppings" },
      field: "name",
      value: "Add-ons",
    },
  ]);
});

it("leaves out a field no copy of the section takes", async () => {
  const document = lunch();
  const drinks = document.root.members[1] as Extract<
    MenuDocument["root"]["members"][number],
    { kind: "section" }
  >;
  drinks.fixed = { image: null };
  const el = await mount(stubApi({ getLiveMenu: vi.fn(async () => live(3, document)) }));
  await pick(el, "Drinks");
  expect(fieldNames(el)).toEqual(["internal-name", "names-en", "names-es"]);
});

it("keeps staged changes and what is being typed when a newer live version arrives", async () => {
  const data = new LiveData();
  const getLiveMenu = vi
    .fn()
    .mockResolvedValueOnce(live(3))
    .mockResolvedValueOnce(live(4, lunch("Broth")));
  const el = await mount(stubApi({ liveData: data, getLiveMenu }));
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await pick(el, "Salad");
  await type(el, "wt-input", "name", "");
  data.invalidate([{ type: "menu_versions", id: "v-4" }]);
  await vi.waitFor(() => expect(modal(el).heading).toBe("Patch version 4 of Lunch Menu"));
  expect(treeLabels(el)).toContain("Broth");
  expect(changedDot(el, "Broth")).not.toBeNull();
  expect(el.changes).toEqual([{ target: soup, field: "price", value: "4.00" }]);
  expect(field(el, "wt-input", "name").value).toBe("");
  expect(field(el, "wt-input", "name").error).toBe("Enter a name.");
});

it("shows a newer live value in a field set back to the live one", async () => {
  const data = new LiveData();
  const newer = lunch();
  newer.offers["mi-soup"]!.unitPrice = "3.50";
  const getLiveMenu = vi.fn().mockResolvedValueOnce(live(3)).mockResolvedValueOnce(live(4, newer));
  const el = await mount(stubApi({ liveData: data, getLiveMenu }));
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await type(el, "wt-price-input", "price", "3");
  data.invalidate([{ type: "menu_versions", id: "v-4" }]);
  await vi.waitFor(() => expect(modal(el).heading).toBe("Patch version 4 of Lunch Menu"));
  expect(field(el, "wt-price-input", "price").value).toBe("3.50");
  expect(el.changes).toEqual([]);
});

it("forgets the typing behind a change a newer version drops", async () => {
  const data = new LiveData();
  const newer = lunch();
  newer.offers["mi-soup"]!.offeredModifiers = [];
  const getLiveMenu = vi
    .fn()
    .mockResolvedValueOnce(live(3))
    .mockResolvedValueOnce(live(4, newer))
    .mockResolvedValueOnce(live(5));
  const el = await mount(stubApi({ liveData: data, getLiveMenu }));
  await pick(el, "Toppings");
  await type(el, "wt-input", "name", "Add-ons");
  await pick(el, "Soup");
  await type(el, "wt-input", "name", "Broth");
  data.invalidate([{ type: "menu_versions", id: "v-4" }]);
  await vi.waitFor(() => expect(modal(el).heading).toBe("Patch version 4 of Lunch Menu"));
  expect(el.changes).toEqual([{ target: soup, field: "name", value: "Broth" }]);
  expect(field(el, "wt-input", "name").value).toBe("Broth");
  expect(treeLabels(el)).not.toContain("Toppings");
  data.invalidate([{ type: "menu_versions", id: "v-5" }]);
  await vi.waitFor(() => expect(modal(el).heading).toBe("Patch version 5 of Lunch Menu"));
  await pick(el, "Toppings");
  expect(field(el, "wt-input", "name").value).toBe("Toppings");
});

it("keeps following the live menu, and its staged changes, when moved on the page", async () => {
  const data = new LiveData();
  const getLiveMenu = vi.fn().mockResolvedValueOnce(live(3)).mockResolvedValueOnce(live(4));
  const el = await mount(stubApi({ liveData: data, getLiveMenu }));
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  const parent = el.parentElement!;
  el.remove();
  parent.append(el);
  await flush(el);
  data.invalidate([{ type: "menu_versions", id: "v-4" }]);
  await vi.waitFor(() => expect(modal(el).heading).toBe("Patch version 4 of Lunch Menu"));
  expect(el.changes).toEqual([{ target: soup, field: "price", value: "4.00" }]);
});

it("gives the VAT field the same options on every redraw until the language changes", async () => {
  const el = await mount();
  await pick(el, "Soup");
  const tax = () => form(el).querySelector("wt-combobox")!;
  const first = tax().options;
  await type(el, "wt-input", "name", "Broth");
  expect(tax().options).toBe(first);
  setLocale("es");
  await el.updateComplete;
  expect(tax().options).not.toBe(first);
  expect(tax().options.map((option) => option.label)[1]).toContain("Reducido");
});

it("says so when the menu has never been published", async () => {
  const el = await mount(stubApi({ getLiveMenu: vi.fn(async () => null) }));
  expect(el.shadowRoot!.querySelector('[data-test="read-error"]')!.textContent).toContain(
    codeMessage("menu_patch.not_published"),
  );
  expect(el.shadowRoot!.querySelector('[data-test="tree"]')).toBeNull();
});

it("explains a failed read and reads again on Try again", async () => {
  const getLiveMenu = vi
    .fn()
    .mockRejectedValueOnce(new Error("the box is unreachable"))
    .mockResolvedValueOnce(live());
  const el = await mount(stubApi({ getLiveMenu }));
  const error = el.shadowRoot!.querySelector('[data-test="read-error"]')!;
  expect(error.textContent).toContain(codeMessage("server.internal"));
  error.querySelector("wt-button")!.click();
  await vi.waitFor(() => expect(treeLabels(el)).toContain("Soup"));
  expect(el.shadowRoot!.querySelector('[data-test="read-error"]')).toBeNull();
  expect(getLiveMenu).toHaveBeenCalledTimes(2);
});

it("reads nothing while closed, and starts afresh each time it opens", async () => {
  const api = stubApi();
  const { el } = await mountWidget<MenuPatchDialog>("dashboard-menu-patch-dialog", {
    api,
    menuId: "menu-lunch",
    menuName: "Lunch Menu",
  });
  await flush(el);
  expect(api.getLiveMenu).not.toHaveBeenCalled();
  expect(el.changes).toEqual([]);
  el.open = true;
  await flush(el);
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  modal(el).dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(el.open).toBe(false);
  el.open = true;
  await flush(el);
  expect(api.getLiveMenu).toHaveBeenCalledTimes(2);
  expect(el.changes).toEqual([]);
  expect(form(el)).toBeNull();
});

it("reads the menu it is given when that changes while open", async () => {
  const api = stubApi();
  const el = await mount(api);
  el.menuId = "menu-dinner";
  await flush(el);
  expect(api.getLiveMenu).toHaveBeenLastCalledWith("menu-dinner");
});

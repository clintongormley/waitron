import { LiveData } from "@waitron/dashboard-kit";
import { createLeaveCoordinator } from "@waitron/ui-core/unsaved-changes";
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
import type {
  DashboardApi,
  LiveMenu,
  MenuPatchResult,
  MenuPublicationsAnswer,
} from "../api/client.js";
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

function publications(
  ...editions: { date: string; time: string; state?: "queued" | "activated" | "cancelled" }[]
): MenuPublicationsAnswer {
  return {
    timeZone: "Europe/Madrid",
    live: null,
    editions: editions.map(({ state = "queued", ...local }, index) => ({
      versionId: `v-q${index}`,
      number: 10 + index,
      state,
      activatesAt: `${local.date}T07:00:00.000Z`,
      queuedAt: "2026-10-20T09:00:00.000Z",
      cancelledAt: null,
      local: { ...local, offset: "+01:00", repeated: false },
    })),
  } as MenuPublicationsAnswer;
}

const patched: MenuPatchResult = { versionId: "v-5", number: 5, requeued: [] };

function stubApi(overrides: Partial<Record<keyof DashboardApi, unknown>> = {}) {
  return {
    getLiveMenu: vi.fn(async () => live()),
    getMenuPublications: vi.fn(async () => publications()),
    patchLiveMenu: vi.fn(async () => patched),
    imageLibraryRequest: vi.fn(),
    ...overrides,
  } as unknown as DashboardApi & {
    getLiveMenu: ReturnType<typeof vi.fn>;
    patchLiveMenu: ReturnType<typeof vi.fn>;
  };
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

const footerButton = (el: MenuPatchDialog, name: string) =>
  el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    `wt-button[data-test="${name}"]`,
  );

const bottomMessage = (el: MenuPatchDialog) =>
  el.shadowRoot!.querySelector("wt-form-actions")!.error;

const reviewLines = (el: MenuPatchDialog) =>
  [...el.shadowRoot!.querySelectorAll('[data-test="review-line"]')].map((line) =>
    line.textContent!.trim(),
  );

const reviewNotes = (el: MenuPatchDialog) =>
  [...el.shadowRoot!.querySelectorAll('[data-test="review-note"]')].map((note) =>
    note.textContent!.trim(),
  );

async function press(el: MenuPatchDialog, name: string): Promise<void> {
  footerButton(el, name)!.click();
  await flush(el);
}

function refusal(code: string, params: Record<string, unknown>): Error {
  return Object.assign(new Error(code), { code, params });
}

it("keeps Review quiet and disabled until something is changed, and counts the changes", async () => {
  const el = await mount();
  const review = () => footerButton(el, "review")!;
  expect(review().disabled).toBe(true);
  expect(review().variant).toBe("secondary");
  expect(review().textContent!.trim()).toBe("Review 0 changes");
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  expect(review().disabled).toBe(false);
  expect(review().variant).toBe("primary");
  expect(review().textContent!.trim()).toBe("Review 1 change");
  await type(el, "wt-input", "name", "Broth");
  expect(review().textContent!.trim()).toBe("Review 2 changes");
  expect(bottomMessage(el)).toBe("");
});

it("keeps Review disabled while any field shows an error, even beside a staged change", async () => {
  const el = await mount();
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await pick(el, "Salad");
  await type(el, "wt-input", "name", "");
  expect(el.changes).toHaveLength(1);
  expect(footerButton(el, "review")!.disabled).toBe(true);
  expect(bottomMessage(el)).toBe("Correct the fields marked on Salad to continue.");
  footerButton(el, "review")!.click();
  await flush(el);
  expect(el.shadowRoot!.querySelector('[data-test="review-step"]')).toBeNull();
  await type(el, "wt-input", "name", "Green salad");
  expect(footerButton(el, "review")!.disabled).toBe(false);
  expect(bottomMessage(el)).toBe("");
});

it("reviews each change as old → new with the notes that always apply, then goes back", async () => {
  const el = await mount();
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "3.5");
  await press(el, "review");
  expect(reviewLines(el)).toEqual(["Soup: Price €3.00 → €3.50"]);
  expect(reviewNotes(el)).toEqual([
    "Lines already on open orders keep their old price and VAT class.",
    "The next normal publish from the products puts the old values back unless you fix the products too.",
  ]);
  expect(form(el)).toBeNull();
  expect(footerButton(el, "put-live")!.textContent!.trim()).toBe("Put live now");
  expect(footerButton(el, "put-live")!.variant).toBe("primary");
  await press(el, "keep-editing");
  expect(el.shadowRoot!.querySelector('[data-test="review-step"]')).toBeNull();
  expect(field(el, "wt-price-input", "price").value).toBe("3.5");
  expect(el.changes).toEqual([{ target: soup, field: "price", value: "3.50" }]);
});

it("says a queued version, named by its date, will not carry the changes", async () => {
  const el = await mount(
    stubApi({
      getMenuPublications: vi.fn(async () =>
        publications(
          { date: "2026-10-01", time: "08:00", state: "activated" },
          { date: "2026-10-20", time: "08:00", state: "cancelled" },
          { date: "2026-11-03", time: "08:00" },
        ),
      ),
    }),
  );
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  expect(reviewNotes(el)[1]).toBe(
    "The version going live on 3 Nov 2026, 08:00 does not include these changes.",
  );
});

it("puts the changes live against the version read, then says so and closes", async () => {
  const api = stubApi();
  const el = await mount(api);
  const patchedEvents: MenuPatchResult[] = [];
  el.addEventListener("wt-menu-patched", (event) => patchedEvents.push(event.detail));
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  await press(el, "put-live");
  expect(api.patchLiveMenu).toHaveBeenCalledWith("menu-lunch", {
    baseVersionId: "v-3",
    changes: [{ target: soup, field: "price", value: "4.00" }],
  });
  expect(patchedEvents).toEqual([patched]);
  expect(el.open).toBe(false);
  expect(modal(el).open).toBe(false);
});

it("goes quiet and puts nothing live when a newer version already holds the change", async () => {
  const data = new LiveData();
  const newer = lunch();
  newer.offers["mi-soup"]!.unitPrice = "4.00";
  const getLiveMenu = vi.fn().mockResolvedValueOnce(live(3)).mockResolvedValueOnce(live(4, newer));
  const api = stubApi({ liveData: data, getLiveMenu });
  const el = await mount(api);
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  data.invalidate([{ type: "menu_versions", id: "v-4" }]);
  await vi.waitFor(() => expect(modal(el).heading).toBe("Patch version 4 of Lunch Menu"));
  expect(reviewLines(el)).toEqual([]);
  expect(footerButton(el, "put-live")!.disabled).toBe(true);
  expect(footerButton(el, "put-live")!.variant).toBe("secondary");
  footerButton(el, "put-live")!.dispatchEvent(new MouseEvent("click"));
  await flush(el);
  expect(api.patchLiveMenu).not.toHaveBeenCalled();
});

it("puts a refused value back under its field, on its item, with the bottom message", async () => {
  const el = await mount(
    stubApi({
      patchLiveMenu: vi.fn(async () => {
        throw refusal("menu_patch.invalid", { change: 1, field: "kitchenName" });
      }),
    }),
  );
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await pick(el, "Salad");
  await type(el, "wt-input", "kitchen-name", "ENSALADA");
  await pick(el, "Soup");
  await press(el, "review");
  await press(el, "put-live");
  expect(el.shadowRoot!.querySelector('[data-test="review-step"]')).toBeNull();
  expect(form(el).querySelector("h3")!.textContent!.trim()).toBe("Salad");
  expect(field(el, "wt-input", "kitchen-name").error).toBe("Check this value.");
  expect(field(el, "wt-input", "kitchen-name").value).toBe("ENSALADA");
  expect(bottomMessage(el)).toBe("Correct the fields marked on Salad to continue.");
  expect(el.changes).toEqual([{ target: soup, field: "price", value: "4.00" }]);
  expect(footerButton(el, "review")!.disabled).toBe(true);
});

it("shows the refusal's own reason under the first language of a translated field", async () => {
  const el = await mount(
    stubApi({
      patchLiveMenu: vi.fn(async () => {
        throw refusal("menu_patch.invalid", {
          change: 0,
          field: "customerName",
          reason: "content.translation_required",
        });
      }),
    }),
  );
  await pick(el, "Soup");
  await type(el, "wt-input", "customer-name-en", "Daily soup");
  await press(el, "review");
  await press(el, "put-live");
  expect(field(el, "wt-input", "customer-name-en").error).toBe(
    codeMessage("content.translation_required"),
  );
  expect(field(el, "wt-input", "customer-name-es").error).toBe("");
});

it("explains a refusal that names no field shown, at the bottom, and keeps Put live working", async () => {
  for (const [error, message] of [
    [
      refusal("menu_patch.unchanged", { menuId: "menu-lunch" }),
      codeMessage("menu_patch.unchanged"),
    ],
    [
      refusal("menu_patch.not_published", { menuId: "menu-lunch" }),
      codeMessage("menu_patch.not_published"),
    ],
    [
      refusal("menu_patch.invalid", { change: 0, field: "target" }),
      "One of these changes no longer fits the live menu, for example because the venue's content languages changed while you were editing. Nothing was put live. Reload reads the live menu again and checks each change against it with the content languages this page has: it drops each one that does not fit, says how many, and keeps the rest.",
    ],
    [new Error("the box is unreachable"), codeMessage("server.internal")],
  ] as const) {
    const el = await mount(stubApi({ patchLiveMenu: vi.fn().mockRejectedValue(error) }));
    await pick(el, "Soup");
    await type(el, "wt-price-input", "price", "4");
    await press(el, "review");
    await press(el, "put-live");
    expect(bottomMessage(el)).toBe(message);
    // Of these refusals, only the change that no longer fits offers Reload.
    expect(footerButton(el, "reload") !== null).toBe(message.startsWith("One of these changes"));
    expect(reviewLines(el)).toEqual(["Soup: Price €3.00 → €4.00"]);
    expect(footerButton(el, "put-live")!.disabled).toBe(false);
    expect(el.open).toBe(true);
    cleanupWidgets();
  }
});

it("offers to reload onto a newer live version, keeping what still fits and counting the rest", async () => {
  const newer = lunch();
  newer.offers["mi-soup"]!.offeredModifiers = [];
  const getLiveMenu = vi.fn().mockResolvedValueOnce(live(3)).mockResolvedValueOnce(live(4, newer));
  const patchLiveMenu = vi
    .fn()
    .mockRejectedValueOnce(
      refusal("menu_patch.base_changed", {
        menuId: "menu-lunch",
        baseVersionId: "v-3",
        liveVersionId: "v-4",
        liveNumber: 4,
      }),
    )
    .mockResolvedValueOnce(patched);
  const el = await mount(stubApi({ getLiveMenu, patchLiveMenu }));
  await pick(el, "Toppings");
  await type(el, "wt-input", "name", "Add-ons");
  await pick(el, "Salad");
  await type(el, "wt-input", "name", "Green salad");
  await press(el, "review");
  await press(el, "put-live");
  expect(bottomMessage(el)).toBe(
    "Version 4 went live while you were patching. Reload to patch it instead; changes that still fit are kept.",
  );
  expect(el.shadowRoot!.querySelector('[data-test="dropped"]')).toBeNull();
  await press(el, "reload");
  expect(getLiveMenu).toHaveBeenCalledTimes(2);
  expect(modal(el).heading).toBe("Patch version 4 of Lunch Menu");
  expect(el.shadowRoot!.querySelector('[data-test="dropped"]')!.textContent!.trim()).toBe(
    "1 change no longer fits the live version and was dropped.",
  );
  expect(bottomMessage(el)).toBe("");
  expect(footerButton(el, "reload")).toBeNull();
  expect(el.changes).toEqual([
    { target: { kind: "offer", menuItemId: "mi-salad" }, field: "name", value: "Green salad" },
  ]);
  await press(el, "review");
  await press(el, "put-live");
  expect(patchLiveMenu).toHaveBeenLastCalledWith("menu-lunch", {
    baseVersionId: "v-4",
    changes: [
      { target: { kind: "offer", menuItemId: "mi-salad" }, field: "name", value: "Green salad" },
    ],
  });
});

it("keeps a refused field's own text through a reload", async () => {
  const getLiveMenu = vi.fn().mockResolvedValueOnce(live(3)).mockResolvedValueOnce(live(4));
  const el = await mount(
    stubApi({
      getLiveMenu,
      patchLiveMenu: vi.fn().mockRejectedValue(
        refusal("menu_patch.base_changed", {
          menuId: "menu-lunch",
          baseVersionId: "v-3",
          liveVersionId: "v-4",
          liveNumber: 4,
        }),
      ),
    }),
  );
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  await press(el, "put-live");
  await press(el, "keep-editing");
  await pick(el, "Salad");
  await type(el, "wt-input", "name", "");
  await press(el, "reload");
  expect(el.shadowRoot!.querySelector('[data-test="dropped"]')).toBeNull();
  expect(field(el, "wt-input", "name").value).toBe("");
  expect(field(el, "wt-input", "name").error).toBe("Enter a name.");
  expect(el.changes).toEqual([{ target: soup, field: "price", value: "4.00" }]);
});

it("explains a reload that fails and offers it again", async () => {
  const getLiveMenu = vi
    .fn()
    .mockResolvedValueOnce(live(3))
    .mockRejectedValueOnce(new Error("the box is unreachable"))
    .mockResolvedValueOnce(live(4));
  const el = await mount(
    stubApi({
      getLiveMenu,
      patchLiveMenu: vi.fn().mockRejectedValue(
        refusal("menu_patch.base_changed", {
          menuId: "menu-lunch",
          baseVersionId: "v-3",
          liveVersionId: "v-4",
          liveNumber: 4,
        }),
      ),
    }),
  );
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  await press(el, "put-live");
  await press(el, "reload");
  expect(bottomMessage(el)).toBe(
    `Version 4 went live while you were patching. Reload to patch it instead; changes that still fit are kept. ${codeMessage("server.internal")}`,
  );
  expect(footerButton(el, "reload")).not.toBeNull();
  await press(el, "reload");
  expect(getLiveMenu).toHaveBeenCalledTimes(3);
  expect(bottomMessage(el)).toBe("");
});

it("says when a newer live version arriving on its own drops changes", async () => {
  const data = new LiveData();
  const newer = lunch();
  newer.offers["mi-soup"]!.offeredModifiers = [];
  const getLiveMenu = vi.fn().mockResolvedValueOnce(live(3)).mockResolvedValueOnce(live(4, newer));
  const el = await mount(stubApi({ liveData: data, getLiveMenu }));
  await pick(el, "Toppings");
  await type(el, "wt-input", "name", "Add-ons");
  await pick(el, "Bread");
  await type(el, "wt-input", "name", "Toast");
  data.invalidate([{ type: "menu_versions", id: "v-4" }]);
  await vi.waitFor(() => expect(modal(el).heading).toBe("Patch version 4 of Lunch Menu"));
  expect(el.shadowRoot!.querySelector('[data-test="dropped"]')!.textContent!.trim()).toBe(
    "2 changes no longer fit the live version and were dropped.",
  );
});

it("disables the dialog's actions while the patch is being put live", async () => {
  let finish!: (value: MenuPatchResult) => void;
  const el = await mount(
    stubApi({ patchLiveMenu: vi.fn(() => new Promise((resolve) => (finish = resolve))) }),
  );
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  await press(el, "put-live");
  expect(footerButton(el, "put-live")!.loading).toBe(true);
  expect(footerButton(el, "keep-editing")!.disabled).toBe(true);
  expect(modal(el).dismissible).toBe(false);
  finish(patched);
  await flush(el);
  expect(el.open).toBe(false);
});

it("ignores a patch's answer once the dialog has closed", async () => {
  let finish!: (value: MenuPatchResult) => void;
  const el = await mount(
    stubApi({ patchLiveMenu: vi.fn(() => new Promise((resolve) => (finish = resolve))) }),
  );
  const events: unknown[] = [];
  el.addEventListener("wt-menu-patched", (event) => events.push(event));
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  await press(el, "put-live");
  el.open = false;
  await flush(el);
  el.open = true;
  await flush(el);
  finish(patched);
  await flush(el);
  expect(events).toEqual([]);
  expect(el.open).toBe(true);
});

it("closes from its Close button", async () => {
  const el = await mount();
  await press(el, "close");
  await vi.waitFor(() => expect(el.open).toBe(false));
});

it("explains a failed read of the menu's scheduled versions", async () => {
  const el = await mount(
    stubApi({ getMenuPublications: vi.fn().mockRejectedValue(new Error("unreachable")) }),
  );
  expect(el.shadowRoot!.querySelector('[data-test="read-error"]')!.textContent).toContain(
    codeMessage("server.internal"),
  );
});

it("puts the live values back when its changes are discarded", async () => {
  const coordinator = createLeaveCoordinator(async () => "discard", window);
  const answer = (event: Event) =>
    (event as CustomEvent<{ accept(value: typeof coordinator): void }>).detail.accept(coordinator);
  document.body.addEventListener("wt-leave-coordinator", answer);
  try {
    const el = await mount();
    await pick(el, "Soup");
    await type(el, "wt-price-input", "price", "4");
    await press(el, "review");
    expect(coordinator.isDirty()).toBe(true);
    await coordinator.request({ scopes: "all", reason: "cancel", proceed() {} });
    await el.updateComplete;
    expect(el.changes).toEqual([]);
    expect(el.shadowRoot!.querySelector('[data-test="review-step"]')).toBeNull();
    expect(field(el, "wt-price-input", "price").value).toBe("3.00");
    expect(footerButton(el, "review")!.disabled).toBe(true);
  } finally {
    document.body.removeEventListener("wt-leave-coordinator", answer);
    coordinator.dispose();
  }
});

it("sends a patch once however often Put live is pressed", async () => {
  let finish!: (value: MenuPatchResult) => void;
  const api = stubApi({
    patchLiveMenu: vi.fn(() => new Promise((resolve) => (finish = resolve))),
  });
  const el = await mount(api);
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  await press(el, "put-live");
  footerButton(el, "put-live")!.dispatchEvent(new MouseEvent("click"));
  await flush(el);
  expect(api.patchLiveMenu).toHaveBeenCalledTimes(1);
  finish(patched);
  await flush(el);
});

it("ignores a refusal or a reload once the dialog has closed", async () => {
  let refuse!: (error: Error) => void;
  const el = await mount(
    stubApi({
      patchLiveMenu: vi.fn(() => new Promise((_resolve, reject) => (refuse = reject))),
    }),
  );
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  await press(el, "put-live");
  el.open = false;
  await flush(el);
  refuse(refusal("menu_patch.unchanged", { menuId: "menu-lunch" }));
  await flush(el);
  el.open = true;
  await flush(el);
  expect(footerButton(el, "review")).not.toBeNull();
  expect(bottomMessage(el)).toBe("");

  let reread!: (value: LiveMenu) => void;
  const getLiveMenu = vi
    .fn()
    .mockResolvedValueOnce(live(3))
    .mockReturnValueOnce(new Promise((resolve) => (reread = resolve)));
  const other = await mount(
    stubApi({
      getLiveMenu,
      patchLiveMenu: vi.fn().mockRejectedValue(
        refusal("menu_patch.base_changed", {
          menuId: "menu-lunch",
          baseVersionId: "v-3",
          liveVersionId: "v-4",
          liveNumber: 4,
        }),
      ),
    }),
  );
  await pick(other, "Soup");
  await type(other, "wt-price-input", "price", "4");
  await press(other, "review");
  await press(other, "put-live");
  await press(other, "reload");
  other.open = false;
  await flush(other);
  reread(live(4));
  await flush(other);
  expect(other.changes).toEqual([]);
  expect(modal(other).heading).toBe("");
});

it("is no longer an unsaved draft by the time it says the patch is live", async () => {
  const coordinator = createLeaveCoordinator(async () => "keep", window);
  const answer = (event: Event) =>
    (event as CustomEvent<{ accept(value: typeof coordinator): void }>).detail.accept(coordinator);
  document.body.addEventListener("wt-leave-coordinator", answer);
  try {
    const el = await mount();
    const dirtyWhenPatched: boolean[] = [];
    el.addEventListener("wt-menu-patched", () => dirtyWhenPatched.push(coordinator.isDirty()));
    await pick(el, "Soup");
    await type(el, "wt-price-input", "price", "4");
    await press(el, "review");
    await press(el, "put-live");
    expect(dirtyWhenPatched).toEqual([false]);
  } finally {
    document.body.removeEventListener("wt-leave-coordinator", answer);
    coordinator.dispose();
  }
});

it("marks the item holding a refused field, and names it, when another item is picked", async () => {
  const el = await mount();
  await pick(el, "Salad");
  await type(el, "wt-input", "name", "");
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  expect(footerButton(el, "review")!.disabled).toBe(true);
  const mark = node(el, "Salad").querySelector('[data-test="needs-correcting"]');
  expect(mark!.textContent).toContain("Needs correcting");
  expect(node(el, "Soup").querySelector('[data-test="needs-correcting"]')).toBeNull();
  expect(bottomMessage(el)).toBe("Correct the fields marked on Salad to continue.");
  setLocale("es");
  await el.updateComplete;
  expect(node(el, "Salad").querySelector('[data-test="needs-correcting"]')!.textContent).toContain(
    "Necesita corrección",
  );
});

it("stops holding back Review for a refused field whose item a newer version no longer has", async () => {
  const data = new LiveData();
  const newer = lunch();
  newer.root.members = newer.root.members.slice(1);
  const getLiveMenu = vi.fn().mockResolvedValueOnce(live(3)).mockResolvedValueOnce(live(4, newer));
  const el = await mount(stubApi({ liveData: data, getLiveMenu }));
  await pick(el, "Salad");
  await type(el, "wt-input", "name", "");
  await pick(el, "Lemonade");
  await type(el, "wt-input", "name", "Lemon soda");
  expect(footerButton(el, "review")!.disabled).toBe(true);
  data.invalidate([{ type: "menu_versions", id: "v-4" }]);
  await vi.waitFor(() => expect(modal(el).heading).toBe("Patch version 4 of Lunch Menu"));
  expect(footerButton(el, "review")!.disabled).toBe(false);
  expect(bottomMessage(el)).toBe("");
});

it("drops a newer-version refusal once a newer live version arrives on its own", async () => {
  const data = new LiveData();
  const getLiveMenu = vi
    .fn()
    .mockResolvedValueOnce(live(3))
    .mockRejectedValueOnce(new Error("the box is unreachable"))
    .mockResolvedValueOnce(live(4));
  const el = await mount(
    stubApi({
      liveData: data,
      getLiveMenu,
      patchLiveMenu: vi.fn().mockRejectedValue(
        refusal("menu_patch.base_changed", {
          menuId: "menu-lunch",
          baseVersionId: "v-3",
          liveVersionId: "v-4",
          liveNumber: 4,
        }),
      ),
    }),
  );
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  await press(el, "put-live");
  await press(el, "reload");
  expect(bottomMessage(el)).toContain(codeMessage("server.internal"));
  data.invalidate([{ type: "menu_versions", id: "v-4" }]);
  await vi.waitFor(() => expect(modal(el).heading).toBe("Patch version 4 of Lunch Menu"));
  expect(bottomMessage(el)).toBe("");
  expect(footerButton(el, "reload")).toBeNull();
});

it("keeps the newer-version refusal when the same version is read again", async () => {
  const data = new LiveData();
  const getLiveMenu = vi.fn().mockResolvedValueOnce(live(3)).mockResolvedValueOnce(live(3));
  const el = await mount(
    stubApi({
      liveData: data,
      getLiveMenu,
      patchLiveMenu: vi.fn().mockRejectedValue(
        refusal("menu_patch.base_changed", {
          menuId: "menu-lunch",
          baseVersionId: "v-3",
          liveVersionId: "v-4",
          liveNumber: 4,
        }),
      ),
    }),
  );
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await press(el, "review");
  await press(el, "put-live");
  data.invalidate([{ type: "menu_versions", id: "v-3" }]);
  await vi.waitFor(() => expect(getLiveMenu).toHaveBeenCalledTimes(2));
  await flush(el);
  expect(footerButton(el, "reload")).not.toBeNull();
});

it("drops and counts a change the venue's new content languages refuse, as they change", async () => {
  const document = lunch();
  const drinks = document.root.members[1] as Extract<
    MenuDocument["root"]["members"][number],
    { kind: "section" }
  >;
  drinks.names = { en: "Bar", es: "Bebidas" };
  drinks.fixed = { names: { en: "Bar" } };
  const el = await mount(stubApi({ getLiveMenu: vi.fn(async () => live(3, document)) }));
  await pick(el, "Drinks");
  await type(el, "wt-input", "names-es", "Copas");
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  expect(el.changes).toHaveLength(2);
  setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
  await el.updateComplete;
  expect(el.changes).toEqual([{ target: soup, field: "price", value: "4.00" }]);
  expect(el.shadowRoot!.querySelector('[data-test="dropped"]')!.textContent!.trim()).toBe(
    "1 change no longer fits the live version and was dropped.",
  );
});

it("shows a refusal for a change the venue's content languages drop while it is being sent", async () => {
  const document = lunch();
  const drinks = document.root.members[1] as Extract<
    MenuDocument["root"]["members"][number],
    { kind: "section" }
  >;
  drinks.names = { en: "Bar", es: "Bebidas" };
  drinks.fixed = { names: { en: "Bar" } };
  let refuse!: (error: Error) => void;
  const el = await mount(
    stubApi({
      getLiveMenu: vi.fn(async () => live(3, document)),
      patchLiveMenu: vi.fn(() => new Promise((_resolve, reject) => (refuse = reject))),
    }),
  );
  const failures: unknown[] = [];
  const record = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    failures.push(event.reason);
  };
  window.addEventListener("unhandledrejection", record);
  try {
    await pick(el, "Drinks");
    await type(el, "wt-input", "names-es", "Copas");
    await press(el, "review");
    await press(el, "put-live");
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    await el.updateComplete;
    refuse(refusal("menu_patch.invalid", { change: 0, field: "names" }));
    await flush(el);
    await flush(el);
    expect(failures).toEqual([]);
    expect(el.shadowRoot!.querySelector('[data-test="review-step"]')).toBeNull();
    expect(form(el).querySelector("h3")!.textContent!.trim()).toBe("Drinks");
    expect(bottomMessage(el)).toBe("Correct the fields marked on Drinks to continue.");
  } finally {
    window.removeEventListener("unhandledrejection", record);
  }
});

it("moves onto a newer live version that arrives while a patch is being sent, once it is refused", async () => {
  const data = new LiveData();
  const getLiveMenu = vi.fn().mockResolvedValueOnce(live(3)).mockResolvedValue(live(4));
  let refuse!: (error: Error) => void;
  const el = await mount(
    stubApi({
      liveData: data,
      getLiveMenu,
      patchLiveMenu: vi.fn(() => new Promise((_resolve, reject) => (refuse = reject))),
    }),
  );
  await pick(el, "Soup");
  await type(el, "wt-price-input", "price", "4");
  await pick(el, "Salad");
  await type(el, "wt-input", "kitchen-name", "ENSALADA");
  await press(el, "review");
  await press(el, "put-live");
  data.invalidate([{ type: "menu_versions", id: "v-4" }]);
  await vi.waitFor(() => expect(getLiveMenu).toHaveBeenCalledTimes(2));
  await flush(el);
  expect(modal(el).heading).toBe("Patch version 3 of Lunch Menu");
  refuse(refusal("menu_patch.invalid", { change: 1, field: "kitchenName" }));
  await vi.waitFor(() => expect(modal(el).heading).toBe("Patch version 4 of Lunch Menu"));
  expect(field(el, "wt-input", "kitchen-name").error).toBe("Check this value.");
  expect(el.changes).toEqual([{ target: soup, field: "price", value: "4.00" }]);
});

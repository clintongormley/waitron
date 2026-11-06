import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { currentContentLanguages, setContentLanguages } from "@waitron/ui";
import { menuChangeActions } from "@waitron/catalogue/src/menu-undo.js";
import type { MenuTarget } from "@waitron/catalogue/src/menu-document-types.js";
import type { DocumentMember, MenuChange, MenuPreview, MenuStatus } from "../api/client.js";
import { setLocale } from "../i18n/t.js";
import { MenuPreviewPanel } from "./menu-preview.js";
import {
  cleanupWidgets,
  documentProduct,
  documentSection,
  menuDocument,
  mountWidget,
} from "./test-helpers.js";

vi.mock("@waitron/catalogue/src/menu-undo.js", { spy: true });

beforeEach(() => {
  setLocale("en");
  vi.mocked(menuChangeActions).mockClear();
});
afterEach(() => {
  setLocale("es-ES");
  cleanupWidgets();
});

const status: MenuStatus = {
  state: "changed",
  clashes: 0,
  version: 2,
  publishedAt: "2026-09-26T10:15:00.000Z",
  hash: "a".repeat(64),
};

const DOCUMENT = menuDocument(
  [
    documentProduct("mi-burger", "p-burger"),
    documentSection("s-drinks", "Drinks", [documentProduct("mi-lemonade", "p-lemonade")]),
  ],
  { "p-burger": "Burger", "p-lemonade": "Lemonade" },
);

const BURGER_TARGET: MenuTarget = {
  kind: "product",
  sectionIds: [],
  menuItemId: "mi-burger",
  productId: "p-burger",
  field: { kind: "summary" },
};

const sharedPrice: MenuChange = {
  id: "shared-price",
  targets: { before: [BURGER_TARGET], after: [BURGER_TARGET] },
  kind: "price_changed",
  productId: "p-burger",
  name: "Burger",
  from: "12.00",
  to: "13.00",
  source: "shared_product",
};
const includedOrder: MenuChange = {
  id: "included-order",
  targets: { before: [], after: [] },
  kind: "order_changed",
  listSectionId: "s-drinks",
  list: ["Drinks"],
  source: "included_menu",
  includedMenu: { id: "m-drinks", name: "Drinks" },
};
const includedPrice: MenuChange = {
  id: "included-price",
  targets: { before: [], after: [] },
  kind: "price_changed",
  productId: "p-lemonade",
  name: "Lemonade",
  from: "2.80",
  to: "3.00",
  source: "included_menu",
  includedMenu: { id: "m-drinks", name: "Drinks" },
};
const extraPortion: MenuChange = {
  id: "extra-portion",
  targets: { before: [], after: [] },
  kind: "extra_portion_changed",
  productId: "p-cheese",
  name: "Cheese",
  listId: "x-toppings",
  listName: "Toppings",
  from: { portion: "1", abbreviation: {} },
  to: { portion: "2", abbreviation: {} },
  source: "shared_product",
};
const deleted: MenuChange = {
  id: "deleted",
  targets: { before: [], after: [] },
  kind: "product_deleted",
  productId: "p-old",
  name: "Old dish",
  source: "shared_product",
};
const ownRename: MenuChange = {
  id: "own-rename",
  targets: { before: [], after: [] },
  kind: "menu_renamed",
  from: "Lunch",
  to: "Lunch Menu",
  source: "this_menu",
};

function preview(changes: MenuChange[]): MenuPreview {
  return {
    live: null,
    clashes: [],
    hash: "b".repeat(64),
    changes,
    warnings: [],
    status,
    document: DOCUMENT,
  };
}

async function mount(changes: MenuChange[]) {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    menuName: "Lunch Menu",
    status,
    preview: preview(changes),
  });
  return el;
}

const editLink = (el: MenuPreviewPanel, id: string) =>
  el.shadowRoot!.querySelector<HTMLAnchorElement>(`a[data-edit-change="${id}"]`);
const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

/** Clicks the link and reports whether anything before the test's own listener stopped the
 * browser's handling; the test's listener always stops it, so the test page stays put. */
function click(link: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  let prevented = false;
  const read = (event: Event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  const keep = (event: Event) => event.preventDefault();
  window.addEventListener("click", keep);
  link.addEventListener("click", read);
  try {
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ...init }),
    );
  } finally {
    window.removeEventListener("click", keep);
    link.removeEventListener("click", read);
  }
  return prevented;
}

it("offers Edit product on a shared-product change and opens the product editor on a plain click", async () => {
  const el = await mount([sharedPrice]);
  const heard = vi.fn();
  el.addEventListener("wt-edit-product", (event) => heard((event as CustomEvent).detail));
  const link = editLink(el, "shared-price")!;
  expect(text(link)).toBe("Edit product");
  expect(link.getAttribute("href")).toBe("/manage/catalogue/product/p-burger");
  expect(link.hasAttribute("data-own-click")).toBe(true);
  expect(click(link)).toBe(true);
  expect(heard.mock.calls).toEqual([[{ productId: "p-burger" }]]);
});

it.each(["ctrlKey", "metaKey", "shiftKey", "altKey"])(
  "leaves an Edit product %s click to the browser",
  async (modifier) => {
    const el = await mount([sharedPrice]);
    const heard = vi.fn();
    el.addEventListener("wt-edit-product", heard);
    expect(click(editLink(el, "shared-price")!, { [modifier]: true })).toBe(false);
    expect(heard).not.toHaveBeenCalled();
  },
);

it("offers Edit {menu} on an included-menu change, to its Structure tab, as a plain link", async () => {
  const el = await mount([includedOrder]);
  const heard = vi.fn();
  el.addEventListener("wt-edit-product", heard);
  const link = editLink(el, "included-order")!;
  expect(text(link)).toBe("Edit Drinks");
  expect(link.getAttribute("href")).toBe("/manage/menus/menu/m-drinks/view/structure");
  expect(link.hasAttribute("data-own-click")).toBe(false);
  expect(click(link)).toBe(false);
  expect(click(link, { metaKey: true })).toBe(false);
  expect(heard).not.toHaveBeenCalled();
});

it("sends an included menu's price change to that menu's Price overrides tab", async () => {
  const el = await mount([includedPrice]);
  expect(editLink(el, "included-price")!.getAttribute("href")).toBe(
    "/manage/menus/menu/m-drinks/view/prices",
  );
});

it("sends an extras item's portion change to its extras list", async () => {
  const el = await mount([extraPortion]);
  const link = editLink(el, "extra-portion")!;
  expect(text(link)).toBe("Edit extras list");
  expect(link.getAttribute("href")).toBe("/manage/modifiers/view/extras/list/x-toppings");
  expect(link.hasAttribute("data-own-click")).toBe(false);
});

it("offers no Edit link on a deleted product or on this menu's own change", async () => {
  const el = await mount([deleted, ownRename]);
  expect(el.shadowRoot!.querySelector(`[data-change-row="deleted"]`)).not.toBeNull();
  expect(el.shadowRoot!.querySelector(`[data-change-row="own-rename"]`)).not.toBeNull();
  expect(el.shadowRoot!.querySelectorAll("a[data-edit-change]")).toHaveLength(0);
});

it("puts the Edit link after View and before Hide", async () => {
  const el = await mount([sharedPrice]);
  const row = el.shadowRoot!.querySelector(`[data-change-row="shared-price"]`)!;
  expect(
    [...row.querySelectorAll("a")].map((link) =>
      link.hasAttribute("data-change-id")
        ? "view"
        : link.hasAttribute("data-edit-change")
          ? "edit"
          : link.hasAttribute("data-hide-change")
            ? "hide"
            : "other",
    ),
  ).toEqual(["view", "edit", "hide"]);
});

it("works out the changes' actions once per preview, not once per row or per render", async () => {
  const el = await mount([sharedPrice, includedOrder, extraPortion]);
  expect(menuChangeActions).toHaveBeenCalledTimes(1);
  el.menuName = "Evening";
  await el.updateComplete;
  el.publishing = true;
  await el.updateComplete;
  expect(menuChangeActions).toHaveBeenCalledTimes(1);
  el.preview = preview([sharedPrice]);
  await el.updateComplete;
  expect(menuChangeActions).toHaveBeenCalledTimes(2);
  expect(vi.mocked(menuChangeActions).mock.calls[1]![0].preview).toBe(el.preview);
});

const LIVE: MenuPreview["live"] = { versionId: "v-2", document: DOCUMENT };
const RENAME_TEXT = "Menu renamed from Lunch to Lunch Menu";

function livePreview(changes: MenuChange[]): MenuPreview {
  return { ...preview(changes), live: LIVE };
}

async function mountLive(changes: MenuChange[], props: Partial<MenuPreviewPanel> = {}) {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    menuName: "Lunch Menu",
    status,
    preview: livePreview(changes),
    ...props,
  });
  return el;
}

const undoButton = (el: MenuPreviewPanel, id: string) =>
  el.shadowRoot!.querySelector<HTMLButtonElement>(`button.undo[data-undo-change="${id}"]`);
const undoEvents = (el: MenuPreviewPanel) => {
  const heard = vi.fn();
  el.addEventListener("wt-menu-undo", (event) => {
    const custom = event as CustomEvent;
    heard({ detail: custom.detail, bubbles: custom.bubbles, composed: custom.composed });
  });
  return heard;
};

/** The colour `token` resolves to inside the widget. */
function tokenColour(el: MenuPreviewPanel, token: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  el.shadowRoot!.appendChild(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

it("offers Undo only where the action is undo, never on a shared or included change", async () => {
  const el = await mountLive([ownRename, sharedPrice, includedOrder, deleted]);
  expect(
    [...el.shadowRoot!.querySelectorAll("button.undo")].map((b) =>
      b.getAttribute("data-undo-change"),
    ),
  ).toEqual(["own-rename"]);
  const button = undoButton(el, "own-rename")!;
  expect(button.type).toBe("button");
  expect(text(button)).toBe("Undo");
});

it("offers no Undo on a menu that has never been published", async () => {
  const el = await mount([ownRename]);
  expect(el.shadowRoot!.querySelector(`[data-change-row="own-rename"]`)).not.toBeNull();
  expect(el.shadowRoot!.querySelector("button.undo")).toBeNull();
});

it("names the Undo and describes it with the change's own words", async () => {
  const el = await mountLive([ownRename]);
  const button = undoButton(el, "own-rename")!;
  const described = (button.getAttribute("aria-describedby") ?? "").split(" ");
  const words = el.shadowRoot!.getElementById(described[0]!)!;
  expect(words.tagName).toBe("SPAN");
  expect(text(words)).toBe(RENAME_TEXT);
  expect(described).toHaveLength(1);
  expect(button.closest("li")).toBe(words.closest("li"));
});

it("puts Undo after View and before Hide", async () => {
  const el = await mountLive([ownRename]);
  const row = el.shadowRoot!.querySelector(`[data-change-row="own-rename"]`)!;
  expect(
    [...row.querySelectorAll("a, button")].map((node) =>
      node.hasAttribute("data-change-id")
        ? "view"
        : node.hasAttribute("data-undo-change")
          ? "undo"
          : node.hasAttribute("data-hide-change")
            ? "hide"
            : "other",
    ),
  ).toEqual(["view", "undo", "hide"]);
});

it("keeps each row action on one line in a narrow pane, wrapping the row between them", async () => {
  setLocale("es-ES");
  const el = await mountLive([ownRename, sharedPrice]);
  el.style.display = "block";
  el.style.inlineSize = "80px";
  await el.updateComplete;
  const actions = [
    ...el.shadowRoot!.querySelectorAll<HTMLElement>(
      "a[data-change-id], a[data-edit-change], button.undo, a[data-hide-change]",
    ),
  ];
  expect(actions.map((node) => node.tagName)).toEqual(["A", "BUTTON", "A", "A", "A", "A"]);
  const lines = (node: HTMLElement) => new Set([...node.getClientRects()].map((r) => r.top)).size;
  expect(actions.map((node) => [text(node), lines(node)])).toEqual(
    actions.map((node) => [text(node), 1]),
  );
  const edit = editLink(el, "shared-price")!.getBoundingClientRect();
  const hide = el
    .shadowRoot!.querySelector(`a[data-hide-change="shared-price"]`)!
    .getBoundingClientRect();
  expect(hide.top).toBeGreaterThan(edit.top);
});

it("sends one wt-menu-undo on a click, stopping the click", async () => {
  const el = await mountLive([ownRename]);
  const heard = undoEvents(el);
  const outside = vi.fn();
  el.addEventListener("click", outside);
  await userEvent.click(undoButton(el, "own-rename")!);
  expect(heard.mock.calls).toEqual([
    [{ detail: { changeId: "own-rename", change: RENAME_TEXT }, bubbles: true, composed: true }],
  ]);
  expect(outside).not.toHaveBeenCalled();
  expect(el.shadowRoot!.querySelector("wt-dialog[open], wt-modal[open], dialog[open]")).toBeNull();
});

it.each(["{Enter}", " "])("sends one wt-menu-undo on %s", async (key) => {
  const el = await mountLive([ownRename]);
  const heard = undoEvents(el);
  undoButton(el, "own-rename")!.focus();
  await userEvent.keyboard(key);
  expect(heard.mock.calls).toEqual([
    [{ detail: { changeId: "own-rename", change: RENAME_TEXT }, bubbles: true, composed: true }],
  ]);
});

it("says Undoing… while its Undo is out, keeps the link colour, and sends nothing more", async () => {
  const el = await mountLive([ownRename], { undoing: "own-rename" });
  const heard = undoEvents(el);
  const button = undoButton(el, "own-rename")!;
  expect(text(button)).toBe("Undoing…");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(getComputedStyle(button).color).toBe(tokenColour(el, "--wt-color-primary-text"));
  await userEvent.click(button, { force: true });
  expect(heard).not.toHaveBeenCalled();
});

it("draws a blocked Undo muted and sends nothing", async () => {
  const el = await mountLive([ownRename], { undoBlocked: true });
  const heard = undoEvents(el);
  const button = undoButton(el, "own-rename")!;
  expect(text(button)).toBe("Undo");
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(getComputedStyle(button).color).toBe(tokenColour(el, "--wt-color-text-muted"));
  expect(tokenColour(el, "--wt-color-text-muted")).not.toBe(
    tokenColour(el, "--wt-color-primary-text"),
  );
  await userEvent.click(button, { force: true });
  expect(heard).not.toHaveBeenCalled();
});

it("draws every other change's Undo muted while one Undo is out, and sends nothing from it", async () => {
  const drinksColour: MenuChange = {
    id: "drinks-colour",
    targets: { before: [], after: [] },
    kind: "section_changed",
    sectionId: "s-drinks",
    name: "Drinks",
    fields: ["color"],
    source: "this_menu",
  };
  const el = await mountLive([ownRename, drinksColour], { undoing: "own-rename" });
  const heard = undoEvents(el);
  const other = undoButton(el, "drinks-colour")!;
  expect(text(other)).toBe("Undo");
  expect(other.getAttribute("aria-disabled")).toBe("true");
  expect(getComputedStyle(other).color).toBe(tokenColour(el, "--wt-color-text-muted"));
  await userEvent.click(other, { force: true });
  expect(heard).not.toHaveBeenCalled();
});

it("draws an unblocked Undo in the link colour", async () => {
  const el = await mountLive([ownRename]);
  const button = undoButton(el, "own-rename")!;
  expect(button.hasAttribute("aria-disabled")).toBe(false);
  expect(getComputedStyle(button).color).toBe(tokenColour(el, "--wt-color-primary-text"));
});

it("holds Publish back while an Undo is out", async () => {
  const el = await mountLive([ownRename], { undoing: "own-rename" });
  const published = vi.fn();
  el.addEventListener("wt-menu-publish", published);
  const publish =
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>('[data-test="publish"]')!;
  expect(publish.variant).toBe("secondary");
  expect(publish.disabled).toBe(true);
  publish.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  await el.updateComplete;
  expect(published).not.toHaveBeenCalled();
  el.undoing = null;
  await el.updateComplete;
  expect(publish.variant).toBe("primary");
  expect(publish.disabled).toBe(false);
});

it("shows a refusal inside the bullet, announced once, and described from the Undo", async () => {
  const el = await mountLive([ownRename], {
    undoRefusals: { "own-rename": "Another menu called Lunch already exists." },
  });
  const row = () => el.shadowRoot!.querySelector(`[data-change-row="own-rename"]`)!;
  const refusal = () => row().querySelector<HTMLElement>("[data-undo-refusal]")!;
  expect(refusal().tagName).toBe("P");
  expect(text(refusal())).toBe("Not undone. Another menu called Lunch already exists.");
  expect(refusal().getAttribute("role")).toBe("alert");
  const described = undoButton(el, "own-rename")!.getAttribute("aria-describedby")!.split(" ");
  expect(described).toContain(refusal().id);
  el.preview = livePreview([ownRename]);
  await el.updateComplete;
  expect(text(refusal())).toBe("Not undone. Another menu called Lunch already exists.");
  expect(refusal().hasAttribute("role")).toBe(false);
  el.undoRefusals = {
    "own-rename": "This menu has been deleted, so there is nothing to undo.",
  };
  await el.updateComplete;
  expect(refusal().getAttribute("role")).toBe("alert");
});

it.each([
  ["set again", true],
  ["left in place", false],
])(
  "announces the same refusal again once a fresh attempt at that change finishes, with the refusal %s",
  async (_, setAgain) => {
    const reason = "Another menu called Lunch already exists.";
    const el = await mountLive([ownRename], { undoRefusals: { "own-rename": reason } });
    const refusal = () =>
      el.shadowRoot!.querySelector<HTMLElement>(
        `[data-change-row="own-rename"] [data-undo-refusal]`,
      );
    const first = refusal()!;
    expect(first.getAttribute("role")).toBe("alert");
    el.undoing = "own-rename";
    await el.updateComplete;
    el.undoing = null;
    if (setAgain) el.undoRefusals = { "own-rename": reason };
    await el.updateComplete;
    expect(refusal()).not.toBe(first);
    expect(text(refusal())).toBe(`Not undone. ${reason}`);
    expect(refusal()!.getAttribute("role")).toBe("alert");
  },
);

it("brings a hidden refusal back with Show all changes without announcing it again", async () => {
  const el = await mountLive([ownRename, sharedPrice], {
    undoRefusals: { "own-rename": "Another menu called Lunch already exists." },
  });
  const refusal = () =>
    el.shadowRoot!.querySelector<HTMLElement>(`[data-change-row="own-rename"] [data-undo-refusal]`);
  expect(refusal()!.getAttribute("role")).toBe("alert");
  el.shadowRoot!.querySelector<HTMLAnchorElement>('a[data-hide-change="own-rename"]')!.click();
  await el.updateComplete;
  expect(refusal()).toBeNull();
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="show-all-changes"]')!.click();
  await el.updateComplete;
  expect(text(refusal())).toBe("Not undone. Another menu called Lunch already exists.");
  expect(refusal()!.hasAttribute("role")).toBe(false);
});

it.each([
  ["drawn with its Undo", {}, "own-rename", true],
  ["hidden", {}, "own-rename", false],
  ["drawn with no Undo", {}, "shared-price", false],
  ["not listed", {}, "gone", false],
  ["in a preview that could not be read", { failed: true }, "own-rename", false],
  [
    "in a preview whose draft is already live",
    { preview: { ...livePreview([ownRename]), status: { ...status, hash: "b".repeat(64) } } },
    "own-rename",
    false,
  ],
])(
  "says whether a change is drawn with its Undo when it is %s",
  async (state, props, id, drawn) => {
    const el = await mountLive([ownRename, sharedPrice], props);
    if (state === "hidden") {
      el.shadowRoot!.querySelector<HTMLAnchorElement>(`a[data-hide-change="${id}"]`)!.click();
      await el.updateComplete;
    }
    expect(el.drawsUndo(id)).toBe(drawn);
    expect(undoButton(el, id) !== null).toBe(drawn);
  },
);

it("keeps focus on a change's Undo across a new preview after a refusal", async () => {
  const el = await mountLive([ownRename, sharedPrice]);
  undoButton(el, "own-rename")!.focus();
  el.undoRefusals = { "own-rename": "Another menu called Lunch already exists." };
  el.preview = livePreview([ownRename, sharedPrice]);
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(undoButton(el, "own-rename"));
});

it("keeps focus on a change's Undo across a new preview while it is undoing", async () => {
  const el = await mountLive([ownRename, sharedPrice]);
  undoButton(el, "own-rename")!.focus();
  el.undoing = "own-rename";
  await el.updateComplete;
  el.preview = livePreview([ownRename, sharedPrice]);
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(undoButton(el, "own-rename"));
});

it("moves focus to the first Hide link when the undone change has gone", async () => {
  const el = await mountLive([ownRename, sharedPrice]);
  undoButton(el, "own-rename")!.focus();
  el.preview = livePreview([sharedPrice]);
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(
    el.shadowRoot!.querySelector('a[data-hide-change="shared-price"]'),
  );
});

it("moves focus to the changes pane when no change is left", async () => {
  const el = await mountLive([ownRename]);
  undoButton(el, "own-rename")!.focus();
  el.preview = livePreview([]);
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(
    el.shadowRoot!.querySelector('[data-test="changes-pane"]'),
  );
});

it("leaves focus alone when it was outside the list", async () => {
  const el = await mountLive([ownRename]);
  const pane = el.shadowRoot!.querySelector<HTMLElement>('[data-test="document-pane"]')!;
  pane.focus();
  el.preview = livePreview([]);
  await el.updateComplete;
  expect(el.shadowRoot!.activeElement).toBe(pane);
});

it.each([
  ["ready", {}],
  ["failed", { failed: true, preview: null }],
])("says what was undone under the heading when %s", async (_, props) => {
  const el = await mountLive([sharedPrice], { undoResult: RENAME_TEXT, ...props });
  const lines = el.shadowRoot!.querySelectorAll('[data-test="undo-result"]');
  expect(lines).toHaveLength(1);
  expect(lines[0]!.getAttribute("role")).toBe("status");
  expect(text(lines[0]!)).toBe(`Undone: ${RENAME_TEXT}.`);
  expect(lines[0]!.closest('[data-test="changes"]')).toBeNull();
  expect(
    el.shadowRoot!.getElementById("changes-heading")!.compareDocumentPosition(lines[0]!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("says nothing was undone when there is no result", async () => {
  const el = await mountLive([ownRename]);
  expect(el.shadowRoot!.querySelector('[data-test="undo-result"]')).toBeNull();
});

const mainsSection = (es: string): DocumentMember => {
  const node = documentSection("s-mains", "Mains", []);
  return node.kind === "section" ? { ...node, names: { en: "Mains", es } } : node;
};
const mainsRenamed: MenuChange = {
  id: "mains-renamed",
  targets: { before: [], after: [] },
  kind: "section_changed",
  sectionId: "s-mains",
  name: "Mains",
  fields: ["names"],
  source: "this_menu",
};

/** A Spanish-only rename of an own section, which has an Undo only while Spanish is switched on. */
async function mountMainsRenamed(props: Partial<MenuPreviewPanel> = {}) {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    menuName: "Lunch Menu",
    status,
    preview: {
      ...preview([mainsRenamed]),
      document: menuDocument([mainsSection("Segundos")], {}),
      live: { versionId: "v-2", document: menuDocument([mainsSection("Principales")], {}) },
    },
    ...props,
  });
  return el;
}

it("works the actions out again when the switched-on content languages change", async () => {
  const before = currentContentLanguages();
  try {
    setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
    const el = await mountMainsRenamed();
    expect(undoButton(el, "mains-renamed")).not.toBeNull();
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    await el.updateComplete;
    expect(undoButton(el, "mains-renamed")).toBeNull();
  } finally {
    setContentLanguages(before);
  }
});

it("takes a change's refusal away once the change no longer offers Undo", async () => {
  const before = currentContentLanguages();
  try {
    setContentLanguages({ defaultLanguage: "en", languages: ["en", "es"] });
    const el = await mountMainsRenamed({
      undoRefusals: { "mains-renamed": "Another section is now called Mains." },
    });
    const row = () => el.shadowRoot!.querySelector(`[data-change-row="mains-renamed"]`)!;
    expect(text(row().querySelector("[data-undo-refusal]"))).toBe(
      "Not undone. Another section is now called Mains.",
    );
    setContentLanguages({ defaultLanguage: "en", languages: ["en"] });
    await el.updateComplete;
    expect(row()).not.toBeNull();
    expect(row().querySelector("[data-undo-refusal]")).toBeNull();
  } finally {
    setContentLanguages(before);
  }
});

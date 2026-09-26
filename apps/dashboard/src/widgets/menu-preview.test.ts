import { afterEach, beforeEach, expect, it } from "vitest";
import type { MenuChange, MenuPreview, MenuStatus } from "../api/client.js";
import { formatIsoMinute } from "../date-utils.js";
import { codeMessage } from "../i18n/codes.js";
import { setLocale, t } from "../i18n/t.js";
import { MenuPreviewPanel, type PublishResult } from "./menu-preview.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";

// The wording is asserted as a person reads it, in English unless a case says otherwise.
beforeEach(() => setLocale("en"));
afterEach(() => {
  setLocale("es-ES");
  cleanupWidgets();
});

const PUBLISHED_AT = "2026-09-26T10:15:00.000Z";
const LIVE_HASH = "a".repeat(64);
const NEW_HASH = "b".repeat(64);

const changedStatus: MenuStatus = {
  state: "changed",
  version: 2,
  publishedAt: PUBLISHED_AT,
  hash: LIVE_HASH,
};

function preview(changes: MenuChange[], warnings: MenuPreview["warnings"] = []): MenuPreview {
  return { hash: NEW_HASH, changes, warnings };
}

async function mount(props: Partial<MenuPreviewPanel>) {
  const { el } = await mountWidget<MenuPreviewPanel>("dashboard-menu-preview", {
    menuName: "Lunch Menu",
    status: changedStatus,
    preview: preview([]),
    ...props,
  });
  return el;
}

function q<T extends HTMLElement = HTMLElement>(el: MenuPreviewPanel, selector: string): T | null {
  return el.shadowRoot!.querySelector<T>(selector);
}

function text(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function items(el: MenuPreviewPanel, list: string): string[] {
  return [...el.shadowRoot!.querySelectorAll(`[data-test="${list}"] li`)].map(text);
}

it("words every kind of change, each with where it came from", async () => {
  const el = await mount({
    preview: preview([
      {
        kind: "product_added",
        productId: "p-lemonade",
        name: "Lemonade",
        under: ["Drinks"],
        source: "this_menu",
      },
      {
        kind: "price_changed",
        productId: "p-burger",
        name: "Burger",
        from: "12.00",
        to: "13.00",
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
      {
        kind: "product_changed",
        productId: "p-lemonade",
        name: "Lemonade",
        fields: ["allergens"],
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
      {
        kind: "section_changed",
        sectionId: "s-drinks",
        name: "Drinks",
        fields: ["names"],
        source: "shared_section",
      },
      {
        kind: "product_removed",
        productId: "p-lager",
        name: "Lager",
        under: ["Drinks", "Beer"],
        source: "shared_section",
        alsoOn: ["Dinner Menu", "Terrace Menu"],
      },
      {
        kind: "product_added",
        productId: "p-chips",
        name: "Chips",
        under: [],
        source: "this_menu",
      },
      {
        kind: "product_moved",
        productId: "p-soup",
        name: "Soup",
        from: [["Starters"]],
        to: [[], ["Mains", "Hot"]],
        source: "this_menu",
      },
      {
        kind: "product_changed",
        productId: "p-cola",
        name: "Cola",
        fields: ["names", "description", "image", "unit", "diet", "variants", "extras", "options"],
        source: "shared_product",
      },
      {
        kind: "section_added",
        sectionId: "s-desserts",
        name: "Desserts",
        under: [],
        source: "this_menu",
      },
      {
        kind: "product_removed",
        productId: "p-bread",
        name: "Bread",
        under: [],
        source: "this_menu",
      },
      {
        kind: "section_removed",
        sectionId: "s-specials",
        name: "Specials",
        under: [],
        source: "this_menu",
      },
      {
        kind: "section_removed",
        sectionId: "s-beer",
        name: "Beer",
        under: ["Drinks"],
        source: "shared_section",
      },
      {
        kind: "section_changed",
        sectionId: "s-mains",
        name: "Mains",
        fields: ["names", "image", "color"],
        source: "shared_section",
      },
      { kind: "order_changed", list: [], source: "this_menu" },
      { kind: "order_changed", list: ["Drinks"], source: "shared_section" },
      { kind: "layout_changed", layoutId: "l-bar", name: "Bar", source: "this_menu" },
      { kind: "default_layout_changed", from: "Home", to: "Bar", source: "this_menu" },
      { kind: "menu_renamed", from: "Midday Menu", to: "Lunch Menu", source: "this_menu" },
    ]),
  });
  expect(items(el, "changes")).toEqual([
    "Lemonade added under Drinks — this menu",
    "Burger price changed from €12.00 to €13.00 — shared product, also on Dinner Menu",
    "Lemonade: allergens — shared product, also on Dinner Menu",
    "Drinks renamed — shared section",
    "Lager removed from Drinks › Beer — shared section, also on Dinner Menu, Terrace Menu",
    "Chips added at the top level — this menu",
    "Soup moved from Starters to Top level and Mains › Hot — this menu",
    "Cola: names, description, photo, unit, diet, variants, extras, options — shared product",
    "Section Desserts added at the top level — this menu",
    "Bread removed from the top level — this menu",
    "Section Specials removed from the top level — this menu",
    "Section Beer removed from Drinks — shared section",
    "Mains: name, photo, colour — shared section",
    "Order changed at the top level — this menu",
    "Order changed in Drinks — shared section",
    "Home page layout Bar changed — this menu",
    "Default home page layout changed from Home to Bar — this menu",
    "Menu renamed from Midday Menu to Lunch Menu — this menu",
  ]);
});

it("words a change in Spanish, with the price in the Spanish money format", async () => {
  setLocale("es-ES");
  const el = await mount({
    preview: preview([
      {
        kind: "product_moved",
        productId: "p-soup",
        name: "Soup",
        from: [["Starters"]],
        to: [[], ["Mains", "Hot"]],
        source: "this_menu",
      },
      { kind: "order_changed", list: [], source: "this_menu" },
      {
        kind: "price_changed",
        productId: "p-burger",
        name: "Burger",
        from: "12.00",
        to: "13.00",
        source: "shared_product",
        alsoOn: ["Dinner Menu"],
      },
    ]),
  });
  expect(items(el, "changes").map((line) => line.replace(/\s/g, " "))).toEqual([
    "Se ha movido Soup de Starters a Nivel principal y Mains › Hot — este menú",
    "Ha cambiado el orden en el nivel principal — este menú",
    "Ha cambiado el precio de Burger de 12,00 € a 13,00 € — producto compartido, también en Dinner Menu",
  ]);
});

it("shows the live version and when it was published, apart from the pending changes", async () => {
  const el = await mount({
    preview: preview([
      {
        kind: "product_added",
        productId: "p-lemonade",
        name: "Lemonade",
        under: ["Drinks"],
        source: "this_menu",
      },
    ]),
  });
  expect(text(q(el, '[data-test="live"]'))).toBe(
    t("menu_preview.live_version")
      .replace("{number}", "2")
      .replace("{time}", formatIsoMinute(PUBLISHED_AT)),
  );
  expect(q(el, '[data-test="live"]')!.closest("section")).not.toBe(
    q(el, '[data-test="changes"]')!.closest("section"),
  );
});

it("says a menu never published has no live version, and offers to publish it", async () => {
  const el = await mount({
    status: { state: "unpublished" },
    preview: preview([
      {
        kind: "product_added",
        productId: "p-burger",
        name: "Burger",
        under: [],
        source: "this_menu",
      },
    ]),
  });
  expect(text(q(el, '[data-test="live"]'))).toBe(t("menu_preview.never_published"));
  expect(text(q(el, '[data-test="publish"]'))).toBe("Publish Lunch Menu");
});

it("names the one menu on the publish button, and asks to publish the hash it previewed", async () => {
  const el = await mount({
    preview: preview([{ kind: "order_changed", list: [], source: "this_menu" }]),
  });
  const asked: unknown[] = [];
  el.addEventListener("wt-menu-publish", (event) => asked.push((event as CustomEvent).detail));
  expect(text(q(el, '[data-test="publish"]'))).toBe("Publish Lunch Menu");
  expect(text(q(el, '[data-test="only-this-menu"]'))).toBe(
    t("menu_preview.only_this_menu").replaceAll("{menu}", "Lunch Menu"),
  );
  q(el, '[data-test="publish"]')!.click();
  expect(asked).toEqual([{ hash: NEW_HASH }]);
});

it("says there is nothing to publish when the working menu matches its live version, and offers no publish", async () => {
  const el = await mount({
    status: { state: "current", version: 4, publishedAt: PUBLISHED_AT, hash: NEW_HASH },
    preview: preview([]),
  });
  expect(text(q(el, '[data-test="nothing"]'))).toBe(
    t("menu_preview.nothing").replace("{number}", "4"),
  );
  expect(q(el, '[data-test="publish"]')).toBeNull();
});

it("offers the publish when the menu differs from its live version but no change can be listed", async () => {
  const el = await mount({ preview: preview([]) });
  expect(text(q(el, '[data-test="no-changes"]'))).toBe(t("menu_preview.no_changes"));
  expect(q(el, '[data-test="publish"]')).not.toBeNull();
});

it("lists an omitted shortcut as a warning that does not block publishing", async () => {
  const el = await mount({
    preview: preview(
      [{ kind: "layout_changed", layoutId: "l-home", name: "Home", source: "this_menu" }],
      [{ kind: "shortcut_omitted", layoutName: "Home", name: "Lemonade" }],
    ),
  });
  expect(items(el, "warnings")).toEqual([
    t("menu_preview.shortcut_omitted").replace("{name}", "Lemonade").replace("{layout}", "Home"),
  ]);
  expect(text(q(el, '[data-test="warnings-note"]'))).toBe(t("menu_preview.warnings_note"));
  expect(q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="publish"]')!.disabled).toBe(false);
});

it("holds the publish button while a publish is out, saying what it is doing", async () => {
  const el = await mount({
    preview: preview([{ kind: "order_changed", list: [], source: "this_menu" }]),
    publishing: true,
  });
  const button = q<HTMLElementTagNameMap["wt-button"]>(el, '[data-test="publish"]')!;
  expect(button.loading).toBe(true);
  expect(text(button)).toBe("Publishing Lunch Menu…");
  const asked: unknown[] = [];
  el.addEventListener("wt-menu-publish", (event) => asked.push(event));
  button.click();
  expect(asked).toEqual([]);
});

it("says while the changes are being worked out, and when they could not be, offering to try again", async () => {
  const el = await mount({ preview: null });
  expect(text(q(el, '[data-test="preview-loading"]'))).toBe(t("menu_preview.loading"));
  expect(q(el, '[data-test="publish"]')).toBeNull();
  el.failed = true;
  await el.updateComplete;
  expect(q(el, '[data-test="preview-loading"]')).toBeNull();
  expect(text(q(el, '[data-test="preview-error"]'))).toBe(t("menu_preview.error"));
  expect(q(el, '[data-test="publish"]')).toBeNull();
  let retried = 0;
  el.addEventListener("wt-preview-retry", () => (retried += 1));
  q(el, '[data-test="preview-retry"]')!.click();
  expect(retried).toBe(1);
});

it("says while the live version is being checked", async () => {
  const el = await mount({ status: null });
  expect(text(q(el, '[data-test="live"]'))).toBe(t("menu_preview.live_loading"));
});

/** The message is read inside the case, in the case's language. */
const results: [string, PublishResult, MenuStatus | null, () => string][] = [
  [
    "a publish",
    { kind: "published", number: 3 },
    changedStatus,
    () => "Lunch Menu version 3 is now live.",
  ],
  [
    "a stale preview",
    { kind: "stale" },
    changedStatus,
    () => codeMessage("menu.changed_since_preview"),
  ],
  [
    "a failed publish over a live version",
    { kind: "failed", reason: "The server is busy." },
    changedStatus,
    () =>
      "Lunch Menu was not published: version 2 is still live. Your changes are still saved. The server is busy.",
  ],
  [
    "a failed first publish",
    { kind: "failed", reason: "The server is busy." },
    { state: "unpublished" },
    () =>
      "Lunch Menu was not published, so nothing new is live. Your changes are still saved. The server is busy.",
  ],
];

it.each(results)("reports %s", async (_name, result, status, message) => {
  const el = await mount({ status, result });
  const shown = q(el, '[data-test="result"]')!;
  expect(text(shown)).toBe(message());
  expect(shown.getAttribute("role")).toBe(result.kind === "published" ? "status" : "alert");
});

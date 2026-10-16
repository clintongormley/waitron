import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { MenuPreview } from "../api/client.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  cleanupWidgets,
  expectNoA11yViolations,
  menuDocument,
  mountWidget,
  type Theme,
} from "./test-helpers.js";
import { MenuPreviewPanel } from "./menu-preview.js";

const WARNINGS: MenuPreview["warnings"] = [
  { kind: "shortcut_missing", name: "Retired shortcut" },
  {
    kind: "extra_portion_precision",
    name: "Extra",
    listName: "Sauces",
    portion: "0.055",
    abbreviation: { en: "kg" },
    precision: 2,
  },
  {
    kind: "allergens_unreviewed",
    products: [
      { id: "bread /?", name: "Staff bread <b>", parentName: null },
      { id: "large", name: "Staff large", parentName: "Staff soup" },
    ],
  },
];
function preview(): MenuPreview {
  return {
    hash: "new",
    changes: [],
    clashes: [],
    warnings: structuredClone(WARNINGS),
    live: null,
    document: menuDocument([], {}),
    status: { state: "unpublished", clashes: 0 },
  };
}
async function mount(theme: Theme = "light", locale = "en") {
  setLocale(locale);
  return mountWidget<MenuPreviewPanel>(
    "dashboard-menu-preview",
    { menuName: "Lunch", preview: preview() },
    theme,
  );
}
function q(el: MenuPreviewPanel, selector: string) {
  return el.shadowRoot!.querySelector<HTMLElement>(selector)!;
}
const before = currentLocale();
beforeEach(() => setLocale("en"));
afterEach(() => {
  cleanupWidgets();
  setLocale(before);
});

describe("allergen publish warnings", () => {
  it("links each product and variant in the warning list and the confirmation without counting them as shortcuts", async () => {
    const { el } = await mount();
    const section = q(el, '[data-test="warnings"]');
    expect(section.textContent).toContain("1 shortcut");
    expect(section.textContent).not.toContain("2 shortcuts");
    expect(section.textContent).toContain("Allergens not yet reviewed");
    const links = [...section.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent!.trim(), a.getAttribute("href")])).toEqual([
      ["Staff bread <b>", "/manage/catalogue/product/bread%20%2F%3F"],
      ["Staff soup (Staff large)", "/manage/catalogue/product/large"],
    ]);
    expect(section.querySelector("b")).toBeNull();
    const published = vi.fn();
    el.addEventListener("wt-menu-publish", published);
    await userEvent.click(q(el, '[data-test="publish"]'));
    await el.updateComplete;
    expect(published).not.toHaveBeenCalled();
    const dialog = q(el, '[data-test="publish-confirmation"]');
    expect([...dialog.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(
      links.map((a) => a.getAttribute("href")),
    );
    await userEvent.click(q(el, '[data-test="publish-confirm"]'));
    expect(published).toHaveBeenCalledTimes(1);
    expect(published.mock.calls[0]![0].detail).toEqual({ hash: "new" });
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('[data-test="publish-confirmation"]')).toBeNull();
  });
  it.each(["replace", "same hash", "null", "failed", "disconnect"])(
    "retires confirmation on %s",
    async (change) => {
      const { el, host } = await mount();
      const published = vi.fn();
      el.addEventListener("wt-menu-publish", published);
      await userEvent.click(q(el, '[data-test="publish"]'));
      await el.updateComplete;
      const oldConfirm = q(el, '[data-test="publish-confirm"]');
      if (change === "disconnect") {
        el.remove();
        await el.updateComplete;
        host.append(el);
      } else if (change === "failed") el.failed = true;
      else if (change === "null") el.preview = null;
      else el.preview = { ...preview(), hash: change === "replace" ? "replacement" : "new" };
      oldConfirm.click();
      await el.updateComplete;
      expect(published).not.toHaveBeenCalled();
    },
  );
  it("keeps modified product clicks for the browser and emits one ordinary navigation event", async () => {
    const { el } = await mount();
    const opened = vi.fn();
    el.addEventListener("wt-edit-product", opened);
    const link = q(el, 'a[href="/manage/catalogue/product/large"]');
    expect(link).not.toBeNull();
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      const click = new MouseEvent("click", {
        ...init,
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      // Avoid actually opening browser tabs while observing whether the component consumed the gesture.
      const prevent = (event: Event) => {
        expect(event.defaultPrevented).toBe(false);
        event.preventDefault();
      };
      document.addEventListener("click", prevent, { once: true });
      link.dispatchEvent(click);
      expect(opened).not.toHaveBeenCalled();
    }
    await userEvent.click(link);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened.mock.calls[0]![0].detail).toEqual({ productId: "large" });
    expect(opened.mock.calls[0]![0].bubbles).toBe(true);
    expect(opened.mock.calls[0]![0].composed).toBe(true);
  });
  it("retains the submitted warnings after preview replacement on success", async () => {
    const { el } = await mount();
    await userEvent.click(q(el, '[data-test="publish"]'));
    await el.updateComplete;
    await userEvent.click(q(el, '[data-test="publish-confirm"]'));
    el.preview = { ...preview(), warnings: [] };
    el.result = { kind: "published", number: 1 };
    await el.updateComplete;
    expect(q(el, '[data-test="result"]').textContent).toContain("Staff soup (Staff large)");
  });
  it.each(["light", "dark"] as const)(
    "renders linked warnings and confirmation accessibly in %s",
    async (theme) => {
      const { el, host } = await mount(theme);
      await expectNoA11yViolations(host);
      await userEvent.click(q(el, '[data-test="publish"]'));
      await el.updateComplete;
      await expectNoA11yViolations(host);
    },
  );
});

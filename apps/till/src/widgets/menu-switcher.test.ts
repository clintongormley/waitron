import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillMenuSwitcher } from "./menu-switcher.js";

const twoMenus = [
  { id: "cat-food", name: "Food", isDefault: true },
  { id: "cat-drinks", name: "Drinks", isDefault: false },
];

/** The interactive option nodes the switcher renders (one per menu). */
function options(el: TillMenuSwitcher): HTMLElement[] {
  return [...el.shadowRoot!.querySelectorAll<HTMLElement>('[data-test^="menu-"]')];
}

afterEach(cleanupWidgets);

describe("till-menu-switcher", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-menu-switcher")).toBe(TillMenuSwitcher);
  });

  it("renders one option per menu, labelled by the menu name, and marks the selected one", async () => {
    const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: twoMenus,
      selectedId: "cat-food",
    });
    const opts = options(el);
    expect(opts).toHaveLength(2);
    expect(opts.map((o) => o.textContent?.trim())).toEqual(["Food", "Drinks"]);
    // The selected menu is marked (aria-pressed) and the others are not.
    expect(
      el.shadowRoot!.querySelector('[data-test="menu-cat-food"]')!.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      el.shadowRoot!.querySelector('[data-test="menu-cat-drinks"]')!.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("emits a composed, bubbling menu-selected with the clicked menu's id — and holds no state itself", async () => {
    const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: twoMenus,
      selectedId: "cat-food",
    });

    let captured: CustomEvent<{ id: string }> | undefined;
    el.addEventListener("menu-selected", (e) => {
      captured = e as CustomEvent<{ id: string }>;
    });
    el.shadowRoot!.querySelector<HTMLElement>('[data-test="menu-cat-drinks"]')!.click();
    await el.updateComplete;

    expect(captured).toBeInstanceOf(CustomEvent);
    expect(captured!.composed).toBe(true);
    expect(captured!.bubbles).toBe(true);
    expect(captured!.detail).toEqual({ id: "cat-drinks" });
    // Presentational: the widget does NOT move its own selection — the parent owns selectedId.
    expect(
      el.shadowRoot!.querySelector('[data-test="menu-cat-food"]')!.getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("renders NOTHING with a single menu — a single-menu venue looks exactly as before", async () => {
    const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: [{ id: "cat-food", name: "Food", isDefault: true }],
      selectedId: "cat-food",
    });
    expect(el.shadowRoot!.querySelector('[data-test^="menu-"]')).toBeNull();
    expect(el.shadowRoot!.textContent?.trim()).toBe("");
  });

  it("renders NOTHING with no menus at all", async () => {
    const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: [],
      selectedId: "",
    });
    expect(el.shadowRoot!.querySelector('[data-test^="menu-"]')).toBeNull();
  });
});

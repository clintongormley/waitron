import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { currentLocale, setLocale } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { TillMenuSwitcher } from "./menu-switcher.js";

const twoMenus = [
  { id: "cat-food", name: "Food", isDefault: true, orderable: true, audience: "customer" as const },
  {
    id: "cat-drinks",
    name: "Drinks",
    isDefault: false,
    orderable: true,
    audience: "staff" as const,
  },
];

function picker(el: TillMenuSwitcher) {
  return el.shadowRoot!.querySelector("wt-combobox")!;
}

function options(el: TillMenuSwitcher): HTMLElement[] {
  return [...(picker(el)?.shadowRoot?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
}

afterEach(cleanupWidgets);

describe("till-menu-switcher", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("till-menu-switcher")).toBe(TillMenuSwitcher);
  });

  it("offers only running menus, with the customer menu before staff menus", async () => {
    const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: [
        { id: "past", name: "Breakfast", isDefault: false, orderable: false, audience: "customer" },
        { id: "staff", name: "Staff lunch", isDefault: false, orderable: true, audience: "staff" },
        { id: "customer", name: "Lunch", isDefault: true, orderable: true, audience: "customer" },
        { id: "future", name: "Dinner", isDefault: false, orderable: false, audience: "customer" },
      ],
      selectedId: "customer",
    });
    const field = picker(el);
    expect(field).not.toBeNull();
    await field.updateComplete;
    await userEvent.click(field.shadowRoot!.querySelector("button")!);
    expect(options(el).map((option) => option.textContent?.trim())).toEqual([
      "Lunch",
      "Staff lunch",
    ]);
    expect(options(el)[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps a long list of running menus selectable without opening a keyboard search", async () => {
    const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: Array.from({ length: 8 }, (_, index) => ({
        ...twoMenus[0]!,
        id: `menu-${index}`,
        name: `Menu ${index + 1}`,
        isDefault: index === 0,
      })),
      selectedId: "menu-0",
    });
    const field = picker(el);
    await userEvent.click(field.shadowRoot!.querySelector("button")!);
    expect(options(el)).toHaveLength(8);
    expect(field.shadowRoot!.querySelector("input")).toBeNull();
  });

  it("takes no space when just one running menu remains among retained menus", async () => {
    const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: [
        { id: "past", name: "Breakfast", isDefault: false, orderable: false, audience: "customer" },
        { id: "customer", name: "Lunch", isDefault: true, orderable: true, audience: "customer" },
      ],
    });
    expect(options(el)).toHaveLength(0);
    expect(el.shadowRoot!.textContent?.trim()).toBe("");
  });

  it("offers no retained menu when the department has no running period", async () => {
    const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: [
        { id: "past", name: "Breakfast", isDefault: false, orderable: false, audience: "customer" },
        { id: "future", name: "Dinner", isDefault: false, orderable: false, audience: "staff" },
      ],
    });
    expect(options(el)).toHaveLength(0);
  });

  it("updates the field label with the till language and shows just the selected menu name", async () => {
    const previous = currentLocale();
    try {
      setLocale("en-GB");
      const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
        menus: twoMenus,
        selectedId: "cat-food",
      });
      const field = picker(el);
      expect(field).not.toBeNull();
      await field.updateComplete;
      expect(field.shadowRoot!.querySelector("label")!.textContent?.trim()).toBe("Menu");
      expect(field.shadowRoot!.querySelector("button .value")!.textContent?.trim()).toBe("Food");
      setLocale("es-ES");
      await el.updateComplete;
      await field.updateComplete;
      expect(field.shadowRoot!.querySelector("label")!.textContent?.trim()).toBe("Carta");
    } finally {
      setLocale(previous);
    }
  });

  it("forwards one keyboard pick and displays only the selection accepted by the parent", async () => {
    const { el, host } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: twoMenus,
      selectedId: "cat-food",
    });
    const field = picker(el);
    expect(field).not.toBeNull();
    await field.updateComplete;
    const events: CustomEvent<{ id: string }>[] = [];
    host.addEventListener("menu-selected", (event) => {
      events.push(event as CustomEvent<{ id: string }>);
    });

    await userEvent.click(field.shadowRoot!.querySelector("button")!);
    await userEvent.keyboard("{End}{Enter}");
    await field.updateComplete;
    expect(events.map(({ detail }) => detail)).toEqual([{ id: "cat-drinks" }]);
    expect(events[0]!.composed).toBe(true);
    expect(events[0]!.bubbles).toBe(true);
    expect(field.shadowRoot!.querySelector("button .value")!.textContent?.trim()).toBe("Food");

    el.selectedId = "cat-drinks";
    await el.updateComplete;
    await field.updateComplete;
    expect(field.shadowRoot!.querySelector("button .value")!.textContent?.trim()).toBe("Drinks");
  });

  it("renders NOTHING with a single menu — a single-menu venue looks exactly as before", async () => {
    const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: [
        {
          id: "cat-food",
          name: "Food",
          isDefault: true,
          orderable: true,
          audience: "customer" as const,
        },
      ],
      selectedId: "cat-food",
    });
    expect(picker(el)).toBeNull();
    expect(el.shadowRoot!.textContent?.trim()).toBe("");
  });

  it("renders NOTHING with no menus at all", async () => {
    const { el } = await mountWidget<TillMenuSwitcher>("till-menu-switcher", {
      menus: [],
      selectedId: "",
    });
    expect(picker(el)).toBeNull();
  });
});

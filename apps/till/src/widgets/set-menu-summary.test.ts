import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { es } from "../i18n/strings.js";
import { currentLocale, fill, setLocale, t } from "../i18n/t.js";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import { bill, courses, seaBass } from "../../test/set-menu-widgets.js";

import { TillSetMenuSummary } from "./set-menu-summary.js";

afterEach(cleanupWidgets);

async function mount(draft = [seaBass], state = bill) {
  return mountWidget<TillSetMenuSummary>("till-set-menu-summary", {
    bill: state,
    draft,
    courseNames: courses,
    dishNames: new Map([
      ["sent-sirloin", "Sirloin"],
      ["sent-soup", "Soup"],
    ]),
  });
}

it("folds to type and open-place counts, then shows sent and unsent dishes in their places", async () => {
  const { el } = await mount();
  const toggle = el.shadowRoot?.querySelector("summary");
  expect(toggle?.textContent).toContain("3 set menus");
  expect(toggle?.textContent).toContain("2 Daily menu + 1 Special menu");
  expect(toggle?.textContent).toContain("4 Starter · 1 Main or Starter · 2 Drink");
  const preview = el.shadowRoot!.querySelector("details")!;
  expect(preview.open).toBe(false);
  await userEvent.click(toggle!);
  expect(preview.open).toBe(true);
  const rows = Array.from(preview.querySelectorAll("article"), (row) => row.textContent);
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain("Sirloin");
  expect(rows[0]).toContain("+€5.00");
  expect(rows[1]).toContain("Open");
  expect(rows[2]).toContain("Sea bass");
  expect(rows[2]).toContain("Not sent");
});

it("uses the Spanish fixed-price count and the included dish tag", async () => {
  const originalLocale = currentLocale();
  try {
    setLocale("es-ES");
    const { el } = await mount();
    const root = el.shadowRoot!;
    expect(root.querySelector("summary")?.textContent).toContain(
      fill(es["set_menu.many"], { n: "3" }),
    );
    expect(root.querySelectorAll("article")[2]?.textContent).toContain(
      `Sea bass ${es["set_menu.tag"]}`,
    );
  } finally {
    setLocale(originalLocale);
  }
});

it("offers Comp on each set menu only when comping is allowed, and names that menu's line", async () => {
  const { el } = await mount();
  const root = el.shadowRoot!;
  await userEvent.click(root.querySelector("summary")!);
  expect(root.querySelector("[data-comp-menu]")).toBeNull();

  const compMenu = vi.fn();
  el.compMenu = compMenu;
  await el.updateComplete;
  const comps = Array.from(root.querySelectorAll<HTMLElement>("[data-comp-menu]"));
  expect(comps.map((button) => button.textContent!.trim())).toEqual([
    t("comp.title"),
    t("comp.title"),
    t("comp.title"),
  ]);
  expect(comps[1]!.getAttribute("aria-label")).toBe(`${t("comp.title")} · Daily menu 2`);
  await userEvent.click(comps[1]!);
  expect(compMenu).toHaveBeenCalledExactlyOnceWith("daily-2", "Daily menu 2");

  el.busy = true;
  await el.updateComplete;
  expect(
    Array.from(
      root.querySelectorAll<HTMLElement & { disabled: boolean }>("[data-comp-menu]"),
      (b) => b.disabled,
    ),
  ).toEqual([true, true, true]);
});

it.each([
  ["en-GB", "These set menus may not be the cheapest for this bill."],
  ["es-ES", es["set_menu.not_cheapest"]],
] as const)(
  "says once in %s when the bill's set menus may not be the cheapest",
  async (locale, text) => {
    const originalLocale = currentLocale();
    try {
      setLocale(locale);
      const { el } = await mount([], { ...bill, exact: false });
      const notes = Array.from(el.shadowRoot!.querySelectorAll("[data-not-cheapest]"), (note) =>
        note.textContent!.trim(),
      );
      expect(notes).toEqual([text]);
      el.bill = bill;
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-not-cheapest]")).toBeNull();
      expect(el.shadowRoot!.textContent).not.toContain(text);
    } finally {
      setLocale(originalLocale);
    }
  },
);

it.each([
  ["en-GB", "Set menus might make this bill cheaper."],
  ["es-ES", es["set_menu.none_maybe_cheaper"]],
] as const)(
  "still says in %s that the bill may not be at its cheapest when the answer holds no set menus",
  async (locale, text) => {
    const originalLocale = currentLocale();
    try {
      setLocale(locale);
      const empty = { ...bill, setMenus: [], dishes: [] };
      const { el } = await mount([], { ...empty, exact: false });
      const notes = Array.from(el.shadowRoot!.querySelectorAll("[data-not-cheapest]"), (note) =>
        note.textContent!.trim(),
      );
      expect(notes).toEqual([text]);
      el.bill = { ...empty, exact: true };
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("[data-not-cheapest]")).toBeNull();
      expect(el.shadowRoot!.textContent!.trim()).toBe("");
    } finally {
      setLocale(originalLocale);
    }
  },
);

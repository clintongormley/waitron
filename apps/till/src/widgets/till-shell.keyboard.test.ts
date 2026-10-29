import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, mountWidget } from "./test-helpers.js";
import "./till-shell.js";
import type { TillShell } from "./till-shell.js";

const tables = [
  { tableId: "t1", name: "T1", unsent: true, current: false, held: false },
  { tableId: "t2", name: "T2", unsent: false, current: false, held: true },
];
const tabsOf = (el: TillShell) => [
  ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('header [role="tab"]'),
];

afterEach(cleanupWidgets);

it("puts only the selected handheld tab in the Tab sequence", async () => {
  const { el } = await mountWidget<TillShell>("till-shell", {
    formFactor: "phone-portrait",
    activeScreen: "floor",
    barTables: tables,
  });
  expect(tabsOf(el).map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  el.activeScreen = "order";
  el.barTables = tables.map((table) => ({ ...table, current: table.tableId === "t2" }));
  await el.updateComplete;
  expect(tabsOf(el).map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
});

it("wraps Left and Right across Floor and tables, and selects the ends with Home and End", async () => {
  const { el } = await mountWidget<TillShell>("till-shell", {
    formFactor: "phone-portrait",
    activeScreen: "floor",
    barTables: tables,
  });
  const selected = vi.fn();
  el.addEventListener("screen-select", (event) => {
    const detail = (event as CustomEvent<{ screen: "floor" }>).detail;
    selected(detail);
    el.activeScreen = detail.screen;
    el.barTables = tables;
  });
  el.addEventListener("open-bar-table", (event) => {
    const detail = (event as CustomEvent<{ tableId: string; held: boolean }>).detail;
    selected(detail);
    el.activeScreen = "order";
    el.barTables = tables.map((table) => ({ ...table, current: table.tableId === detail.tableId }));
  });
  tabsOf(el)[0]!.focus();
  for (const [key, index, detail] of [
    ["ArrowLeft", 2, { tableId: "t2", held: true }],
    ["ArrowRight", 0, { screen: "floor" }],
    ["ArrowRight", 1, { tableId: "t1", held: false }],
    ["End", 2, { tableId: "t2", held: true }],
    ["Home", 0, { screen: "floor" }],
  ] as const) {
    selected.mockClear();
    await userEvent.keyboard(`{${key}}`);
    await el.updateComplete;
    const tabs = tabsOf(el);
    expect(selected).toHaveBeenCalledExactlyOnceWith(detail);
    expect(el.shadowRoot!.activeElement).toBe(tabs[index]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual(tabs.map((_, i) => (i === index ? 0 : -1)));
    expect(tabs[index]!.getAttribute("aria-selected")).toBe("true");
  }
  await userEvent.keyboard("{ArrowDown}");
  expect(selected).toHaveBeenCalledTimes(1);
});

it.each(["ltr", "rtl"])(
  "keeps keyboard focus visible while selection is deferred, in %s",
  async (direction) => {
    const before = { width: innerWidth, height: innerHeight };
    await page.viewport(390, 844);
    try {
      const { el, host } = await mountWidget<TillShell>("till-shell", {
        formFactor: "phone-portrait",
        activeScreen: "floor",
        barTables: Array.from({ length: 10 }, (_, i) => ({
          tableId: `t${i + 1}`,
          name: `T${i + 1}`,
          unsent: true,
          current: false,
          held: false,
        })),
      });
      host.dir = direction;
      const selected = vi.fn();
      el.addEventListener("open-bar-table", (event) => selected((event as CustomEvent).detail));
      const tabs = tabsOf(el);
      tabs[0]!.focus();
      const scrollY = window.scrollY;
      await userEvent.keyboard("{End}");
      expect(selected).toHaveBeenCalledExactlyOnceWith({ tableId: "t10", held: false });
      expect(el.shadowRoot!.activeElement).toBe(tabs[10]);
      const strip = el.shadowRoot!.querySelector<HTMLElement>(".bar-tables")!;
      await vi.waitFor(() => {
        const box = tabs[10]!.getBoundingClientRect();
        const view = strip.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(view.left - 0.5);
        expect(box.right).toBeLessThanOrEqual(view.right + 0.5);
      });
      expect(window.scrollY).toBe(scrollY);
      expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
      expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]);
    } finally {
      await page.viewport(before.width, before.height);
    }
  },
);

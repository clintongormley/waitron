import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
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

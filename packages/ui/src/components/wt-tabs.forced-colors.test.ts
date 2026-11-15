import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import type { WtTabs } from "./wt-tabs.js";
import "./wt-tabs.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

async function tabs(): Promise<{ selected: HTMLElement; unselected: HTMLElement; el: WtTabs }> {
  const el = (await mount(
    '<wt-tabs label="Venue operations"><div slot="status">Ready</div><div slot="menus">Menus</div></wt-tabs>',
  )) as WtTabs;
  el.items = [
    { key: "status", label: "Status" },
    { key: "menus", label: "Menus" },
  ];
  await el.updateComplete;
  const [selected, unselected] = [...el.shadowRoot!.querySelectorAll<HTMLElement>("button")];
  return { selected: selected!, unselected: unselected!, el };
}

test("only the selected tab is underlined under forced colours", async () => {
  const { selected, unselected, el } = await tabs();
  expect(selected.getAttribute("aria-selected")).toBe("true");
  const at = await elementPixels(el);
  const underline = (tab: HTMLElement) => {
    const box = tab.getBoundingClientRect();
    return at(box.left + box.width / 2, box.bottom - 1.5);
  };
  const box = unselected.getBoundingClientRect();
  const background = at(box.left + 2, box.top + 2);
  expect(underline(selected)).not.toEqual(background);
  expect(underline(unselected)).toEqual(background);
  expect(selected.offsetHeight).toBe(unselected.offsetHeight);
});

test("outside forced colours an unselected tab's underline is still transparent", async () => {
  await emulateForcedColours("none");
  const { unselected } = await tabs();
  expect(getComputedStyle(unselected).borderBottomColor).toBe("rgba(0, 0, 0, 0)");
});

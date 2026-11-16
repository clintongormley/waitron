import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import type { WtCombobox } from "./wt-combobox.js";
import "./wt-combobox.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

async function combobox(search: "never" | "always") {
  const el = (await mount('<wt-combobox label="Department"></wt-combobox>')) as WtCombobox;
  el.search = search;
  el.options = [
    { value: "bar", label: "Bar" },
    { value: "dining", label: "Dining room" },
  ];
  await el.updateComplete;
  return el;
}

test("an open non-search list keeps the field's focus edge without using its invalid line", async () => {
  const el = await combobox("never");
  const field = el.shadowRoot!.querySelector<HTMLElement>(".field")!;
  const box = field.getBoundingClientRect();
  const before = await elementPixels(el);
  el.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
  await expect.poll(() => field.hasAttribute("data-open")).toBe(true);
  expect(el.shadowRoot!.activeElement?.getAttribute("role")).toBe("listbox");
  const at = await elementPixels(el);
  expect(at(box.left + 1, box.top + box.height / 2)).not.toEqual(
    before(box.left + 1, box.top + box.height / 2),
  );
  expect(getComputedStyle(field, "::after").borderBottomWidth).toBe("1px");
  el.invalid = true;
  await el.updateComplete;
  expect(getComputedStyle(field, "::after").borderBottomWidth).toBe("2px");
});

test("the searchable list draws an outline around its focused search", async () => {
  const el = await combobox("always");
  el.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
  const panel = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  await expect.poll(() => panel.matches(":popover-open")).toBe(true);
  const search = el.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  expect(el.shadowRoot!.activeElement).toBe(search);
  const box = search.getBoundingClientRect();
  const at = await elementPixels(panel);
  expect(at(box.left - 3, box.top + box.height / 2)).not.toEqual(
    at(box.left - 7, box.top + box.height / 2),
  );
});

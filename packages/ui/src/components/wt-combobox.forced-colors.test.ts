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
  const invalid = await elementPixels(el);
  expect(invalid(box.left + 1, box.top + box.height / 2)).toEqual(
    before(box.left + 1, box.top + box.height / 2),
  );
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

test("a boxed field keeps a real border, thicker when highlighted, and no filled-look line", async () => {
  const el = await combobox("never");
  el.look = "boxed";
  el.value = "bar";
  await el.updateComplete;
  const field = el.shadowRoot!.querySelector<HTMLElement>(".field")!;
  expect(getComputedStyle(field).borderTopStyle).toBe("solid");
  expect(getComputedStyle(field).borderTopWidth).toBe("1px");
  expect(getComputedStyle(field, "::after").content).toBe("none");
  const box = field.getBoundingClientRect();
  const plain = await elementPixels(el);
  el.highlight = true;
  await el.updateComplete;
  expect(getComputedStyle(field).borderTopWidth).toBe("2px");
  const highlighted = await elementPixels(el);
  expect(highlighted(box.left + box.width / 2, box.top + 1.5)).not.toEqual(
    plain(box.left + box.width / 2, box.top + 1.5),
  );
});

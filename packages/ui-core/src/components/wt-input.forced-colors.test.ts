import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import "./wt-input.js";

type Pixel = number[];

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

const same = (a: Pixel, b: Pixel) => a.every((v, i) => Math.abs(v - b[i]!) <= 8);

function fieldOf(el: HTMLElement): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(".field")!;
}

/** How many px rows up from the field's bottom edge, at a point clear of the label, are not the
 * field's own background. */
async function edgeRows(field: HTMLElement): Promise<number> {
  const box = field.getBoundingClientRect();
  const at = await elementPixels(field);
  const x = box.left + 6;
  const background = at(x, box.top + box.height / 2);
  let rows = 0;
  while (rows < 8 && !same(at(x, box.bottom - 0.5 - rows), background)) rows += 1;
  return rows;
}

test("a field draws its bottom edge, a thicker one while focused, and one disabled line", async () => {
  const el = await mount('<wt-input label="Name"></wt-input>');
  const field = fieldOf(el);
  const resting = await edgeRows(field);
  expect(resting).toBeGreaterThan(0);

  el.shadowRoot!.querySelector("input")!.focus();
  expect(await edgeRows(field)).toBeGreaterThan(resting);

  const disabled = await mount('<wt-input label="Name" disabled></wt-input>');
  const disabledField = fieldOf(disabled);
  const box = disabledField.getBoundingClientRect();
  const at = await elementPixels(disabledField);
  const background = at(box.left + 6, box.top + box.height / 2);
  const inkIn = (y: number) => {
    let ink = 0;
    for (let x = box.left + 1; x < box.right - 1; x += 1) if (!same(at(x, y), background)) ink += 1;
    return ink;
  };
  // A dashed line: some of the bottom row is drawn, and only that row.
  expect(inkIn(box.bottom - 0.5)).toBeGreaterThan(0);
  expect(inkIn(box.bottom - 0.5)).toBeLessThan(box.width - 2);
  expect(inkIn(box.bottom - 0.5 - resting)).toBe(0);
});

test("an invalid field's bottom edge is thicker than a valid one's, at the same height", async () => {
  const valid = fieldOf(await mount('<wt-input label="Name"></wt-input>'));
  const invalid = fieldOf(await mount('<wt-input label="Name" invalid></wt-input>'));
  expect(await edgeRows(invalid)).toBeGreaterThan(await edgeRows(valid));
  expect(invalid.offsetHeight).toBe(valid.offsetHeight);
});

test("outside forced colours the field's line is still its box-shadow", async () => {
  await emulateForcedColours("none");
  const el = await mount('<wt-input label="Name"></wt-input>');
  const field = fieldOf(el);
  expect(getComputedStyle(field).boxShadow).toMatch(/inset/);
  expect(getComputedStyle(field).borderBottomStyle).toBe("none");
  expect(getComputedStyle(field, "::after").content).toBe("none");
});

test("the theme does not change a field's height", async () => {
  await emulateForcedColours("none");
  const field = fieldOf(await mount('<wt-input label="Name"></wt-input>'));
  const without = field.offsetHeight;
  await emulateForcedColours("active");
  expect(field.offsetHeight).toBe(without);
});

test("a focused invalid field's bottom edge is still thicker than a focused valid one's", async () => {
  const focusedEdge = async (markup: string) => {
    const el = await mount(markup);
    el.shadowRoot!.querySelector("input")!.focus();
    return edgeRows(fieldOf(el));
  };
  const valid = await focusedEdge('<wt-input label="Name"></wt-input>');
  expect(await focusedEdge('<wt-input label="Name" invalid></wt-input>')).toBeGreaterThan(valid);
});

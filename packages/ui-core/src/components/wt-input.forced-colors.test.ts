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

type Edges = Record<"top" | "right" | "bottom" | "left", number>;

/** How many px in from each edge of the field, at the middle of that edge, are not its background. */
async function outlineEdges(field: HTMLElement): Promise<Edges> {
  const box = field.getBoundingClientRect();
  const at = await elementPixels(field);
  const midX = box.left + box.width / 2;
  const midY = box.top + box.height / 2;
  const background = at(midX, midY);
  const inkFrom = (point: (step: number) => [number, number]) => {
    let steps = 0;
    while (steps < 8 && !same(at(...point(steps)), background)) steps += 1;
    return steps;
  };
  return {
    top: inkFrom((step) => [midX, box.top + 0.5 + step]),
    right: inkFrom((step) => [box.right - 0.5 - step, midY]),
    bottom: inkFrom((step) => [midX, box.bottom - 0.5 - step]),
    left: inkFrom((step) => [box.left + 0.5 + step, midY]),
  };
}

function expectEverySide(edges: Edges, compare: (side: keyof Edges, width: number) => void): void {
  for (const side of ["top", "right", "bottom", "left"] as const) compare(side, edges[side]);
}

const OUTLINED = '<wt-input variant="outlined" label="Find"></wt-input>';

test("an outlined field draws its outline on every side, thicker while focused and when invalid", async () => {
  const el = await mount(OUTLINED);
  const field = fieldOf(el);
  const resting = await outlineEdges(field);
  expectEverySide(resting, (side, width) => expect(width, side).toBeGreaterThan(0));

  el.shadowRoot!.querySelector("input")!.focus();
  expectEverySide(await outlineEdges(field), (side, width) =>
    expect(width, side).toBeGreaterThan(resting[side]),
  );

  const invalid = fieldOf(await mount(OUTLINED.replace("<wt-input ", "<wt-input invalid ")));
  expectEverySide(await outlineEdges(invalid), (side, width) =>
    expect(width, side).toBeGreaterThan(resting[side]),
  );
  // The danger colour is repainted away here, so only the width tells invalid apart.
  expect(getComputedStyle(invalid).borderLeftWidth).toBe(getComputedStyle(field).borderLeftWidth);
  expect(getComputedStyle(invalid).borderLeftWidth).not.toBe("1px");
  expect(invalid.offsetHeight).toBe(field.offsetHeight);
});

test("a focused invalid outlined field's edge is still thicker than a focused valid one's", async () => {
  const focusedEdges = async (markup: string) => {
    const el = await mount(markup);
    el.shadowRoot!.querySelector("input")!.focus();
    return outlineEdges(fieldOf(el));
  };
  const valid = await focusedEdges(OUTLINED);
  const invalid = await focusedEdges(OUTLINED.replace("<wt-input ", "<wt-input invalid "));
  expectEverySide(invalid, (side, width) => expect(width, side).toBeGreaterThan(valid[side]));
});

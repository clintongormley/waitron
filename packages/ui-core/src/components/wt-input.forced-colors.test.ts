/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { cleanup, mount } from "../test-helpers.js";
import "./wt-input.js";

type Pixel = number[];

async function emulateForcedColours(value: "active" | "none"): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "forced-colors", value }],
  });
}

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours("none");
});

/** Reads an element's pixels from a real screenshot, at points in page px. */
async function pixels(el: Element): Promise<(x: number, y: number) => Pixel> {
  const shot: unknown = await page.screenshot({ element: el, base64: true, save: false });
  const image = new Image();
  image.src = `data:image/png;base64,${shot as string}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const box = el.getBoundingClientRect();
  const k = image.width / box.width;
  return (x, y) => [
    ...context
      .getImageData(Math.floor((x - box.left) * k), Math.floor((y - box.top) * k), 1, 1)
      .data.slice(0, 3),
  ];
}

const same = (a: Pixel, b: Pixel) => a.every((v, i) => Math.abs(v - b[i]!) <= 8);

function fieldOf(el: HTMLElement): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(".field")!;
}

/** How many px rows up from the field's bottom edge, at a point clear of the label, are not the
 * field's own background. */
async function edgeRows(field: HTMLElement): Promise<number> {
  const box = field.getBoundingClientRect();
  const at = await pixels(field);
  const x = box.left + 6;
  const background = at(x, box.top + box.height / 2);
  let rows = 0;
  while (rows < 8 && !same(at(x, box.bottom - 0.5 - rows), background)) rows += 1;
  return rows;
}

test("forced-colours emulation applies: the control loses its background and shadow", async () => {
  expect(matchMedia("(forced-colors: active)").matches).toBe(true);
  const control = await mount(
    '<div style="width: 40px; height: 40px; background: rgb(255, 0, 0); box-shadow: inset 0 0 0 10px rgb(0, 0, 255)"></div>',
  );
  const at = await pixels(control);
  const box = control.getBoundingClientRect();
  expect(same(at(box.left + 20, box.top + 20), [255, 0, 0])).toBe(false);
  expect(same(at(box.left + 2, box.top + 2), [0, 0, 255])).toBe(false);
});

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
  const at = await pixels(disabledField);
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

test("outside forced colours the field's line is still its box-shadow", async () => {
  await emulateForcedColours("none");
  const el = await mount('<wt-input label="Name"></wt-input>');
  const field = fieldOf(el);
  expect(getComputedStyle(field).boxShadow).toMatch(/inset/);
  expect(getComputedStyle(field).borderBottomStyle).toBe("none");
});

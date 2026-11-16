import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import type { WtColourChooser } from "./wt-colour-chooser.js";
import "./wt-colour-chooser.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

async function chooser() {
  const el = (await mount(
    '<wt-colour-chooser label="Colour" value="red"></wt-colour-chooser>',
  )) as WtColourChooser;
  el.choices = [
    { value: "red", label: "Red", fill: "rgb(200, 30, 40)" },
    { value: "blue", label: "Blue", fill: "rgb(20, 40, 210)" },
  ];
  await el.updateComplete;
  return el;
}

test("the checked tile has an inner ring distinct from its outer focus ring", async () => {
  const el = await chooser();
  el.show();
  const panel = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  const [checked, other] = [...el.shadowRoot!.querySelectorAll<HTMLElement>(".tile")];
  const a = checked!.getBoundingClientRect();
  const b = other!.getBoundingClientRect();
  expect(a.width).toBe(b.width);
  expect(a.height).toBe(b.height);
  checked!.blur();
  const at = await elementPixels(panel);
  expect(at(a.left + a.width / 2, a.top + 2)).not.toEqual(at(b.left + b.width / 2, b.top + 2));
  checked!.focus();
  expect(checked!.matches(":focus-visible")).toBe(true);
  const focused = await elementPixels(panel);
  expect(focused(a.left + a.width / 2, a.top + 2)).not.toEqual(
    focused(b.left + b.width / 2, b.top + 2),
  );
  expect(focused(a.left + a.width / 2, a.top - 3)).not.toEqual(
    focused(a.left + a.width / 2, a.top - 7),
  );
});

test("trigger and panel swatches preserve their actual supplied colours", async () => {
  const el = await chooser();
  const swatch = el.shadowRoot!.querySelector(".trigger .swatch")!;
  const box = swatch.getBoundingClientRect();
  expect((await elementPixels(el))(box.left + box.width / 2, box.top + box.height / 2)).toEqual([
    200, 30, 40,
  ]);
  el.show();
  const panel = el.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  const at = await elementPixels(panel);
  const colours = [...panel.querySelectorAll(".swatch")].map((item) => {
    const b = item.getBoundingClientRect();
    return at(b.left + b.width / 2, b.top + b.height / 2);
  });
  expect(colours).toEqual([
    [200, 30, 40],
    [20, 40, 210],
  ]);
});

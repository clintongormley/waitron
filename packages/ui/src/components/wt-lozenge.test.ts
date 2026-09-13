import { afterEach, expect, test } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import { readableTextColor } from "../category-color.js";
import type { WtLozenge } from "./wt-lozenge.js";
import "./wt-lozenge.js";

afterEach(cleanup);

test("a coloured lozenge paints the colour and readable text", async () => {
  const el = (await mount('<wt-lozenge color="#dd9e5f">Breakfast</wt-lozenge>')) as WtLozenge;
  const chip = el.shadowRoot!.querySelector("span")!;
  const style = getComputedStyle(chip);
  expect(style.backgroundColor).toBe("rgb(221, 158, 95)");
  // readableTextColor('#dd9e5f') is '#000000'
  expect(readableTextColor("#dd9e5f")).toBe("#000000");
  expect(style.color).toBe("rgb(0, 0, 0)");
  // The label is slotted, not shadow-rendered text, so it reads off the host's own light-DOM
  // content — a slot's assigned nodes are never DOM descendants of the <slot> element itself, so
  // `chip.textContent` (the shadow `<span>`) is always "" regardless of what's slotted in.
  expect(el.textContent).toContain("Breakfast");
});

test("a colourless lozenge uses the neutral token chrome", async () => {
  const el = (await mount("<wt-lozenge>Sundries</wt-lozenge>")) as WtLozenge;
  const chip = el.shadowRoot!.querySelector("span")!;
  el.style.setProperty("--wt-color-surface", "rgb(1, 2, 3)");
  await el.updateComplete;
  expect(getComputedStyle(chip).backgroundColor).toBe("rgb(1, 2, 3)");
});

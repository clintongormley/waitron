import { expect, test, afterEach } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import { registerIcons, type WtIcon } from "./wt-icon.js";
import "./wt-icon.js";

afterEach(cleanup);

test("renders a registered icon", async () => {
  registerIcons({ check: "M2 8 L6 12 L14 4" });
  const el = await mount('<wt-icon name="check"></wt-icon>');
  const path = el.shadowRoot!.querySelector("path");
  expect(path?.getAttribute("d")).toBe("M2 8 L6 12 L14 4");
});

test("renders nothing for an unregistered icon", async () => {
  const el = await mount('<wt-icon name="nope"></wt-icon>');
  expect(el.shadowRoot!.querySelector("path")).toBeNull();
});

test("inherits colour from its context", async () => {
  registerIcons({ check: "M2 8 L6 12 L14 4" });
  const el = await mount('<wt-icon name="check"></wt-icon>');
  el.style.color = "rgb(4, 5, 6)";
  const svg = el.shadowRoot!.querySelector("svg")!;
  expect(getComputedStyle(svg).fill).toBe("rgb(4, 5, 6)");
});

test("an icon given no name reports an empty one and draws no glyph", async () => {
  const el = await mount("<wt-icon></wt-icon>");
  expect((el as WtIcon).name).toBe("");
  expect(el.getAttribute("name")).toBe("");
  expect(el.shadowRoot!.querySelector("svg")).toBeNull();
});

test("an icon takes the medium size unless another is asked for", async () => {
  registerIcons({ check: "M2 8 L6 12 L14 4" });
  const md = await mount('<wt-icon name="check"></wt-icon>');
  const sm = await mount('<wt-icon name="check" size="sm"></wt-icon>');
  const lg = await mount('<wt-icon name="check" size="lg"></wt-icon>');
  expect((md as WtIcon).size).toBe("md");
  // The size is mirrored onto the host attribute, which is what the size rules select on.
  expect(md.getAttribute("size")).toBe("md");
  const widthOf = (el: HTMLElement) => getComputedStyle(el).width;
  expect(new Set([widthOf(sm), widthOf(md), widthOf(lg)]).size).toBe(3);
});

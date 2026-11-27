import { afterEach, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import "../index.js";

afterEach(cleanup);

it("paints a motionless shape with the parent's size and the theme's surface and radius", async () => {
  const shape = await mount('<wt-placeholder style="width: 72px; height: 36px"></wt-placeholder>');
  const reference = document.createElement("div");
  reference.style.backgroundColor = "var(--wt-color-surface-sunken)";
  reference.style.borderRadius = "var(--wt-radius-md)";
  host.append(reference);

  const style = getComputedStyle(shape);
  const tokens = getComputedStyle(reference);
  expect(style.backgroundColor).toBe(tokens.backgroundColor);
  expect(style.borderRadius).toBe(tokens.borderRadius);
  expect(style.animationName).toBe("none");
  expect(shape.getBoundingClientRect()).toMatchObject({ width: 72, height: 36 });
});

it("keeps the space but drops decorative paint in forced colours", async () => {
  try {
    await commands.emulateForcedColors("active");
    const shape = await mount('<wt-placeholder style="height: 36px"></wt-placeholder>');

    expect(shape.getBoundingClientRect().height).toBe(36);
    expect(getComputedStyle(shape).backgroundColor).toMatch(/^rgba\(\d+, \d+, \d+, 0\)$/);
  } finally {
    await commands.emulateForcedColors(null);
  }
});

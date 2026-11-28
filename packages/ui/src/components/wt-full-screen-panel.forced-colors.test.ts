import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, emulateForcedColours, mount } from "../test-helpers.js";
import "./wt-full-screen-panel.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

test("a rising panel keeps a visible top edge when forced colours remove its shadow", async () => {
  const panel = await mount(
    '<wt-full-screen-panel rising body-label="Menu"></wt-full-screen-panel>',
  );
  const edge = getComputedStyle(panel);
  expect(edge.boxShadow).toBe("none");
  expect(edge.borderTopStyle).toBe("solid");
  expect(edge.borderTopWidth).toBe("1px");
  expect(edge.borderTopColor).not.toBe(edge.backgroundColor);
});

test("a plain panel draws no top edge in forced colours", async () => {
  const panel = await mount('<wt-full-screen-panel body-label="Menu"></wt-full-screen-panel>');
  expect(getComputedStyle(panel).borderTopStyle).toBe("none");
});

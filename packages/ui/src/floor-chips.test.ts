import { afterEach, expect, it } from "vitest";
import { FLOOR_CUE_ICONS } from "./floor-chips.js";
import { cleanup, mount } from "./test-helpers.js";
import "./components/wt-icon.js";

afterEach(cleanup);

it("lists the eleven cue icons", () => {
  expect(FLOOR_CUE_ICONS).toEqual([
    "floor-timer",
    "floor-out",
    "floor-bill",
    "floor-ready",
    "floor-step",
    "floor-unsent",
    "floor-clear",
    "floor-move",
    "floor-held",
    "floor-fire",
    "floor-check",
  ]);
});

it.each(FLOOR_CUE_ICONS)("registers %s", async (name) => {
  const icon = await mount(`<wt-icon name="${name}"></wt-icon>`);
  const path = icon.shadowRoot!.querySelector("svg path");
  expect(path).not.toBeNull();
  expect(path!.getAttribute("d") ?? "").not.toBe("");
});

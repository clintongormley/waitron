import { afterEach, expect, test } from "vitest";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import "./wt-initials.js";

afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

test("keeps the circle visible in forced colours", async () => {
  await emulateForcedColours("active");
  const el = await mount('<wt-initials name="Javier Torres"></wt-initials>');
  const badge = el.shadowRoot?.querySelector("span");
  expect(badge).toBeTruthy();
  const box = badge!.getBoundingClientRect();
  const pixel = await elementPixels(el);
  const middle = box.left + box.width / 2;
  expect(pixel(middle, box.top + 3)).not.toEqual(pixel(box.left + 3, box.top + 3));
});

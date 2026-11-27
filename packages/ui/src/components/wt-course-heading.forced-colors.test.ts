import { afterEach, beforeEach, expect, test } from "vitest";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import "./wt-course-heading.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

const SENT = '<wt-course-heading mark="sent" mark-label="Sent">Drinks</wt-course-heading>';
const pill = (el: Element) => el.shadowRoot!.querySelector<HTMLElement>('[part="mark"]')!;

test("the sent mark keeps a drawn edge under forced colours", async () => {
  const el = await mount(SENT);
  const box = pill(el).getBoundingClientRect();
  const at = await elementPixels(el);
  const x = box.left + box.width / 2;
  const edge = at(x, box.top + 0.5);
  expect(edge).not.toEqual(at(x, box.top - 2));
  expect(edge).not.toEqual(at(x, box.top + 2.5));
});

test("the sent mark is the same size with the theme on or off", async () => {
  const forced = pill(await mount(SENT)).getBoundingClientRect();
  cleanup();
  await emulateForcedColours("none");
  const plain = pill(await mount(SENT)).getBoundingClientRect();
  expect([forced.width, forced.height]).toEqual([plain.width, plain.height]);
});

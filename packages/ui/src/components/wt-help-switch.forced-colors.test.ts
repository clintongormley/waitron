import { afterEach, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, elementPixels, emulateForcedColours, mount } from "../test-helpers.js";
import { setHelpMode } from "../help-mode.js";
import type { WtHelpSwitch } from "./wt-help-switch.js";
import "./wt-help-switch.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  setHelpMode(false);
  await emulateForcedColours(null);
});

test("Help ON fills its icon while keyboard focus remains outside it", async () => {
  const wrapper = await mount(
    '<div style="padding: 20px"><button>Before</button><wt-help-switch></wt-help-switch></div>',
  );
  const el = wrapper.querySelector<WtHelpSwitch>("wt-help-switch")!;
  await el.updateComplete;
  const icon = el.shadowRoot!.querySelector(".icon")!;
  const box = icon.getBoundingClientRect();
  const sample = async () => (await elementPixels(wrapper))(box.left + 5, box.top + 5);
  const off = await sample();
  setHelpMode(true);
  await el.updateComplete;
  expect(await sample()).not.toEqual(off);
  wrapper.querySelector("button")!.focus();
  await userEvent.tab();
  const button = el.shadowRoot!.querySelector("button")!;
  expect(button.matches(":focus-visible")).toBe(true);
  const at = await elementPixels(wrapper);
  const b = button.getBoundingClientRect();
  expect(at(b.left + b.width / 2, b.top - 3)).not.toEqual(at(b.left - 8, b.top - 3));
});

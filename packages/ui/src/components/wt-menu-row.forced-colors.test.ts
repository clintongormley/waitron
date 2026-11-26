import { afterEach, beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, emulateForcedColours, mount } from "../test-helpers.js";
import "./wt-menu-row.js";

beforeEach(() => emulateForcedColours("active"));
afterEach(async () => {
  cleanup();
  await emulateForcedColours(null);
});

test("a menu row retains its divider and keyboard focus in forced colours", async () => {
  const row = await mount('<wt-menu-row action label="Guests" divider></wt-menu-row>');
  const button = row.shadowRoot!.querySelector("button");
  expect(button?.textContent?.trim()).toBe("Guests");
  await userEvent.tab();
  expect(button!.matches(":focus-visible")).toBe(true);
  const border = getComputedStyle(row);
  expect(border.borderBottomStyle).toBe("solid");
  expect(border.borderBottomColor).not.toBe(border.backgroundColor);
  const focus = getComputedStyle(button!);
  expect(focus.outlineStyle).toBe("solid");
});

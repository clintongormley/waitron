import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { chooseOption, cleanup } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { OrdinaryDateDialog } from "./ordinary-date-dialog.js";
import "./ordinary-date-dialog.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
async function mount(theme: "light" | "dark", state: string) {
  const el = (await mountThemed(
    "<ordinary-date-dialog></ordinary-date-dialog>",
    theme,
  )) as OrdinaryDateDialog;
  el.date = "2026-12-10";
  el.season = { id: "winter", name: "Winter" };
  el.tint = "1";
  el.specialDays =
    state === "no special days" ? [] : [{ id: "d1", name: "Christmas company dinners" }];
  el.open = true;
  await el.updateComplete;
  if (state === "chosen") {
    await chooseOption(el.shadowRoot!.querySelector("wt-combobox")!, "d1");
    await el.updateComplete;
  }
  expect(el.shadowRoot!.querySelector("wt-modal")).not.toBeNull();
  return el;
}

describe.each(["light", "dark"] as const)("ordinary-date-dialog in %s", (theme) => {
  test.each(["with special days", "chosen", "no special days"])(
    "has no a11y violations: %s",
    async (state) => {
      const el = await mount(theme, state);
      await expectNoA11yViolations(el);
    },
  );
});

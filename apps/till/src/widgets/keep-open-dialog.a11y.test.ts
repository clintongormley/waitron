import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { setLocale } from "../i18n/t.js";
import type { TillKeepOpenDialog } from "./keep-open-dialog.js";
import "./keep-open-dialog.js";
beforeEach(() => setLocale("es"));
afterEach(() => {
  cleanupWidgets();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("keep-open dialog %s", (theme) => {
  it.each([
    "unchanged",
    "chosen",
    "empty",
    "busy",
    "refused",
    "ended",
    "extended",
    "delay",
    "drop",
  ])("has no violations when %s", async (state) => {
    const { el, host } = await mountWidget<TillKeepOpenDialog>(
      "till-keep-open-dialog",
      {
        period: {
          id: "lunch",
          name: "Comida",
          endsAt: "14:00",
          running: state !== "ended",
          extendedUntil: state === "extended" ? "14:30" : null,
          choices: state === "empty" ? [] : ["14:15", "14:30", "19:00", "19:15", "05:00"],
          next: { name: "Cena", startsAt: "19:00" },
        },
        busy: state === "busy",
        refusal: state === "refused" ? "period_extension.invalid" : null,
        refusalField: state === "refused" ? "until" : null,
      },
      theme,
    );
    expect(el.shadowRoot).not.toBeNull();
    if (["chosen", "delay", "drop", "busy"].includes(state)) {
      el.selected = state === "delay" ? "19:15" : state === "drop" ? "05:00" : "14:30";
      await el.updateComplete;
    }
    await expectNoA11yViolations(host);
  });
});

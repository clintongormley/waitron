import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { SeasonChip, SeasonChips } from "./season-chips.js";
import "./season-chips.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
const seasons: SeasonChip[] = [
  { id: "sp", name: "Spring", startsOn: "03-01", lastDay: "05-31", colour: "green" },
  { id: "su", name: "Summer", startsOn: "06-01", lastDay: "08-31", colour: "amber" },
  { id: "a", name: "Autumn", startsOn: "09-01", lastDay: "11-30", colour: "orange" },
  { id: "w", name: "Winter", startsOn: "12-01", lastDay: "02-29", colour: "blue" },
];

async function mount(theme: "light" | "dark", state: string) {
  const el = (await mountThemed("<season-chips></season-chips>", theme)) as SeasonChips;
  el.seasons = state === "empty" ? [] : seasons;
  el.readOnly = state === "read-only";
  await el.updateComplete;
  return el;
}

describe.each(["light", "dark"] as const)("Season chips (%s)", (theme) => {
  test.each(["chips", "read-only", "empty"])("%s", async (state) => {
    setLocale("en");
    const el = await mount(theme, state);
    expect(el.shadowRoot!.querySelectorAll("[data-season]")).toHaveLength(
      state === "empty" ? 0 : 4,
    );
    expect(el.shadowRoot!.querySelector("wt-modal")).toBeNull();
    await expectNoA11yViolations(host);
  });
});

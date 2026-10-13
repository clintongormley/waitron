import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { SeasonChips } from "./season-chips.js";
import type { SeasonDialog } from "./season-dialog.js";
import "./season-chips.js";

afterEach(() => {
  cleanup();
  setLocale("en");
});
const seasons = [
  { id: "sp", name: "Spring", startsOn: "03-01", lastDay: "05-31" },
  { id: "su", name: "Summer", startsOn: "06-01", lastDay: "08-31" },
  { id: "a", name: "Autumn", startsOn: "09-01", lastDay: "11-30" },
  { id: "w", name: "Winter", startsOn: "12-01", lastDay: "02-29" },
];
const api = {
  saveSeason: async () => {
    throw { code: "season.invalid", params: { field: "name", reason: "taken" } };
  },
  addSeason: async () => {
    throw {
      code: "season.invalid",
      params: { field: "startsOn", reason: "end_offset", seasonId: "a", weekday: 5 },
    };
  },
  deleteSeason: async () => {},
  readSeasonDeleteImpact: async () => ({ departments: [{ id: "b", name: "Bar" }] }),
};

async function mount(theme: "light" | "dark", state: string) {
  const el = (await mountThemed("<season-chips></season-chips>", theme)) as SeasonChips;
  el.seasons = seasons;
  el.clockRevision = 1;
  el.api = api as never;
  el.readOnly = state === "read-only";
  await el.updateComplete;
  const root = el.shadowRoot!;
  const dialog = async () => {
    const shown = root.querySelector<SeasonDialog>("season-dialog")!;
    await shown.updateComplete;
    return shown;
  };
  const change = async (name: string, value: string) => {
    (await dialog())
      .shadowRoot!.querySelector(`[name="${name}"]`)!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
    await (
      await dialog()
    ).updateComplete;
  };
  const press = async (test: string) => {
    (await dialog()).shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!.click();
    await (
      await dialog()
    ).updateComplete;
  };
  if (state === "empty" || state === "end-offset")
    root.querySelector<HTMLElement>("[data-test=add-season]")!.click();
  if (state === "editing" || state === "refused" || state === "delete")
    root.querySelector<HTMLElement>("[data-season=w]")!.click();
  await el.updateComplete;
  if (state === "refused") {
    await change("name", "Spring");
    await press("save-season");
    await expect
      .poll(
        async () =>
          (await dialog()).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
            "[name=name]",
          )!.error,
      )
      .not.toBe("");
  }
  if (state === "end-offset") {
    await change("name", "Mid autumn");
    await change("startMonth", "10");
    await change("startDay", "15");
    await press("save-season");
    await expect
      .poll(
        async () =>
          (await dialog()).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-form-actions"]>(
            "wt-form-actions",
          )!.error,
      )
      .toContain("Autumn on Friday");
  }
  if (state === "delete") {
    await press("delete-season");
    await expect
      .poll(async () =>
        (await dialog()).shadowRoot!.querySelector("[data-test=delete-confirm-text]"),
      )
      .not.toBeNull();
  }
  return el;
}

describe.each(["light", "dark"] as const)("Season chips (%s)", (theme) => {
  test.each(["chips", "read-only", "empty", "editing", "refused", "end-offset", "delete"])(
    "%s",
    async (state) => {
      setLocale("en");
      const el = await mount(theme, state);
      const open = el.shadowRoot!.querySelector("season-dialog");
      expect(open === null).toBe(state === "chips" || state === "read-only");
      await expectNoA11yViolations(host);
    },
  );
});

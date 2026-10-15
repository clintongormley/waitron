import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { registerIcons } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { StaffingSeasonPainter } from "./staffing-season-painter.js";
import { seasonApi, type SeasonApiOptions } from "../testing/season-staffing-fixture.js";
import "./staffing-season-painter.js";

registerIcons({ close: "M3 3l10 10M13 3L3 13" });

afterEach(() => {
  cleanup();
  setLocale("en");
});

async function painter(options: SeasonApiOptions = {}, readOnly = false) {
  const el = document.createElement("staffing-season-painter");
  el.api = seasonApi(options).api;
  el.seasonId = "winter";
  el.month = "2026-12";
  el.readOnly = readOnly;
  el.open = () => undefined;
  host.append(el);
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
  }
  return el;
}
const shadow = (el: StaffingSeasonPainter) => el.shadowRoot!;

const states: Record<string, () => Promise<void>> = {
  department: async () => {
    const el = await painter();
    expect(shadow(el).querySelector("staffing-grid")).not.toBeNull();
  },
  "prep station": async () => {
    const el = await painter();
    shadow(el)
      .querySelector("wt-combobox")!
      .dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "station:st-kitchen" },
          bubbles: true,
          composed: true,
        }),
      );
    await el.updateComplete;
  },
  "staff role dialog": async () => {
    const el = await painter();
    shadow(el).querySelector<HTMLElement>("[data-test=new-staff-role]")!.click();
    await el.updateComplete;
    const dialog = shadow(el).querySelector("staff-role-dialog")!;
    await dialog.updateComplete;
    expect(dialog.open).toBe(true);
  },
  "a refused save": async () => {
    const el = await painter({ save: () => Promise.reject({ code: "connection.failed" }) });
    shadow(el)
      .querySelector("staffing-grid")!
      .dispatchEvent(
        new CustomEvent("staffing-change", {
          detail: { key: "3", blocks: [] },
          bubbles: true,
          composed: true,
        }),
      );
    shadow(el)
      .querySelector("staffing-grid")!
      .dispatchEvent(
        new CustomEvent("staffing-change", {
          detail: { key: "2", blocks: [] },
          bubbles: true,
          composed: true,
        }),
      );
    await el.updateComplete;
    const frame = shadow(el).querySelector("painter-frame")!;
    await frame.updateComplete;
    frame.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
    await expect.poll(() => frame.refusal).not.toBe("");
  },
  loading: async () => {
    const el = await painter({ read: () => new Promise(() => undefined) });
    expect(shadow(el).querySelector("[data-test=loading]")).not.toBeNull();
  },
  "a read failure": async () => {
    const el = await painter({ read: () => Promise.reject({ code: "connection.failed" }) });
    expect(shadow(el).querySelector("[data-test=load-error]")).not.toBeNull();
  },
  "read-only": async () => {
    const el = await painter({}, true);
    expect(shadow(el).querySelector("[data-test=paint-row]")).toBeNull();
  },
};

describe.each(["light", "dark"] as const)("staffing season painter (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    await states[state]!();
    await expectNoA11yViolations(host);
  });
});

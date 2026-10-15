import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { registerIcons } from "@waitron/ui";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { StaffingBlock } from "../slots.js";
import type { SpecialDayStaffing } from "../staffing-types.js";
import type { StaffingSpecialDayPainter } from "./staffing-special-day-painter.js";
import { headChef } from "../testing/season-staffing-fixture.js";
import {
  specialDayApi,
  specialDayStaffing,
  type SpecialDayApiOptions,
} from "../testing/special-day-staffing-fixture.js";
import "./staffing-special-day-painter.js";

registerIcons({ close: "M3 3l10 10M13 3L3 13" });

afterEach(() => {
  cleanup();
  setLocale("en");
});

async function painter(options: SpecialDayApiOptions = {}, readOnly = false) {
  const el = document.createElement("staffing-special-day-painter");
  el.api = specialDayApi(options).api;
  el.specialDayId = "xmas";
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
const shadow = (el: StaffingSpecialDayPainter) => el.shadowRoot!;
function paint(el: StaffingSpecialDayPainter, key: string, blocks: StaffingBlock[] | null = []) {
  shadow(el)
    .querySelector("staffing-grid")!
    .dispatchEvent(
      new CustomEvent("staffing-change", {
        detail: { key, blocks },
        bubbles: true,
        composed: true,
      }),
    );
}
async function save(el: StaffingSpecialDayPainter) {
  await el.updateComplete;
  const frame = shadow(el).querySelector("painter-frame")!;
  await frame.updateComplete;
  frame.shadowRoot!.querySelector<HTMLElement>("[data-test=save]")!.click();
  return frame;
}
/** A read that answers at once the first time and, after that, only when `answer` is called. */
function heldRereads() {
  let reads = 0;
  const held: { answer: (read: SpecialDayStaffing) => void } = {
    answer: () => undefined,
  };
  const read = () =>
    ++reads === 1
      ? Promise.resolve(specialDayStaffing())
      : new Promise<SpecialDayStaffing>((resolve) => (held.answer = resolve));
  return { read, held };
}

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
  "a date that follows the season": async () => {
    const el = await painter();
    shadow(el)
      .querySelector("wt-combobox")!
      .dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "department:dep-bar" },
          bubbles: true,
          composed: true,
        }),
      );
    await el.updateComplete;
    const grid = shadow(el).querySelector("staffing-grid")!;
    await grid.updateComplete;
    expect(grid.days.get("eve")).toBeNull();
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
          detail: { key: "day", blocks: [] },
          bubbles: true,
          composed: true,
        }),
      );
    shadow(el)
      .querySelector("staffing-grid")!
      .dispatchEvent(
        new CustomEvent("staffing-change", {
          detail: { key: "eve", blocks: null },
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
  "a refusal that marks a day": async () => {
    const el = await painter({
      save: () => Promise.reject({ code: "staffing.invalid", params: { field: "edits.0" } }),
    });
    paint(el, "day");
    const frame = await save(el);
    await expect.poll(() => frame.refusal).not.toBe("");
    const grid = shadow(el).querySelector("staffing-grid")!;
    await expect.poll(() => grid.columnErrors.size).toBe(1);
    await grid.updateComplete;
  },
  "the staff roles could not be read": async () => {
    const el = await painter({ staffRoles: () => Promise.reject({ code: "connection.failed" }) });
    expect(shadow(el).querySelector("[data-test=roles-error]")).not.toBeNull();
  },
  "saved, but the read after it failed": async () => {
    let reads = 0;
    const el = await painter({
      read: () =>
        ++reads === 1
          ? Promise.resolve(specialDayStaffing())
          : Promise.reject({ code: "connection.failed" }),
    });
    paint(el, "day");
    const frame = await save(el);
    await expect.poll(() => frame.refusal).toMatch(/^Saved; could not refresh/);
    await frame.updateComplete;
  },
  "an area's edits dropped": async () => {
    const { read, held } = heldRereads();
    const el = await painter({ read });
    paint(el, "day");
    const frame = await save(el);
    await expect.poll(() => frame.busy).toBe(false);
    shadow(el)
      .querySelector("wt-combobox")!
      .dispatchEvent(
        new CustomEvent("wt-change", {
          detail: { value: "department:dep-bar" },
          bubbles: true,
          composed: true,
        }),
      );
    await el.updateComplete;
    paint(el, "eve", [headChef]);
    const fresh = specialDayStaffing();
    fresh.areas = fresh.areas.filter(({ name }) => name !== "Bar");
    held.answer(fresh);
    await expect.poll(() => frame.refusal).toContain("Bar was removed");
    await frame.updateComplete;
  },
  "no departments or prep stations": async () => {
    const el = await painter({
      read: async () => ({ ...specialDayStaffing(), areas: [], guides: {} }),
    });
    expect(shadow(el).querySelector("[data-test=no-areas]")).not.toBeNull();
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

describe.each(["light", "dark"] as const)("staffing special-day painter (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    await mountThemed("<div></div>", theme);
    await states[state]!();
    await expectNoA11yViolations(host);
  });
});

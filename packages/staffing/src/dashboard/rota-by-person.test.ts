import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { rotaApi, rotaWeek } from "../testing/rota-fixture.js";
import type { RotaWeek } from "../staffing-types.js";
import type { RosterBreach } from "@waitron/workforce/roster-validation";
import "./rota-view.js";
const frames: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  frames.splice(0).forEach((f) => f.remove());
  setLocale("en");
});
type View = LitElement & {
  api: ReturnType<typeof rotaApi>["api"];
  week: string;
  params: Record<string, string>;
  canWrite: boolean;
  open: ReturnType<typeof vi.fn>;
};
async function mount(published = false, width = "1280px") {
  const frame = document.createElement("div");
  frame.style.width = width;
  frames.push(frame);
  document.body.append(frame);
  applyTokens(frame);
  const el = document.createElement("staffing-rota") as View;
  el.api = rotaApi(async (w) => {
    const r = rotaWeek(w);
    if (published) r.version = { id: "pub", status: "published", changedSincePublished: false };
    return r;
  }).api;
  el.week = "2026-11-30";
  el.params = { mode: "person", area: "station:kitchen" };
  el.canWrite = true;
  el.open = vi.fn();
  frame.append(el);
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("rota-by-person")).toBeTruthy());
  const grid = el.shadowRoot!.querySelector<
    LitElement & { week: RotaWeek; breaches: RosterBreach[] }
  >("rota-by-person")!;
  await grid.updateComplete;
  return { el, grid, root: grid.shadowRoot! };
}
describe("the Rota by person", () => {
  it("lists each person with staff roles, contract hours, shifts and business-day overflow", async () => {
    const { root } = await mount();
    expect([...root.querySelectorAll("th[scope=row]")].map((e) => e.textContent)).toHaveLength(5);
    expect(root.querySelector("[data-person=ana]")!.textContent).toContain("Head chef");
    expect(root.querySelector("[data-person=joan]")!.textContent).toContain("41 / 40 h");
    expect(root.querySelector("[data-shift=filled]")!.textContent).toContain("09:00–17:00");
    expect(root.querySelector("[data-shift=filled]")!.textContent).toContain("Kitchen · Head chef");
    expect(root.querySelector("[data-shift=unlinked]")!.textContent).toContain(
      "belongs to the previous week",
    );
  });
  it("places shift warnings, daily warnings and week warnings on their named targets", async () => {
    const { grid, root } = await mount();
    grid.breaches = [
      {
        kind: "rest_too_short",
        personId: "ana",
        shiftId: "filled",
        previousShiftId: "past",
        restMinutes: 540,
        requiredMinutes: 720,
      },
      {
        kind: "break_owed",
        personId: "ana",
        shiftId: "filled",
        plannedMinutes: 480,
        thresholdMinutes: 360,
        minBreakMinutes: 15,
      },
      { kind: "night_work", personId: "ana", shiftId: "filled", nightMinutes: 120 },
      {
        kind: "exceeds_daily_max",
        personId: "ana",
        workDate: "2026-12-01",
        plannedMinutes: 600,
        maxMinutes: 540,
      },
      {
        kind: "exceeds_weekly_max",
        personId: "joan",
        weekStart: "2026-11-30",
        plannedMinutes: 2460,
        maxMinutes: 2400,
      },
      {
        kind: "weekly_rest_insufficient",
        personId: "joan",
        weekStart: "2026-11-30",
        longestRestMinutes: 1440,
        requiredMinutes: 2160,
      },
    ];
    await grid.updateComplete;
    const shift = root.querySelector("[data-shift=filled]")!.textContent!;
    expect(shift).toContain("9 h rest");
    expect(shift).toContain("0.25 h break owed");
    expect(shift).toContain("2 h night work");
    expect(root.querySelector('[data-person=ana] [data-day="2026-12-01"]')!.textContent).toContain(
      "daily maximum 9 h",
    );
    expect(root.querySelector("[data-person=joan] th")!.textContent).toContain(
      "weekly maximum 40 h",
    );
    expect(root.querySelector("[data-person=joan] th")!.textContent).toContain("24 h weekly rest");
    expect(root.querySelector("[data-person=marc]")!.textContent).not.toContain("9 h rest");
  });
  it("opens prefilled new shifts and existing shifts, preserving the view in week navigation", async () => {
    const { el, root } = await mount();
    root
      .querySelector<HTMLElement>(
        '[data-person=ana] [data-day="2026-12-04"] [data-test=add-shift]',
      )!
      .click();
    await el.updateComplete;
    const editor = el.shadowRoot!.querySelector<
      LitElement & { businessDay: string; personId: string; shiftId?: string }
    >("rota-shift-dialog")!;
    await editor.updateComplete;
    expect(editor.businessDay).toBe("2026-12-04");
    expect(editor.personId).toBe("ana");
    expect(editor.shiftId).toBeUndefined();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!.click();
    expect(el.open).toHaveBeenCalledWith("rota", {
      week: "2026-12-07",
      area: "station:kitchen",
      mode: "person",
    });
  });
  it("offers no add or edit controls in a published week", async () => {
    const { root } = await mount(true);
    expect(root.querySelector("button[data-shift]")).toBeNull();
    expect(root.querySelector("[data-test=add-shift]")).toBeNull();
  });
  it.each(["390px", "1280px"])("contains its scrolling grid at %s", async (width) => {
    const { grid, root } = await mount(false, width);
    expect(grid.getBoundingClientRect().width).toBeLessThanOrEqual(parseInt(width));
    const scroll = root.querySelector<HTMLElement>("[data-test=grid-scroll]")!;
    expect(scroll.clientWidth).toBeLessThanOrEqual(parseInt(width));
    if (width === "1280px") expect(scroll.scrollWidth).toBe(scroll.clientWidth);
  });
});

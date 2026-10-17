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
async function mount(
  published = false,
  width = "1280px",
  prepare: (week: RotaWeek) => RotaWeek = (r) => r,
) {
  const frame = document.createElement("div");
  frame.style.width = width;
  frames.push(frame);
  document.body.append(frame);
  applyTokens(frame);
  const el = document.createElement("staffing-rota") as View;
  el.api = rotaApi(async (w) => {
    const r = rotaWeek(w);
    if (published) r.version = { id: "pub", status: "published", changedSincePublished: false };
    return prepare(r);
  }).api;
  el.week = "2026-11-30";
  el.params = { area: "everyone" };
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
    expect(el.open).toHaveBeenCalledWith("rota", { week: "2026-12-07", area: "everyone" });
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

it("offers only the Show menu, set to Everyone, in the all-areas person view", async () => {
  const { el } = await mount();
  const boxes =
    el.shadowRoot!.querySelectorAll<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox");
  expect(boxes).toHaveLength(1);
  expect(boxes[0]!.getAttribute("name")).toBe("area");
  expect(boxes[0]!.value).toBe("everyone");
  expect(el.shadowRoot!.querySelector("[data-test=by-area]")).toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=by-person]")).toBeNull();
});

it("counts every area's open slots in the person view", async () => {
  const { el } = await mount(false, "1280px", (r) => {
    r.days[4]!.areas.push({
      area: r.areas[1]!.area,
      match: {
        slots: [
          {
            slot: {
              ...r.days[4]!.areas[0]!.match.slots[0]!.slot,
              key: "restaurant",
              area: r.areas[1]!.area,
            },
            status: { kind: "unfilled" },
          },
        ],
        over: [],
      },
    });
    return r;
  });
  expect(el.shadowRoot!.querySelector("[data-test=attention]")!.textContent).toContain(
    "2 unfilled",
  );
});
it("shows a daily warning once on its calendar date when the shift starts before changeover", async () => {
  const { grid, root } = await mount();
  grid.week = {
    ...grid.week,
    shifts: grid.week.shifts.map((s) =>
      s.shiftId === "filled"
        ? { ...s, businessDay: "2026-11-30", startsAt: "2026-12-01T00:00:00Z" }
        : s,
    ),
  };
  grid.breaches = [
    {
      kind: "exceeds_daily_max",
      personId: "ana",
      workDate: "2026-12-01",
      plannedMinutes: 600,
      maxMinutes: 540,
    },
  ];
  await grid.updateComplete;
  expect(
    root.querySelector('[data-person=ana] [data-day="2026-11-30"]')!.textContent,
  ).not.toContain("daily maximum");
  expect(root.querySelector('[data-person=ana] [data-day="2026-12-01"]')!.textContent).toContain(
    "daily maximum 9 h",
  );
});
it("Everyone's day headers name their attention across areas and a closed day reads Closed once", async () => {
  const { root } = await mount();
  const head = (day: string) =>
    root.querySelector(`th[data-day-head="${day}"]`)!.textContent!.replace(/\s+/g, " ");
  expect(head("2026-12-04")).toContain("1 unfilled");
  expect(head("2026-12-03")).toContain("1 over");
  expect(head("2026-11-30")).toContain("Closed");
  expect([...root.querySelectorAll("td")].filter((c) => c.textContent!.includes("Closed"))).toEqual(
    [],
  );
});
it("a grid reports a target it does not draw", async () => {
  const { el, grid } = await mount();
  const people = grid as unknown as { focusTarget(t: object): boolean };
  expect(people.focusTarget({ businessDay: "2026-12-04", slotKey: "empty" })).toBe(false);
  expect(people.focusTarget({ businessDay: "2026-12-04", shiftId: "gone" })).toBe(false);
  el.params = { area: "station:kitchen" };
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-by-area")).toBeTruthy());
  const byArea = el.shadowRoot!.querySelector("rota-by-area") as unknown as {
    focusTarget(t: object): boolean;
  };
  expect(byArea.focusTarget({ businessDay: "2026-12-04", slotKey: "gone" })).toBe(false);
  expect(byArea.focusTarget({ businessDay: "2026-12-04", slotKey: "empty" })).toBe(true);
});
it("rows follow each person's first staff role, then name", async () => {
  const { root } = await mount();
  expect(
    [...root.querySelectorAll<HTMLElement>("[data-person]")].map((r) => r.dataset.person),
  ).toEqual(["ana", "marc", "joan", "laia", "ibra"]);
});
it("each card carries its staff role's colour, its time, its area and staff role, and keeps its warnings", async () => {
  const { root, grid } = await mount();
  const filled = root.querySelector<HTMLElement>("[data-shift=filled]")!;
  const swatch = filled.querySelector<HTMLElement>(".swatch")!;
  expect(swatch.dataset.colour).toBe("purple");
  const probe = document.createElement("span");
  probe.style.background = "var(--wt-color-palette-purple)";
  frames[0]!.append(probe);
  const painted = getComputedStyle(swatch).backgroundColor;
  expect(painted).toBe(getComputedStyle(probe).backgroundColor);
  expect(painted).not.toBe("rgba(0, 0, 0, 0)");
  expect(filled.textContent).toContain("09:00–17:00");
  expect(filled.textContent).toContain("Kitchen · Head chef");
  expect(root.querySelector("[data-shift=part] .swatch")!.getAttribute("data-colour")).toBe(
    "green",
  );
  expect(root.querySelector("[data-shift=over]")!.textContent).toContain("not needed");
  expect(root.querySelector("[data-shift=part]")!.textContent!.replace(/\s+/g, " ")).toContain(
    "uncovered 14:00–17:00",
  );
  expect(root.querySelector("[data-shift=filled]")!.textContent).not.toContain("uncovered");
  expect(root.querySelector("[data-shift=unlinked] .swatch")).toBeNull();
  grid.breaches = [{ kind: "night_work", personId: "ana", shiftId: "filled", nightMinutes: 120 }];
  await grid.updateComplete;
  expect(root.querySelector("[data-shift=filled]")!.textContent).toContain("2 h night work");
});
it("under each name its staff roles and the week's hours, marked when over contract", async () => {
  const { root } = await mount();
  const joan = root.querySelector("[data-person=joan] th")!;
  expect(joan.textContent).toContain("Sous chef");
  expect(joan.textContent).toContain("41 / 40 h");
  expect(joan.hasAttribute("data-over-contract")).toBe(true);
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-warning)";
  frames[0]!.append(probe);
  const warning = getComputedStyle(probe).color;
  expect(getComputedStyle(joan.querySelector(".hours")!).color).toBe(warning);
  const ana = root.querySelector("[data-person=ana] th")!;
  expect(ana.hasAttribute("data-over-contract")).toBe(false);
  expect(getComputedStyle(ana.querySelector(".hours")!).color).not.toBe(warning);
  expect(root.querySelector("[data-person=ibra] th")!.hasAttribute("data-over-contract")).toBe(
    false,
  );
});
it("names its scrolling grid Everyone", async () => {
  const { root } = await mount();
  expect(root.querySelector("[data-test=grid-scroll]")!.getAttribute("aria-label")).toBe(
    "Everyone",
  );
});

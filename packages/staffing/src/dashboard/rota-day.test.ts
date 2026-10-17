import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import { rotaArea, rotaWeek } from "../testing/rota-fixture.js";
import type { RotaWeek } from "../staffing-types.js";
import { areaKey } from "../slots.js";
import type { Show } from "./rota-model.js";
import { RotaDay } from "./rota-day.js";

const frames: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  frames.splice(0).forEach((f) => f.remove());
  setLocale("en");
});
async function useViewport(width: number, height: number) {
  const before = [innerWidth, innerHeight] as const;
  await page.viewport(width, height);
  await vi.waitFor(() => expect(innerWidth).toBe(width));
  onTestFinished(() => page.viewport(...before));
}
const kitchen: Show = { kind: "area", area: rotaArea, key: areaKey(rotaArea), name: "Kitchen" };
const everyone: Show = { kind: "everyone" };
/** The rendered words, so a block-level line break reads as a space. */
const text = (e: Element | ShadowRoot | null | undefined) =>
  ((e as HTMLElement).innerText ?? e!.textContent!).replace(/\s+/g, " ").trim();

async function mount(
  show: Show,
  businessDay: string,
  { editable = true, week = rotaWeek() }: { editable?: boolean; week?: RotaWeek } = {},
) {
  await useViewport(390, 844);
  const frame = document.createElement("div");
  frame.style.width = "390px";
  frames.push(frame);
  document.body.append(frame);
  applyTokens(frame);
  const el = new RotaDay();
  el.week = week;
  el.show = show;
  el.businessDay = businessDay;
  el.editable = editable;
  frame.append(el);
  await el.updateComplete;
  return { el, root: el.shadowRoot! };
}
function heard(el: HTMLElement, name: string) {
  const own: CustomEvent[] = [];
  el.addEventListener(name, (e) => own.push(e as CustomEvent));
  return own;
}

describe("rota-day in an area", () => {
  it("lists the day's staff role groups with their cards, only for roles used that day", async () => {
    const week = rotaWeek();
    week.staffRoles.push({
      id: "dish",
      name: "Dishwasher",
      colour: "orange",
      position: 2,
      holderIds: [],
    });
    const { root } = await mount(kitchen, "2026-12-01", { week });
    const groups = [...root.querySelectorAll<HTMLElement>("[data-role]")];
    expect(groups.map((g) => g.dataset.role)).toEqual(["head", "sous"]);
    expect(text(groups[0]!.querySelector("h4"))).toBe("Head chef");
    expect(groups[0]!.querySelector(".swatch")!.getAttribute("data-colour")).toBe("purple");
    expect(text(groups[0]!.querySelector("[data-slot=filled]"))).toContain("09:00–17:00 Ana");
    const part = groups[1]!.querySelector("[data-slot=part]")!;
    expect(part.getAttribute("data-kind")).toBe("partly_uncovered");
    expect(text(part)).toContain("uncovered 14:00–17:00");
    expect(root.querySelector("[data-role=dish]")).toBeNull();
    expect(root.querySelector("[data-test=cell-add]")).toBeNull();
  });
  it("a role group appears for a shift beyond the slots, and the over card says so", async () => {
    const { root } = await mount(kitchen, "2026-12-03");
    expect(
      [...root.querySelectorAll<HTMLElement>("[data-role]")].map((g) => g.dataset.role),
    ).toEqual(["sous"]);
    expect(text(root.querySelector("[data-shift=over]"))).toContain("not needed");
  });
  it("a dashed slot sends pick-slot with its anchor; a card sends edit-shift", async () => {
    const { el, root } = await mount(kitchen, "2026-12-04");
    const picks = heard(el, "pick-slot");
    const slot = root.querySelector<HTMLButtonElement>("[data-slot=empty]")!;
    expect(slot.dataset.kind).toBe("unfilled");
    expect(getComputedStyle(slot).borderTopStyle).toBe("dashed");
    expect(text(slot)).toBe("09:00–17:00 · Fill");
    slot.click();
    expect(picks).toHaveLength(1);
    expect(picks[0]!.detail.slot.key).toBe("empty");
    expect(picks[0]!.detail.anchor).toBe(slot);
    expect(picks[0]!.bubbles && picks[0]!.composed).toBe(true);
    el.businessDay = "2026-12-01";
    await el.updateComplete;
    const edits = heard(el, "edit-shift");
    root.querySelector<HTMLButtonElement>("[data-slot=filled]")!.click();
    expect(edits.map((e) => e.detail)).toEqual([{ shiftId: "filled" }]);
  });
  it("draws a day's shifts in no slot under their own heading", async () => {
    const week = rotaWeek();
    week.days[0]!.hasHours = true;
    const over = week.shifts.find((s) => s.shiftId === "over")!;
    week.shifts.push({ ...over, shiftId: "loose", businessDay: "2026-11-30" });
    week.days[0]!.notInSlot.push({ shiftId: "loose", outsideWeek: false });
    const { root } = await mount(kitchen, "2026-11-30", { week });
    const group = root.querySelector("[data-role=not-in-slot]")!;
    expect(text(group.querySelector("h4"))).toBe("Not in a slot");
    expect(text(group.querySelector("[data-shift=loose]"))).toBe("09:00–17:00 Laia");
    expect(text(group.querySelector("[data-shift=unlinked]"))).toContain(
      "belongs to the previous week",
    );
  });
  it("draws only the heading for an area the day's read does not carry", async () => {
    const restaurant = rotaWeek().areas[1]!;
    const { root } = await mount(
      { kind: "area", area: restaurant.area, key: areaKey(restaurant.area), name: "Restaurant" },
      "2026-12-04",
    );
    expect(root.querySelector("[data-role]")).toBeNull();
    expect(text(root.querySelector("[data-day-head]"))).toBe("Fri 4");
  });
  it("offers no buttons in a published week", async () => {
    const { el, root } = await mount(kitchen, "2026-12-04", { editable: false });
    expect(root.querySelector("[data-slot=empty]")!.tagName).toBe("DIV");
    expect(root.querySelector("button")).toBeNull();
    el.businessDay = "2026-12-03";
    await el.updateComplete;
    expect(root.querySelector("[data-shift=over]")!.tagName).toBe("DIV");
    expect(text(root.querySelector("[data-shift=over]"))).toContain("not needed");
    expect(root.querySelector("button")).toBeNull();
  });
});

describe("rota-day for Everyone", () => {
  it("lists every person in staff-role order, each a button that opens their day", async () => {
    const { el, root } = await mount(everyone, "2026-12-04");
    const blocks = [...root.querySelectorAll<HTMLElement>("[data-person]")];
    expect(blocks.map((b) => b.dataset.person)).toEqual(["ana", "marc", "joan", "laia", "ibra"]);
    const ana = blocks[0]!.querySelector<HTMLButtonElement>("button[data-test=person]")!;
    expect(text(ana)).toBe("Ana Head chef 38 / 40 h");
    expect(text(blocks[1]!.querySelector("[data-test=person]"))).toContain("Sous chef, Head chef");
    const opens = heard(el, "open-day");
    ana.click();
    expect(opens).toHaveLength(1);
    expect(opens[0]!.detail).toEqual({ personId: "ana", businessDay: "2026-12-04", anchor: ana });
    expect(opens[0]!.bubbles && opens[0]!.composed).toBe(true);
  });
  it("puts that day's cards and daily warnings under each person", async () => {
    const { el, root } = await mount(everyone, "2026-12-01");
    const ana = root.querySelector("[data-person=ana]")!;
    expect(text(ana.querySelector("[data-shift=filled]"))).toContain("Kitchen · Head chef");
    expect(text(root.querySelector("[data-person=joan] [data-shift=part]"))).toContain(
      "uncovered 14:00–17:00",
    );
    expect(root.querySelector("[data-person=marc] [data-shift]")).toBeNull();
    el.breaches = [
      {
        kind: "exceeds_daily_max",
        personId: "ana",
        workDate: "2026-12-01",
        plannedMinutes: 600,
        maxMinutes: 540,
      },
      {
        kind: "exceeds_daily_max",
        personId: "ana",
        workDate: "2026-12-02",
        plannedMinutes: 600,
        maxMinutes: 540,
      },
    ];
    await el.updateComplete;
    expect(text(ana).match(/daily maximum 9 h/g)).toHaveLength(1);
    const edits = heard(el, "edit-shift");
    ana.querySelector<HTMLButtonElement>("[data-shift=filled]")!.click();
    expect(edits.map((e) => e.detail)).toEqual([{ shiftId: "filled" }]);
  });
  it("keeps a person's week warnings under their name, on every day, and no one else's", async () => {
    const { el, root } = await mount(everyone, "2026-12-01");
    el.breaches = [
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
      { kind: "overtime_cap_exceeded", personId: "joan", overtimeMinutes: 120, capMinutes: 60 },
    ];
    await el.updateComplete;
    for (const day of ["2026-12-01", "2026-12-03"]) {
      el.businessDay = day;
      await el.updateComplete;
      const joan = text(root.querySelector("[data-person=joan]"));
      expect(joan).toContain("41 h planned; weekly maximum 40 h");
      expect(joan).toContain("24 h weekly rest");
      expect(joan).toContain("2 h overtime; cap 1 h");
      expect(joan.match(/weekly maximum 40 h/g)).toHaveLength(1);
      expect(text(root.querySelector("[data-person=ana]"))).not.toContain("weekly");
    }
  });
  it("in a published week, or with no active area, a person is not a button", async () => {
    for (const setup of [{ editable: false }, { canAdd: false }]) {
      const { el, root } = await mount(everyone, "2026-12-01", { editable: setup.editable });
      if ("canAdd" in setup) el.canAdd = false;
      await el.updateComplete;
      expect(root.querySelector("[data-test=person]")).toBeNull();
      expect(text(root.querySelector("[data-person=ana] [data-test=person-name]"))).toBe(
        "Ana Head chef 38 / 40 h",
      );
      frames.splice(0).forEach((f) => f.remove());
    }
  });
});

describe("rota-day's cards keep the grids' notes", () => {
  it("an area's cards carry swaps, daily warnings, next-week shifts, and send edit-shift", async () => {
    const week = rotaWeek();
    week.openSwaps = [{ swapId: "s", fromShiftId: "x", toShiftId: "filled" }];
    week.days[0]!.hasHours = true;
    week.shifts.find((s) => s.shiftId === "unlinked")!.businessDay = "2026-12-07";
    week.shifts.find((s) => s.shiftId === "unlinked")!.personId = "gone";
    const { el, root } = await mount(kitchen, "2026-12-01", { week });
    el.breaches = [
      {
        kind: "exceeds_daily_max",
        personId: "ana",
        workDate: "2026-12-01",
        plannedMinutes: 600,
        maxMinutes: 540,
      },
    ];
    await el.updateComplete;
    const filled = text(root.querySelector("[data-slot=filled]"));
    expect(filled).toContain("Open swap request");
    expect(filled).toContain("daily maximum 9 h");
    el.businessDay = "2026-11-30";
    await el.updateComplete;
    expect(text(root.querySelector("[data-shift=unlinked]"))).toBe(
      "09:00–17:00 belongs to the next week",
    );
    el.businessDay = "2026-12-03";
    await el.updateComplete;
    const edits = heard(el, "edit-shift");
    root.querySelector<HTMLButtonElement>("[data-shift=over]")!.click();
    expect(edits.map((e) => e.detail)).toEqual([{ shiftId: "over" }]);
  });
  it("a person's cards carry swaps, a shift outside their staff roles and next-week shifts", async () => {
    const week = rotaWeek();
    week.openSwaps = [{ swapId: "s", fromShiftId: "filled", toShiftId: null }];
    week.shifts.find((s) => s.shiftId === "part")!.staffRoleId = "head";
    week.shifts.find((s) => s.shiftId === "unlinked")!.businessDay = "2026-12-07";
    const { root } = await mount(everyone, "2026-12-01", { week });
    expect(text(root.querySelector("[data-shift=filled]"))).toContain("Open swap request");
    expect(text(root.querySelector("[data-shift=part]"))).toContain("outside staff role");
    expect(text(root.querySelector("[data-shift=part]"))).toContain("Kitchen · Head chef");
    const { root: monday } = await mount(everyone, "2026-11-30", { week });
    expect(text(monday.querySelector("[data-shift=unlinked]"))).toContain(
      "belongs to the next week",
    );
  });
});

describe("rota-day's heading", () => {
  it("names the day and what needs attention in scope", async () => {
    const { el, root } = await mount(everyone, "2026-12-04");
    expect(text(root.querySelector("[data-day-head]"))).toBe("Fri 4 1 unfilled");
    el.show = kitchen;
    el.businessDay = "2026-12-03";
    await el.updateComplete;
    expect(text(root.querySelector("[data-day-head]"))).toBe("Thu 3 1 over");
  });
  it.each([
    ["an area", kitchen],
    ["Everyone", everyone],
  ])("a Closed day reads Closed once in %s", async (_, show) => {
    const { root } = await mount(show, "2026-11-30");
    expect(text(root).match(/Closed/g)).toHaveLength(1);
    expect(text(root.querySelector("[data-day-head]"))).toBe("Mon 30 Closed");
  });
});

describe("rota-day's focusTarget", () => {
  it("focuses a slot, a card, or Everyone's day heading, and reports what it does not draw", async () => {
    const { el, root } = await mount(kitchen, "2026-12-01");
    expect(el.focusTarget({ businessDay: "2026-12-01", slotKey: "part", shiftId: "part" })).toBe(
      true,
    );
    expect(root.activeElement).toBe(root.querySelector("[data-slot=part]"));
    el.businessDay = "2026-12-03";
    await el.updateComplete;
    expect(el.focusTarget({ businessDay: "2026-12-03", shiftId: "over" })).toBe(true);
    expect(root.activeElement).toBe(root.querySelector("[data-shift=over]"));
    expect(el.focusTarget({ businessDay: "2026-12-04", slotKey: "empty" })).toBe(false);
    el.show = everyone;
    el.businessDay = "2026-12-04";
    await el.updateComplete;
    expect(el.focusTarget({ businessDay: "2026-12-04", header: true })).toBe(true);
    const head = root.querySelector<HTMLElement>("[data-day-head]")!;
    expect(root.activeElement).toBe(head);
    expect(head.tabIndex).toBe(-1);
    el.businessDay = "2026-12-01";
    await el.updateComplete;
    expect(el.focusTarget({ businessDay: "2026-12-01", slotKey: "part", shiftId: "part" })).toBe(
      true,
    );
    expect(root.activeElement).toBe(root.querySelector("[data-shift=part]"));
  });
});

describe("rota-day's width", () => {
  it.each([
    ["an area", kitchen, "2026-12-01"],
    ["Everyone", everyone, "2026-12-01"],
  ])("nothing is wider than 390 px in %s", async (_, show, day) => {
    const week = rotaWeek();
    week.people[0]!.name = "Anastasia Wolfeschlegelsteinhausenbergerdorff".repeat(3);
    const { el, root } = await mount(show, day, { week });
    await vi.waitFor(() => expect(root.querySelector("[data-shift], [data-slot]")).toBeTruthy());
    expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(390);
    expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
    for (const card of root.querySelectorAll<HTMLElement>(".card, [data-test=person]")) {
      expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(
        el.getBoundingClientRect().right + 0.5,
      );
      expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    }
  });
});

it("draws nothing before it has a week and a show", async () => {
  const el = new RotaDay();
  document.body.append(el);
  onTestFinished(() => el.remove());
  await el.updateComplete;
  expect(el.shadowRoot!.children).toHaveLength(0);
});

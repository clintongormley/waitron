import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { RosterBreach, WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { rotaApi, rotaWeek } from "../testing/rota-fixture.js";
import type { StaffingApi } from "./client.js";
import type { RotaWeek } from "../staffing-types.js";
import { STAFFING_DASHBOARD } from "./index.js";
import type { LitElement } from "lit";

const frames: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  frames.splice(0).forEach((f) => f.remove());
  setLocale("en");
});
type View = LitElement & {
  api: StaffingApi;
  week: string;
  params: Record<string, string>;
  canWrite: boolean;
  open: ReturnType<typeof vi.fn>;
};
async function mount(
  client = rotaApi().api,
  width = "1280px",
  params: Record<string, string> = {},
  grid = "rota-by-area",
) {
  const f = document.createElement("div");
  f.style.width = width;
  document.body.append(f);
  frames.push(f);
  applyTokens(f);
  const el = document.createElement("staffing-rota") as View;
  el.api = client;
  el.week = "2026-11-30";
  el.params = params;
  el.canWrite = true;
  el.open = vi.fn();
  f.append(el);
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector(grid)).toBeTruthy());
  return el;
}
type Combobox = HTMLElementTagNameMap["wt-combobox"];
const show = (el: View) => {
  const boxes = el.shadowRoot!.querySelectorAll<Combobox>("wt-combobox");
  expect(boxes).toHaveLength(1);
  return boxes[0]!;
};
const normal = (s: string) => s.replace(/\s+/g, " ").trim();
const title = (el: View) => normal(el.shadowRoot!.querySelector("[data-test=week]")!.textContent!);
const area = (el: View) => el.shadowRoot!.querySelector<LitElement>("rota-by-area")!;
const text = (el: View) => area(el).shadowRoot!.textContent!;
async function everyone(el: View) {
  const grid = el.shadowRoot!.querySelector<LitElement>("rota-by-person")!;
  await grid.updateComplete;
  return grid.shadowRoot!;
}

describe("the Rota by area", () => {
  it("offers a Rota calendar contribution restricted to schedule managers", () => {
    const view = STAFFING_DASHBOARD.calendarViews!.find((v) => v.id === "rota");
    expect(view).toMatchObject({
      labelKey: "staffing.rota.tab",
      order: 20,
      requiresPermission: "schedule.manage",
      readPermission: "schedule.manage",
    });
  });
  it("draws staff roles in position order and every slot state, overflow, closed days and week hours", async () => {
    const el = await mount();
    const r = area(el).shadowRoot!;
    expect([...r.querySelectorAll("th[scope=row]")].map((n) => n.textContent!.trim())).toEqual([
      "Head chef",
      "Sous chef",
      "Not in a slot",
    ]);
    for (const label of [
      "Ana",
      "uncovered 14:00–17:00",
      "outside staff role",
      "not needed",
      "Fill",
      "belongs to the previous week",
      "Closed",
    ])
      expect(text(el)).toContain(label);
    expect(normal(r.querySelector("[data-slot=empty]")!.textContent!)).toBe("09:00–17:00 · Fill");
    const attention = el.shadowRoot!.querySelector("[data-test=attention]")!;
    expect(normal(attention.textContent!)).toContain("1 unfilled · 1 partly uncovered · 1 over");
    expect(
      [...attention.querySelectorAll(".count")].map((b) => [b.localName, normal(b.textContent!)]),
    ).toEqual([
      ["button", "1 unfilled"],
      ["button", "1 partly uncovered"],
      ["button", "1 over"],
    ]);
    expect(el.shadowRoot!.querySelector("[data-person]")).toBeNull();
    expect(area(el).shadowRoot!.querySelector("[data-person]")).toBeNull();
    el.params = { area: "everyone" };
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-by-person")).toBeTruthy());
    const people = await everyone(el);
    const joan = people.querySelector("[data-person=joan] th")!;
    expect(joan.textContent).toContain("41 / 40 h");
    expect(joan.hasAttribute("data-over-contract")).toBe(true);
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-warning)";
    frames[0]!.append(probe);
    const warning = getComputedStyle(probe).color;
    expect(getComputedStyle(joan.querySelector(".hours")!).color).toBe(warning);
    const marc = people.querySelector("[data-person=marc] th")!;
    expect(marc.hasAttribute("data-over-contract")).toBe(false);
    expect(getComputedStyle(marc.querySelector(".hours")!).color).not.toBe(warning);
  });
  it("a staff role row appears only when the area has slots or shifts for it that week; Not in a slot only when it has a shift", async () => {
    const rows = (el: View) =>
      [...area(el).shadowRoot!.querySelectorAll("th[scope=row]")].map((n) => n.textContent!.trim());
    let unlinked = true;
    const el = await mount(
      rotaApi(async (week) => {
        const r = rotaWeek(week);
        r.staffRoles.push({
          id: "pastry",
          name: "Pastry chef",
          colour: "blue",
          position: 2,
          holderIds: ["ibra"],
        });
        if (!unlinked) {
          r.shifts = r.shifts.filter((s) => s.shiftId !== "unlinked");
          for (const day of r.days) day.notInSlot = [];
        }
        return r;
      }).api,
    );
    expect(rows(el)).toEqual(["Head chef", "Sous chef", "Not in a slot"]);
    unlinked = false;
    el.week = "2026-12-07";
    await vi.waitFor(() => expect(rows(el)).toEqual(["Head chef", "Sous chef"]));
  });
  it("an unfilled slot reads its time and Fill, dashed", async () => {
    const el = await mount();
    const slot = area(el).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!;
    expect(normal(slot.textContent!)).toBe("09:00–17:00 · Fill");
    expect(getComputedStyle(slot).borderTopStyle).toBe("dashed");
    expect(getComputedStyle(slot).borderInlineStartStyle).toBe("dashed");
  });
  it("the empty part of a cell shows + Add shift on hover or focus and opens the editor with the day, area and staff role", async () => {
    const el = await mount();
    const r = area(el).shadowRoot!;
    const row = [...r.querySelectorAll("tbody tr")].find(
      (tr) => tr.querySelector("th")!.textContent!.trim() === "Sous chef",
    )!;
    const cell = row.querySelectorAll("td")[4]!;
    const add = cell.querySelector<HTMLElement>("[data-test=cell-add]")!;
    expect(normal(add.textContent!)).toBe("+ Add shift");
    expect(add.getAttribute("aria-label")).toBe("Add shift: Sous chef, Fri 4 Dec");
    expect(getComputedStyle(add).opacity).toBe("0");
    const box = add.getBoundingClientRect(),
      td = cell.getBoundingClientRect(),
      slot = cell.querySelector("[data-slot=empty]")!.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(slot.bottom);
    expect(td.bottom - box.bottom).toBeLessThanOrEqual(
      parseFloat(getComputedStyle(cell).paddingBottom) + 1,
    );
    await userEvent.hover(add);
    expect(getComputedStyle(add).opacity).toBe("1");
    await userEvent.unhover(add);
    expect(getComputedStyle(add).opacity).toBe("0");
    cell.querySelector<HTMLElement>("[data-slot=empty]")!.focus();
    await userEvent.tab();
    expect(r.activeElement).toBe(add);
    expect(getComputedStyle(add).opacity).toBe("1");
    await userEvent.click(add);
    const dialog = el.shadowRoot!.querySelector("rota-shift-dialog") as LitElement & {
      open: boolean;
      businessDay: string;
      area: string;
      staffRoleId: string;
      personId: string;
    };
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    expect(dialog.businessDay).toBe("2026-12-04");
    expect(dialog.area).toBe("station:kitchen");
    expect(dialog.staffRoleId).toBe("sous");
    expect(dialog.personId).toBe("");
    const published = await mount(
      rotaApi(async (w) => {
        const read = rotaWeek(w);
        read.version = { id: "pub", status: "published", changedSincePublished: false };
        return read;
      }).api,
    );
    expect(area(published).shadowRoot!.querySelector("[data-slot=empty]")).toBeTruthy();
    expect(area(published).shadowRoot!.querySelector("[data-test=cell-add]")).toBeNull();
  });
  it("paints a staff role's swatch in a calendar colour beyond the first six", async () => {
    const el = await mount(
      rotaApi(async (week) => {
        const r = rotaWeek(week);
        r.staffRoles[0]!.colour = "brown";
        return r;
      }).api,
    );
    const swatch = area(el).shadowRoot!.querySelector<HTMLElement>(".swatch")!;
    expect(swatch.dataset.colour).toBe("brown");
    const painted = getComputedStyle(swatch).backgroundColor;
    const probe = document.createElement("span");
    probe.style.background = "var(--wt-color-palette-brown)";
    frames[0]!.append(probe);
    expect(painted).toBe(getComputedStyle(probe).backgroundColor);
    expect(painted).not.toBe("rgba(0, 0, 0, 0)");
  });
  it("steps real weeks through the host and keeps the selected area in the address", async () => {
    const el = await mount();
    el.params = { area: "station:kitchen" };
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!.click();
    expect(el.open).toHaveBeenCalledWith("rota", { week: "2026-12-07", area: "station:kitchen" });
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>(
      "wt-combobox",
    )!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "department:restaurant" } }));
    expect(el.open).toHaveBeenCalledWith("rota", {
      week: "2026-11-30",
      area: "department:restaurant",
    });
  });
  it("opens a slot picker, fills the slot with a non-passive request and refreshes", async () => {
    let filled = false;
    const { api, request } = rotaApi(async (week) => {
      const r = rotaWeek(week);
      if (filled)
        r.days[4]!.areas[0]!.match.slots[0]!.status = {
          kind: "filled",
          shiftId: "filled",
          outsideRole: false,
        };
      return r;
    });
    const el = await mount(api);
    area(el).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector<LitElement>("slot-picker")!;
    await picker.updateComplete;
    expect(picker.shadowRoot!.textContent).toContain("Show everyone");
    filled = true;
    picker.shadowRoot!.querySelector<HTMLElement>("[data-person=marc]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull());
    expect(request).toHaveBeenCalledWith("/management-api/staffing/rota/shifts", "POST", {
      week: "2026-11-30",
      businessDay: "2026-12-04",
      area: { kind: "station", id: "kitchen" },
      staffRoleId: "sous",
      startsAt: "09:00",
      endsAt: "17:00",
      personId: "marc",
    });
    await vi.waitFor(() =>
      expect(area(el).shadowRoot!.querySelector("[data-slot=empty]")!.textContent).toContain("Ana"),
    );
    expect(request.mock.calls.slice(-2)).toEqual([
      ["/management-api/staffing/rota?week=2026-11-30", "GET", undefined, { passive: true }],
      [
        "/management-api/roster/breaches?locationId=location&period=2026-11-30",
        "GET",
        undefined,
        { passive: true },
      ],
    ]);
  });
  it("shows published weeks without slot actions", async () => {
    const el = await mount(
      rotaApi(async (w) => {
        const r = rotaWeek(w);
        r.version = { id: "pub", status: "published", changedSincePublished: false };
        return r;
      }).api,
    );
    expect(area(el).shadowRoot!.querySelector("button[data-slot]")).toBeNull();
    expect(el.shadowRoot!.textContent).toContain("Published");
  });
  it("keeps the new week's snapshot when an older read answers late", async () => {
    let old!: (r: RotaWeek) => void;
    const el = await (async () => {
      const { api } = rotaApi((w) =>
        w === "2026-11-30"
          ? new Promise((resolve) => (old = resolve))
          : Promise.resolve(rotaWeek(w)),
      );
      const f = document.createElement("div");
      document.body.append(f);
      frames.push(f);
      applyTokens(f);
      const v = document.createElement("staffing-rota") as View;
      v.api = api;
      v.week = "2026-11-30";
      v.open = vi.fn();
      f.append(v);
      await vi.waitFor(() => expect(old).toBeTypeOf("function"));
      return v;
    })();
    el.week = "2026-12-07";
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-by-area")).toBeTruthy());
    old(rotaWeek());
    await el.updateComplete;
    await Promise.resolve();
    expect(title(el)).toBe("7 – 13 Dec 2026");
  });
  it("updates from live changes and recovers load errors without hiding action errors", async () => {
    const live = new LiveData();
    const { api, request } = rotaApi(undefined, live);
    const el = await mount(api);
    expect(live.interests.map((i) => i.type)).toContain("shift_assignments");
    request.mockRejectedValueOnce({ code: "connection.failed" });
    live.invalidate([{ type: "shifts" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=load-error]")).toBeTruthy(),
    );
    live.invalidate([{ type: "shifts" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=load-error]")).toBeNull(),
    );
  });
  it.each(["390px", "900px", "1280px"])(
    "keeps the page width at %s and lets the grid scroll",
    async (width) => {
      const el = await mount(undefined, width);
      const r = area(el).shadowRoot!;
      const scroller = r.querySelector<HTMLElement>("[data-test=grid-scroll]")!;
      expect(el.getBoundingClientRect().width).toBeLessThanOrEqual(parseInt(width));
      expect(scroller.scrollWidth).toBeGreaterThanOrEqual(scroller.clientWidth);
      if (parseInt(width) >= 900) expect(scroller.scrollWidth).toBe(scroller.clientWidth);
    },
  );
});

describe("the Rota's Show menu", () => {
  it("one Show menu offers Everyone then each area, and sends the choice as the area word", async () => {
    const el = await mount();
    const menu = show(el);
    expect(menu.getAttribute("name")).toBe("area");
    expect(menu.label).toBe("Show");
    expect(menu.options.map((o) => o.value)).toEqual([
      "everyone",
      "station:kitchen",
      "department:restaurant",
    ]);
    expect(menu.options.map((o) => o.label)).toEqual(["Everyone", "Kitchen", "Restaurant"]);
    menu.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "everyone" } }));
    expect(el.open).toHaveBeenCalledWith("rota", { week: "2026-11-30", area: "everyone" });
    expect(el.shadowRoot!.querySelector("[data-test=by-area]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=by-person]")).toBeNull();
    el.params = { area: "everyone" };
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("rota-by-person")).toBeTruthy());
    expect(el.shadowRoot!.querySelector("rota-by-area")).toBeNull();
    expect(show(el).value).toBe("everyone");
  });
  it("a week step keeps Everyone", async () => {
    const el = await mount(undefined, "1280px", { area: "everyone" }, "rota-by-person");
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!.click();
    expect(el.open).toHaveBeenCalledWith("rota", { week: "2026-12-07", area: "everyone" });
  });
  it.each<Record<string, string>>([{}, { area: "station:kitchen" }])(
    "with no active area it shows Everyone: Show offers only Everyone, the grid lists people, and no day offers to add (%o)",
    async (params) => {
      const client = rotaApi(async (week) => {
        const read = rotaWeek(week);
        read.areas = [];
        return read;
      }).api;
      const el = await mount(client, "1280px", params, "rota-by-person");
      const menu = show(el);
      expect(menu.options.map((o) => o.value)).toEqual(["everyone"]);
      expect(menu.value).toBe("everyone");
      const grid = el.shadowRoot!.querySelector<LitElement>("rota-by-person")!;
      await grid.updateComplete;
      expect(grid.shadowRoot!.querySelectorAll("[data-person]")).toHaveLength(5);
      expect(el.shadowRoot!.textContent).toContain("No active areas.");
      expect(grid.shadowRoot!.querySelector("[data-test=day-add]")).toBeNull();
    },
  );
});

describe("the Rota's request lifecycle", () => {
  it("closes a picker when its week is published on another screen", async () => {
    const live = new LiveData();
    let published = false;
    const client = rotaApi(async (w) => {
      const r = rotaWeek(w);
      if (published) r.version = { id: "pub", status: "published", changedSincePublished: false };
      return r;
    }, live);
    const el = await mount(client.api);
    area(el).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("slot-picker")).toBeTruthy();
    published = true;
    live.invalidate([{ type: "roster_versions" }]);
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull());
  });
  it("retains a refused fill for retry, and closes the picker after a successful write even when refresh fails", async () => {
    const client = rotaApi();
    const el = await mount(client.api);
    area(el).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector<LitElement>("slot-picker")!;
    await picker.updateComplete;
    client.request.mockRejectedValueOnce({ code: "connection.failed" });
    picker.shadowRoot!.querySelector<HTMLElement>("[data-person=marc]")!.click();
    await vi.waitFor(() => expect(picker.shadowRoot!.querySelector("[role=alert]")).toBeTruthy());
    client.request
      .mockResolvedValueOnce({ shiftId: "new" })
      .mockRejectedValueOnce({ code: "connection.failed" });
    picker.shadowRoot!.querySelector<HTMLElement>("[data-person=marc]")!.click();
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull());
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=load-error]")).toBeTruthy(),
    );
  });
});

describe("Rota address and person details", () => {
  it("lists staff roles under each name in Everyone", async () => {
    const el = await mount(undefined, "1280px", { area: "everyone" }, "rota-by-person");
    expect((await everyone(el)).querySelector("[data-person=ana] th")!.textContent).toContain(
      "Head chef",
    );
  });
  it("does not show a picker for another area after an address change", async () => {
    const el = await mount();
    area(el).shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
    await el.updateComplete;
    el.params = { area: "department:restaurant" };
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull();
  });
});

const rest: RosterBreach = {
  kind: "rest_too_short",
  personId: "ana",
  previousShiftId: "previous",
  shiftId: "filled",
  restMinutes: 540,
  requiredMinutes: 720,
};
const ruleset: WorkTimeRuleset = {
  workingDaysPerWeek: 5,
  overtimeModel: "daily-accrual",
  referencePeriodDays: null,
  compensationWindowDays: null,
  dailyTargetMinutes: null,
  maxWeeklyMinutes: 2400,
  minInterShiftRestMinutes: 720,
  maxOrdinaryDailyMinutes: 540,
  breakThresholdMinutes: 360,
  minBreakMinutes: 15,
  weeklyRestMinutes: 2160,
  annualOvertimeCapHours: 80,
  nightWindowStartMinute: 1320,
  nightWindowEndMinute: 360,
  nightPremiumPct: null,
  splitShiftPremium: null,
  breaksCountAsWorked: false,
};
function withWarnings(
  read: (week: string) => Promise<RotaWeek> = async (w) => rotaWeek(w),
  rules: WorkTimeRuleset | null = ruleset,
) {
  const client = rotaApi(read);
  const original = client.request.getMockImplementation()!;
  client.request.mockImplementation((async (path: string, method: string, body: unknown) => {
    if (path.includes("/roster/breaches?")) return { breaches: [rest], ruleset: rules };
    if (path.endsWith("/change-week"))
      return {
        versionId: "draft",
        openSwaps: [
          { swapId: "s1", fromShiftId: "filled" },
          { swapId: "s2", fromShiftId: "over" },
        ],
      };
    return original(path, method, body);
  }) as unknown as typeof original);
  return client;
}
function allFilled(week?: string, overShift = false) {
  const read = rotaWeek(week);
  for (const day of read.days)
    for (const a of day.areas) {
      a.match.over = [];
      for (const s of a.match.slots)
        s.status = { kind: "filled", shiftId: "filled", outsideRole: false };
    }
  if (overShift) read.days[3]!.areas[0]!.match.over = ["over"];
  return read;
}
function noShifts(week?: string) {
  const read = rotaWeek(week);
  for (const day of read.days) {
    day.notInSlot = [];
    for (const a of day.areas) a.match = { slots: [], over: [] };
  }
  read.shifts = [];
  return read;
}
async function useViewport(width: number, height: number) {
  const before = [innerWidth, innerHeight] as const;
  await page.viewport(width, height);
  await vi.waitFor(() => expect(innerWidth).toBe(width));
  onTestFinished(() => page.viewport(...before));
}
const q = <T extends Element = HTMLElement>(el: View, selector: string) =>
  el.shadowRoot!.querySelector<T & Element>(selector);
const box = (n: Element) => n.getBoundingClientRect();
const centre = (n: Element) => box(n).top + box(n).height / 2;
const tokenColour = (name: string) => {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  frames[0]!.append(probe);
  return getComputedStyle(probe).color;
};
type Button = HTMLElementTagNameMap["wt-button"];
const counts = (el: View) => [...q(el, "[data-test=attention]")!.querySelectorAll(".count")];

describe("the Rota's bar", () => {
  const barParts = (el: View) => {
    const shown = counts(el);
    expect(shown.map((b) => [b.localName, normal(b.textContent!)])).toEqual([
      ["button", "1 unfilled"],
      ["button", "1 partly uncovered"],
      ["button", "1 over"],
    ]);
    const still = q(el, "[data-test=still-published]");
    const left = [
      q(el, "[data-test=previous-week]")!,
      q(el, "[data-test=week]")!,
      q(el, "[data-test=next-week]")!,
      show(el),
    ];
    const right = [
      q(el, "[data-test=state]")!,
      ...(still ? [still] : []),
      ...shown,
      q(el, "[data-test=labour-count]")!,
      q(el, "[data-test=publish-week]")!,
    ];
    return { left, right };
  };
  const inOrder = (parts: Element[]) => {
    const lefts = parts.map((n) => box(n).left);
    for (let i = 1; i < lefts.length; i++) expect(lefts[i]).toBeGreaterThan(lefts[i - 1]!);
  };
  const oneRow = (parts: Element[]) => {
    const first = centre(parts[0]!);
    for (const n of parts) expect(Math.abs(centre(n) - first)).toBeLessThanOrEqual(1);
  };
  const changing = () => withWarnings().api;
  const ordinary = () =>
    withWarnings(async (w) => {
      const r = rotaWeek(w);
      r.version = { id: "draft", status: "draft", changedSincePublished: false };
      return r;
    }).api;
  async function barAt(width: number, api: StaffingApi) {
    await useViewport(width, 900);
    const el = await mount(api, `${width}px`);
    await vi.waitFor(() => expect(q(el, "[data-test=labour-count]")).toBeTruthy());
    await el.updateComplete;
    return el;
  }
  it("the bar holds the week, Show, then the state, the counts, the labour count and Publish, in that order, on one row at 1440 while the week is being changed", async () => {
    const el = await barAt(1440, changing());
    const { left, right } = barParts(el);
    expect(right).toHaveLength(7);
    oneRow([...left, ...right]);
    inOrder([...left, ...right]);
    expect(box(right[0]!).left - box(show(el)).right).toBeGreaterThanOrEqual(72);
  });
  it("at 1280 a week being changed moves the whole right-hand group below the week and Show, right-aligned, in order, overlapping nothing", async () => {
    const el = await barAt(1280, changing());
    const { left, right } = barParts(el);
    oneRow(left);
    oneRow(right);
    inOrder(left);
    inOrder(right);
    const leftBottom = Math.max(...left.map((n) => box(n).bottom));
    for (const n of right) expect(box(n).top).toBeGreaterThanOrEqual(leftBottom);
    const all = [...left, ...right];
    for (const a of all)
      for (const b of all) {
        if (a === b) continue;
        const [p, r] = [box(a), box(b)];
        const overlap =
          p.left < r.right && r.left < p.right && p.top < r.bottom && r.top < p.bottom;
        expect(overlap).toBe(false);
      }
    const bar = box(q(el, "[data-test=bar]")!);
    expect(Math.abs(bar.right - box(right.at(-1)!).right)).toBeLessThanOrEqual(1);
    expect(box(right[0]!).left - bar.left).toBeGreaterThanOrEqual(64);
  });
  it("at 1280 an ordinary draft with counts and a labour count fits on one row", async () => {
    const el = await barAt(1280, ordinary());
    const { left, right } = barParts(el);
    expect(q(el, "[data-test=still-published]")).toBeNull();
    oneRow([...left, ...right]);
    inOrder([...left, ...right]);
    expect(box(right[0]!).left - box(show(el)).right).toBeGreaterThanOrEqual(64);
  });
  it("the labour count leads with a warning sign and is drawn in the danger colour", async () => {
    const el = await mount(withWarnings().api);
    await vi.waitFor(() => expect(q(el, "[data-test=labour-count]")).toBeTruthy());
    const labour = q(el, "[data-test=labour-count]")!;
    const sign = labour.firstChild as Element;
    expect(sign.nodeType).toBe(Node.ELEMENT_NODE);
    expect(sign.textContent).toBe("⚠");
    expect(sign.getAttribute("aria-hidden")).toBe("true");
    expect(normal(labour.textContent!)).toBe("⚠ 1 labour warning");
    expect(getComputedStyle(labour).color).toBe(tokenColour("--wt-color-danger"));
  });
  it("with no labour rules the note takes the labour count's place, after the counts", async () => {
    await useViewport(1280, 900);
    const el = await mount(withWarnings(undefined, null).api);
    await vi.waitFor(() => expect(q(el, "[data-test=no-rules]")).toBeTruthy());
    expect(q(el, "[data-test=labour-count]")).toBeNull();
    expect(normal(q(el, "[data-test=bar]")!.textContent!)).toContain(
      "1 unfilled · 1 partly uncovered · 1 over · No labour rules to check against",
    );
    expect(box(q(el, "[data-test=no-rules]")!).left).toBeGreaterThan(box(counts(el).at(-1)!).left);
  });
  it("Publish is in the bar of every unpublished week: quiet with no shifts or no version, loud once a shift exists", async () => {
    for (const version of [null, { id: "draft", status: "draft", changedSincePublished: false }]) {
      const el = await mount(
        withWarnings(async (w) => {
          const r = noShifts(w);
          r.version = version as RotaWeek["version"];
          return r;
        }).api,
      );
      await vi.waitFor(() => expect(q(el, "[data-test=labour-count]")).toBeTruthy());
      const publish = q<Button>(el, "[data-test=bar] [data-test=publish-week]")!;
      expect(publish.variant).toBe("secondary");
      expect(publish.disabled).toBe(true);
    }
    const el = await mount(withWarnings().api);
    const publish = q<Button>(el, "[data-test=bar] [data-test=publish-week]")!;
    await vi.waitFor(() => expect(q(el, "[data-test=labour-count]")).toBeTruthy());
    await el.updateComplete;
    expect(publish.variant).toBe("primary");
    expect(publish.disabled).toBe(false);
  });
  it("a week being changed says staff still see the published week, before the counts, and offers Publish changes", async () => {
    await useViewport(1280, 900);
    const el = await mount(withWarnings().api);
    await vi.waitFor(() => expect(q(el, "[data-test=labour-count]")).toBeTruthy());
    const still = q(el, "[data-test=bar] [data-test=still-published]")!;
    expect(normal(still.textContent!)).toBe("Staff still see the published week");
    expect(box(still).left).toBeGreaterThan(box(q(el, "[data-test=state]")!).left);
    expect(box(still).left).toBeLessThan(box(counts(el)[0]!).left);
    expect(normal(q(el, "[data-test=publish-week]")!.textContent!)).toBe("Publish changes");

    const unchanged = await mount(
      withWarnings(async (w) => {
        const r = rotaWeek(w);
        r.version = { id: "draft", status: "draft", changedSincePublished: false };
        return r;
      }).api,
    );
    await vi.waitFor(() => expect(q(unchanged, "[data-test=labour-count]")).toBeTruthy());
    expect(q(unchanged, "[data-test=still-published]")).toBeNull();
    expect(unchanged.shadowRoot!.textContent).not.toContain("Staff still see the published week");
    expect(normal(q(unchanged, "[data-test=publish-week]")!.textContent!)).toBe("Publish week");
  });
  it("a published week shows Published in the success colour, its summary and Change this week", async () => {
    const el = await mount(
      withWarnings(async (w) => {
        const r = allFilled(w);
        r.version = { id: "pub", status: "published", changedSincePublished: false };
        return r;
      }).api,
    );
    const state = q(el, "[data-test=state]")!;
    expect(normal(state.textContent!)).toBe("Published");
    expect(getComputedStyle(state).color).toBe(tokenColour("--wt-color-success"));
    const summary = q(el, "[data-test=attention] [data-test=summary]")!;
    expect(normal(summary.textContent!)).toBe("All slots filled");
    expect(getComputedStyle(summary).color).toBe(tokenColour("--wt-color-success"));
    const change = q<Button>(el, "[data-test=bar] [data-test=change-week]")!;
    expect(change.variant).toBe("secondary");
    expect(q(el, "[data-test=publish-week]")).toBeNull();
  });
  it("draws Draft as the state with no version yet", async () => {
    const el = await mount(
      rotaApi(async (w) => {
        const r = rotaWeek(w);
        r.version = null;
        return r;
      }).api,
    );
    expect(normal(q(el, "[data-test=state]")!.textContent!)).toBe("Draft");
    expect(getComputedStyle(q(el, "[data-test=state]")!).color).toBe(
      tokenColour("--wt-color-text"),
    );
  });
  it("zero counts are left out; with none it reads All slots filled", async () => {
    const some = await mount(rotaApi(async (w) => allFilled(w, true)).api);
    expect(counts(some).map((b) => normal(b.textContent!))).toEqual(["1 over"]);
    expect(normal(q(some, "[data-test=attention]")!.textContent!)).toBe("1 over");
    expect(getComputedStyle(counts(some)[0]!).color).toBe(tokenColour("--wt-color-warning"));
    const none = await mount(rotaApi(async (w) => allFilled(w)).api);
    expect(counts(none)).toEqual([]);
    expect(normal(q(none, "[data-test=attention]")!.textContent!)).toBe("All slots filled");
  });
  it("says no shifts yet for Everyone with nothing in the week, and nothing to fill for an area with no slot", async () => {
    const empty = async (w: string) => noShifts(w);
    const everyone = await mount(
      rotaApi(empty).api,
      "1280px",
      { area: "everyone" },
      "rota-by-person",
    );
    expect(normal(q(everyone, "[data-test=attention]")!.textContent!)).toBe("No shifts yet");
    const kitchen = await mount(rotaApi(empty).api);
    expect(normal(q(kitchen, "[data-test=attention]")!.textContent!)).toBe("Nothing to fill");
  });
  it("a week whose only shift is carried in from the previous week reads No shifts yet and keeps Publish quiet", async () => {
    const carried = async (w: string) => {
      const r = noShifts(w);
      const prior = rotaWeek(w).shifts.find((x) => x.shiftId === "unlinked")!;
      r.shifts = [prior];
      r.days[0]!.notInSlot = [{ shiftId: "unlinked", outsideWeek: true }];
      return r;
    };
    const el = await mount(
      withWarnings(carried).api,
      "1280px",
      { area: "everyone" },
      "rota-by-person",
    );
    await vi.waitFor(() => expect(q(el, "[data-test=labour-count]")).toBeTruthy());
    expect(normal(q(el, "[data-test=attention]")!.textContent!)).toBe("No shifts yet");
    const publish = q<Button>(el, "[data-test=publish-week]")!;
    expect(publish.variant).toBe("secondary");
    expect(publish.disabled).toBe(true);
  });
  it("the counts are not a live region; their words are announced from a hidden status", async () => {
    const el = await mount();
    expect(q(el, "[data-test=attention]")!.hasAttribute("role")).toBe(false);
    const status = q(el, "[data-test=attention-status]")!;
    expect(status.getAttribute("role")).toBe("status");
    expect(normal(status.textContent!)).toBe("1 unfilled · 1 partly uncovered · 1 over");
    expect(box(status).width).toBeLessThanOrEqual(1);
    const filled = await mount(rotaApi(async (w) => allFilled(w)).api);
    expect(normal(q(filled, "[data-test=attention-status]")!.textContent!)).toBe(
      "All slots filled",
    );
  });
  it("the open-swaps notice sits under the bar", async () => {
    await useViewport(1280, 900);
    let changed = false;
    const el = await mount(
      withWarnings(async (w) => {
        const r = rotaWeek(w);
        r.version = changed
          ? { id: "draft", status: "draft", changedSincePublished: true }
          : { id: "pub", status: "published", changedSincePublished: false };
        return r;
      }).api,
    );
    await vi.waitFor(() => expect(q(el, "[data-test=change-week]")).toBeTruthy());
    changed = true;
    q(el, "[data-test=change-week]")!.click();
    await vi.waitFor(() => expect(q(el, "[data-test=swap-notice]")).toBeTruthy());
    await vi.waitFor(() => expect(q(el, "[data-test=publish-week]")).toBeTruthy());
    expect(box(q(el, "[data-test=swap-notice]")!).top).toBeGreaterThanOrEqual(
      box(q(el, "[data-test=bar]")!).bottom,
    );
  });
});

describe("the Rota's week title", () => {
  type Linked = View & { canOpenStaffing: boolean };
  const months = (el: View) => [
    ...el.shadowRoot!.querySelectorAll<HTMLButtonElement>("[data-test=week] button"),
  ];
  it("the title is the week's range", async () => {
    const el = await mount();
    expect(title(el)).toBe("30 Nov – 6 Dec 2026");
    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;
    expect(title(el)).toBe("30 nov – 6 dic 2026");
  });
  it("the title keeps one width across weeks", async () => {
    await useViewport(1280, 900);
    const el = await mount();
    const width = () => box(q(el, ".fixed-title")!).width;
    await el.updateComplete;
    const first = width();
    el.week = "2026-12-28";
    await vi.waitFor(() => {
      expect(title(el)).toBe("28 Dec 2026 – 3 Jan 2027");
      expect(q(el, "rota-by-area")).toBeTruthy();
    });
    await el.updateComplete;
    expect(first).toBeGreaterThan(0);
    expect(Math.abs(width() - first)).toBeLessThanOrEqual(0.5);
  });
  it("each month name opens that month's Staffing", async () => {
    const el = (await mount()) as Linked;
    expect(months(el)).toHaveLength(0);
    el.canOpenStaffing = true;
    await el.updateComplete;
    const [nov, dec] = months(el);
    expect(months(el).map((b) => normal(b.textContent!))).toEqual(["Nov", "Dec"]);
    for (const link of [nov!, dec!]) {
      const hint = el.shadowRoot!.getElementById(link.getAttribute("aria-describedby")!);
      expect(normal(hint!.textContent!)).toBe("Opens this month's staffing");
    }
    nov!.click();
    expect(el.open).toHaveBeenLastCalledWith("staffing", {
      month: "2026-11",
      area: "station:kitchen",
    });
    dec!.click();
    expect(el.open).toHaveBeenLastCalledWith("staffing", {
      month: "2026-12",
      area: "station:kitchen",
    });
    el.params = { area: "everyone" };
    await vi.waitFor(() => expect(q(el, "rota-by-person")).toBeTruthy());
    months(el)[0]!.click();
    expect(el.open).toHaveBeenLastCalledWith("staffing", { month: "2026-11" });
    months(el)[1]!.click();
    expect(el.open).toHaveBeenLastCalledWith("staffing", { month: "2026-12" });
    el.canOpenStaffing = false;
    await el.updateComplete;
    expect(q(el, "[data-test=week]")!.querySelector("button")).toBeNull();
    expect(title(el)).toBe("30 Nov – 6 Dec 2026");
  });
});

describe("the Rota's slot picker beside its slot", () => {
  type Popup = HTMLElementTagNameMap["rota-popup"];
  type Picker = LitElement & { pickedSlot: { key: string } };
  const popupBox = (el: View) =>
    q<Popup>(el, "rota-popup")!.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const slotIn = (el: View, key: string) =>
    area(el).shadowRoot!.querySelector<HTMLElement>(`[data-slot=${key}]`)!;
  async function opened(el: View) {
    await vi.waitFor(() =>
      expect(
        q<Picker>(el, "slot-picker")?.shadowRoot?.querySelector("[data-person=marc]"),
      ).toBeTruthy(),
    );
    await vi.waitFor(() => expect(popupBox(el).matches(":popover-open")).toBe(true));
    return q<Picker>(el, "slot-picker")!;
  }
  function beside(el: View, slot: HTMLElement) {
    const s = box(slot),
      p = box(popupBox(el));
    expect(Math.abs(p.top - s.top)).toBeLessThanOrEqual(1);
    expect(near(p.left, s.right) || near(p.right, s.left)).toBe(true);
    expect(p.left >= s.right - 1 || p.right <= s.left + 1).toBe(true);
  }
  it("the picker opens beside the slot that was clicked, not in a side panel, and the grid takes the full width", async () => {
    await useViewport(1280, 900);
    const el = await mount();
    const slot = slotIn(el, "empty");
    await userEvent.click(slot);
    await opened(el);
    expect(q(el, "rota-popup > slot-picker")).toBeTruthy();
    beside(el, slot);
    expect(q(el, "aside")).toBeNull();
    const scroller = area(el).shadowRoot!.querySelector("[data-test=grid-scroll]")!;
    expect(Math.abs(box(scroller).width - box(el).width)).toBeLessThanOrEqual(1);
  });
  it("the picker moves with its slot when the grid scrolls, and closes once the slot leaves the window", async () => {
    await useViewport(1280, 900);
    onTestFinished(() => scrollTo(0, 0));
    const el = await mount(undefined, "700px");
    const scroller = area(el).shadowRoot!.querySelector<HTMLElement>("[data-test=grid-scroll]")!;
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    const slot = slotIn(el, "empty");
    await userEvent.click(slot);
    await opened(el);
    beside(el, slot);
    const before = box(slot).left;
    scroller.scrollLeft = 40;
    await vi.waitFor(() => {
      expect(box(slot).left).toBeLessThan(before - 1);
      beside(el, slot);
    });
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    frames[0]!.append(spacer);
    scrollTo(0, scrollY + box(slot).bottom + 10);
    await vi.waitFor(() => expect(q(el, "slot-picker")).toBeNull());
    expect(popupBox(el).matches(":popover-open")).toBe(false);
  });
  it("clicking a second slot while a picker is open opens the second slot's picker", async () => {
    await useViewport(1280, 900);
    const el = await mount(
      rotaApi(async (week) => {
        const read = rotaWeek(week);
        const empty = read.days[4]!.areas[0]!.match.slots[0]!;
        read.days[3]!.areas[0]!.match.slots.push({
          slot: { ...empty.slot, key: "empty2", businessDay: "2026-12-03" },
          status: { kind: "unfilled" },
        });
        return read;
      }).api,
    );
    await userEvent.click(slotIn(el, "empty"));
    await opened(el);
    await userEvent.click(slotIn(el, "empty2"));
    await new Promise(requestAnimationFrame);
    await el.updateComplete;
    expect(q<Picker>(el, "slot-picker")?.pickedSlot.key).toBe("empty2");
    expect(popupBox(el).matches(":popover-open")).toBe(true);
    beside(el, slotIn(el, "empty2"));
  });
  it("a close from the earlier popup that arrives after a new pick leaves the new pick open", async () => {
    await useViewport(1280, 900);
    const el = await mount(
      rotaApi(async (week) => {
        const read = rotaWeek(week);
        const empty = read.days[4]!.areas[0]!.match.slots[0]!;
        read.days[3]!.areas[0]!.match.slots.push({
          slot: { ...empty.slot, key: "empty2", businessDay: "2026-12-03" },
          status: { kind: "unfilled" },
        });
        return read;
      }).api,
    );
    await userEvent.click(slotIn(el, "empty"));
    await opened(el);
    const lateClose = () =>
      q(el, "rota-popup")!.dispatchEvent(
        new CustomEvent("rota-popup-close", { detail: {}, bubbles: true, composed: true }),
      );
    slotIn(el, "empty2").click();
    lateClose();
    // A popup's close is delivered in a later task than the click that made the new pick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(popupBox(el).matches(":popover-open")).toBe(true);
    lateClose();
    await el.updateComplete;
    await new Promise(requestAnimationFrame);
    expect(q<Picker>(el, "slot-picker")?.pickedSlot.key).toBe("empty2");
    expect(popupBox(el).matches(":popover-open")).toBe(true);
    beside(el, slotIn(el, "empty2"));
  });
  it("a fill refused after the picker was dismissed shows under the bar", async () => {
    await useViewport(1280, 900);
    const client = rotaApi();
    const original = client.request.getMockImplementation()!;
    let refuse!: (e: unknown) => void;
    client.request.mockImplementation((async (path: string, method: string, body: unknown) => {
      if (method === "POST" && path.endsWith("/rota/shifts"))
        return new Promise((_, reject) => (refuse = reject));
      return original(path, method, body);
    }) as unknown as typeof original);
    const el = await mount(client.api);
    await userEvent.click(slotIn(el, "empty"));
    const picker = await opened(el);
    picker.shadowRoot!.querySelector<HTMLElement>("[data-person=marc]")!.click();
    await vi.waitFor(() => expect(refuse).toBeTypeOf("function"));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(q(el, "slot-picker")).toBeNull());
    refuse({ code: "connection.failed" });
    await vi.waitFor(() => expect(q(el, "[role=alert]")).toBeTruthy());
    const alert = q(el, "[role=alert]")!;
    expect(alert.textContent).toContain("Could not fill the slot");
    expect(box(alert).top).toBeGreaterThanOrEqual(box(q(el, "[data-test=bar]")!).bottom);
    await vi.waitFor(() =>
      expect(area(el).shadowRoot!.activeElement?.getAttribute("data-slot")).toBe("empty"),
    );
    expect(document.activeElement).not.toBe(document.body);
  });
  it("a picker stays beside its slot through a fill and its refusal, and Escape then returns to the slot", async () => {
    await useViewport(1280, 900);
    onTestFinished(() => scrollTo(0, 0));
    const client = rotaApi();
    const original = client.request.getMockImplementation()!;
    let refuse!: (e: unknown) => void;
    client.request.mockImplementation((async (path: string, method: string, body: unknown) => {
      if (method === "POST" && path.endsWith("/rota/shifts"))
        return new Promise((_, reject) => (refuse = reject));
      return original(path, method, body);
    }) as unknown as typeof original);
    const el = await mount(client.api, "700px");
    const scroller = area(el).shadowRoot!.querySelector<HTMLElement>("[data-test=grid-scroll]")!;
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    const first = slotIn(el, "empty");
    await userEvent.click(first);
    const picker = await opened(el);
    picker.shadowRoot!.querySelector<HTMLElement>("[data-person=marc]")!.click();
    await vi.waitFor(() => expect(refuse).toBeTypeOf("function"));
    await vi.waitFor(() => expect(slotIn(el, "empty")).not.toBe(first));
    const during = box(slotIn(el, "empty")).left;
    scroller.scrollLeft = 40;
    await vi.waitFor(() => {
      expect(box(slotIn(el, "empty")).left).toBeLessThan(during - 1);
      beside(el, slotIn(el, "empty"));
    });
    refuse({ code: "connection.failed" });
    await vi.waitFor(() =>
      expect(picker.shadowRoot!.querySelector("[role=alert]")?.textContent).toContain(
        "Could not fill the slot",
      ),
    );
    await vi.waitFor(() => expect(slotIn(el, "empty").localName).toBe("button"));
    const after = box(slotIn(el, "empty")).left;
    scroller.scrollLeft = 80;
    await vi.waitFor(() => {
      expect(box(slotIn(el, "empty")).left).toBeLessThan(after - 1);
      beside(el, slotIn(el, "empty"));
    });
    expect(q(el, "slot-picker")).toBe(picker);
    expect(picker.shadowRoot!.querySelector("[role=alert]")!.textContent).toContain(
      "Could not fill the slot",
    );
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(q(el, "slot-picker")).toBeNull());
    expect(area(el).shadowRoot!.activeElement).toBe(slotIn(el, "empty"));
    expect(document.activeElement).not.toBe(document.body);
  });
  it("a screen reader hears the slot's heading once: the picker repeats it for the eye only", async () => {
    await useViewport(1280, 900);
    const el = await mount();
    await userEvent.click(slotIn(el, "empty"));
    const picker = await opened(el);
    const headings = "h1, h2, h3, h4, h5, h6, [role=heading]";
    const popup = q(el, "rota-popup")!;
    expect(
      [...popup.shadowRoot!.querySelectorAll(headings)].map((h) => normal(h.textContent!)),
    ).toEqual(["Fri 4 Dec · Sous chef · 09:00–17:00"]);
    expect(picker.shadowRoot!.querySelector(headings)).toBeNull();
    expect(picker.shadowRoot!.querySelector("[aria-labelledby]")).toBeNull();
    const title = picker.shadowRoot!.querySelector<HTMLElement>("[data-test=picker-title]")!;
    expect(normal(title.textContent!)).toBe("Fri 4 Dec · Sous chef · 09:00–17:00");
    expect(title.getAttribute("aria-hidden")).toBe("true");
    expect(box(title).width).toBeGreaterThan(0);
    expect(box(title).height).toBeGreaterThan(0);
  });
});

/** A second unfilled slot, on Tuesday in the Head chef row, beside the fixture's Friday one. */
function twoUnfilled(published = false) {
  return rotaApi(async (w) => {
    const r = rotaWeek(w);
    const empty = r.days[4]!.areas[0]!.match.slots[0]!;
    r.days[1]!.areas[0]!.match.slots.push({
      slot: { ...empty.slot, key: "tue", businessDay: r.days[1]!.businessDay, staffRoleId: "head" },
      status: { kind: "unfilled" },
    });
    if (published) r.version = { id: "pub", status: "published", changedSincePublished: false };
    return r;
  }).api;
}
const countButton = (el: View, kind: string) =>
  q<HTMLButtonElement>(el, `[data-test=attention] .count[data-kind=${kind}]`)!;
const dayHead = (root: ShadowRoot, day: string) =>
  root.querySelector<HTMLElement>(`th[data-day-head="${day}"]`)!;

describe("the Rota's count buttons and day headers", () => {
  it("each count button focuses the next such slot, wrapping", async () => {
    const el = await mount(twoUnfilled());
    const r = area(el).shadowRoot!;
    for (const key of ["tue", "empty", "tue"]) {
      countButton(el, "unfilled").click();
      await vi.waitFor(() => expect(r.activeElement).toBe(r.querySelector(`[data-slot=${key}]`)));
    }
    countButton(el, "partly").click();
    await vi.waitFor(() => expect(r.activeElement).toBe(r.querySelector("[data-slot=part]")));
    countButton(el, "over").click();
    await vi.waitFor(() => expect(r.activeElement).toBe(r.querySelector("[data-shift=over]")));
    countButton(el, "unfilled").click();
    await vi.waitFor(() => expect(r.activeElement).toBe(r.querySelector("[data-slot=empty]")));
  });
  it("in a published week a count focuses a card that is not a button", async () => {
    const el = await mount(twoUnfilled(true));
    const r = area(el).shadowRoot!;
    countButton(el, "unfilled").click();
    const card = r.querySelector<HTMLElement>("[data-slot=tue]")!;
    expect(card.localName).toBe("div");
    await vi.waitFor(() => expect(r.activeElement).toBe(card));
    expect(card.getAttribute("tabindex")).toBe("-1");
    countButton(el, "over").click();
    const over = r.querySelector<HTMLElement>("[data-shift=over]")!;
    await vi.waitFor(() => expect(r.activeElement).toBe(over));
    expect(over.getAttribute("tabindex")).toBe("-1");
  });
  it("in Everyone the unfilled count steps to the next day header that says it has unfilled slots", async () => {
    const el = await mount(twoUnfilled(), "1280px", { area: "everyone" }, "rota-by-person");
    const r = await everyone(el);
    for (const day of ["2026-12-01", "2026-12-04", "2026-12-01"]) {
      countButton(el, "unfilled").click();
      await vi.waitFor(() => expect(r.activeElement).toBe(dayHead(r, day)));
      expect(r.activeElement!.textContent).toContain("unfilled");
      expect(r.activeElement!.getAttribute("tabindex")).toBe("-1");
    }
    countButton(el, "over").click();
    await vi.waitFor(() => expect(r.activeElement).toBe(r.querySelector("[data-shift=over]")));
    countButton(el, "partly").click();
    await vi.waitFor(() => expect(r.activeElement).toBe(r.querySelector("[data-shift=part]")));
    expect(el.open).not.toHaveBeenCalled();
    expect(el.shadowRoot!.querySelector("rota-by-person")).toBeTruthy();
  });
  it("a day header names its attention and a closed day reads Closed once", async () => {
    const el = await mount();
    const r = area(el).shadowRoot!;
    expect(normal(dayHead(r, "2026-12-04").textContent!)).toContain("1 unfilled");
    expect(normal(dayHead(r, "2026-12-01").textContent!)).toContain("1 partly uncovered");
    expect(normal(dayHead(r, "2026-12-03").textContent!)).toContain("1 over");
    expect(normal(dayHead(r, "2026-12-02").textContent!)).toBe("Wed 2");
    expect(normal(dayHead(r, "2026-11-30").textContent!)).toContain("Closed");
    expect([...r.querySelectorAll("td")].filter((c) => c.textContent!.includes("Closed"))).toEqual(
      [],
    );
    expect(normal(r.textContent!).match(/Closed/g)).toHaveLength(1);
  });
  it("a day header joins several counts with a dot", async () => {
    const el = await mount(twoUnfilled());
    expect(normal(dayHead(area(el).shadowRoot!, "2026-12-01").textContent!)).toContain(
      "1 unfilled · 1 partly uncovered",
    );
  });
});

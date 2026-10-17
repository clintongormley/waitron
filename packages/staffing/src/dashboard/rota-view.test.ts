import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page } from "vitest/browser";
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
const area = (el: View) => el.shadowRoot!.querySelector<LitElement>("rota-by-area")!;
const text = (el: View) => area(el).shadowRoot!.textContent!;

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
      "+ unfilled",
      "belongs to the previous week",
      "Closed",
    ])
      expect(text(el)).toContain(label);
    const attention = el.shadowRoot!.querySelector("[data-test=attention]")!;
    expect(normal(attention.textContent!)).toContain("1 unfilled · 1 partly uncovered · 1 over");
    expect(
      [...attention.querySelectorAll(".count")].map((b) => [b.localName, normal(b.textContent!)]),
    ).toEqual([
      ["button", "1 unfilled"],
      ["button", "1 partly uncovered"],
      ["button", "1 over"],
    ]);
    expect(el.shadowRoot!.querySelector("[data-person=joan]")!.textContent).toContain("41 / 40 h");
    expect(
      el.shadowRoot!.querySelector("[data-person=joan]")!.hasAttribute("data-over-contract"),
    ).toBe(true);
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
    expect(el.shadowRoot!.querySelector("[data-test=week]")!.textContent).toContain("7 Dec");
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
      expect(grid.shadowRoot!.querySelector("[data-test=add-shift]")).toBeNull();
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
  it("lists staff roles in the people panel", async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector("[data-person=ana]")!.textContent).toContain("Head chef");
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
  it("the bar holds the week, Show, then the state, the counts, the labour count and Publish, in that order, on one row at 1280", async () => {
    await useViewport(1280, 900);
    const el = await mount(withWarnings().api);
    await vi.waitFor(() => expect(q(el, "[data-test=labour-count]")).toBeTruthy());
    await el.updateComplete;
    const shown = counts(el);
    expect(shown.map((b) => [b.localName, normal(b.textContent!)])).toEqual([
      ["button", "1 unfilled"],
      ["button", "1 partly uncovered"],
      ["button", "1 over"],
    ]);
    const order = [
      q(el, "[data-test=previous-week]")!,
      q(el, "[data-test=week]")!,
      q(el, "[data-test=next-week]")!,
      show(el),
      q(el, "[data-test=state]")!,
      ...shown,
      q(el, "[data-test=labour-count]")!,
      q(el, "[data-test=publish-week]")!,
    ];
    const first = centre(order[0]!);
    for (const n of order) expect(Math.abs(centre(n) - first)).toBeLessThanOrEqual(1);
    const lefts = order.map((n) => box(n).left);
    for (let i = 1; i < lefts.length; i++) expect(lefts[i]).toBeGreaterThan(lefts[i - 1]!);
    expect(box(q(el, "[data-test=state]")!).left - box(show(el)).right).toBeGreaterThanOrEqual(64);
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

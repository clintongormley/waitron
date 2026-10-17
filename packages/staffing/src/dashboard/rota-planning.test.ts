import type { RosterBreach } from "@waitron/workforce/roster-validation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import { LiveData, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { rotaWeek } from "../testing/rota-fixture.js";
import { StaffingApi } from "./client.js";
import "./rota-view.js";

const frames: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  frames.splice(0).forEach((f) => f.remove());
  setLocale("en");
});
const rest = {
  kind: "rest_too_short" as const,
  personId: "ana",
  previousShiftId: "previous",
  shiftId: "filled",
  restMinutes: 540,
  requiredMinutes: 720,
};
const ruleset = {
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
async function mount(missing = false) {
  const live = new LiveData();
  let breaches: RosterBreach[] = [rest];
  let published = false;
  let changed = false;
  const request = vi.fn(async (path: string, method: string) => {
    if (path.includes("/rota?"))
      return {
        ...rotaWeek(),
        locationId: "location",
        version: {
          id: "draft",
          status: published && !changed ? "published" : "draft",
          changedSincePublished: false,
        },
      };
    if (path.includes("/roster/breaches?")) {
      if (missing)
        throw { code: "configuration.not_found", status: 409, params: { locationId: "location" } };
      return { breaches, ruleset };
    }
    if (path.endsWith("/change-week")) {
      changed = true;
      return { versionId: "draft", openSwaps: [{ swapId: "swap", fromShiftId: "filled" }] };
    }
    if (path.endsWith("/publish")) {
      published = true;
      return { breaches };
    }
    if (path.endsWith("/rota/shifts") && method === "POST") {
      breaches = [];
      return { shiftId: "new" };
    }
    throw Error(`unexpected ${method} ${path}`);
  });
  const f = document.createElement("div");
  frames.push(f);
  document.body.append(f);
  applyTokens(f);
  const el = document.createElement("staffing-rota") as LitElement & {
    api: StaffingApi;
    week: string;
    params: Record<string, string>;
    canWrite: boolean;
    open: () => void;
  };
  el.api = new StaffingApi(request as unknown as DashboardRequest, live);
  el.week = "2026-11-30";
  el.canWrite = true;
  el.open = () => undefined;
  f.append(el);
  await vi.waitFor(() => expect(el.shadowRoot?.querySelector("rota-by-area")).toBeTruthy());
  return {
    el,
    request,
    live,
    setPublished: () => {
      published = true;
      live.invalidate([{ type: "roster_versions" }]);
    },
    setBreaches: (value: typeof breaches) => {
      breaches = value;
    },
  };
}
const click = (root: ShadowRoot, selector: string) => {
  const button = root.querySelector<HTMLElement>(selector);
  expect(button, selector).toBeTruthy();
  button!.click();
};
describe("planning warnings and publication", () => {
  it("opens assigned and unlinked shifts from the area view with their swap marker", async () => {
    const { el } = await mount();
    const area = el.shadowRoot!.querySelector<LitElement & { week: ReturnType<typeof rotaWeek> }>(
      "rota-by-area",
    )!;
    area.week = {
      ...area.week,
      openSwaps: [{ swapId: "swap", fromShiftId: "filled", toShiftId: null }],
    };
    await area.updateComplete;
    expect(area.shadowRoot!.querySelector("[data-slot=filled]")!.textContent).toContain(
      "Open swap request",
    );
    click(area.shadowRoot!, "[data-slot=filled]");
    await el.updateComplete;
    const editor = el.shadowRoot!.querySelector<LitElement & { shiftId: string; open: boolean }>(
      "rota-shift-dialog",
    )!;
    await editor.updateComplete;
    expect(editor.open).toBe(true);
    expect(editor.shiftId).toBe("filled");
    editor.dispatchEvent(new CustomEvent("shift-close", { bubbles: true, composed: true }));
    await el.updateComplete;
    click(area.shadowRoot!, "[data-shift=unlinked]");
    await el.updateComplete;
    await editor.updateComplete;
    expect(editor.shiftId).toBe("unlinked");
  });
  it("opens published weeks read-only, creates a draft and warns once about its pending swap", async () => {
    const { el, request, setPublished } = await mount();
    setPublished();
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Published"));
    expect(el.shadowRoot!.querySelector("[data-test=publish-week]")).toBeNull();
    click(el.shadowRoot!, "[data-test=change-week]");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=publish-week]")).toBeTruthy(),
    );
    expect(request).toHaveBeenCalledWith("/management-api/staffing/rota/change-week", "POST", {
      week: "2026-11-30",
    });
    expect(el.shadowRoot!.textContent).toContain("1 swap request is open for this week");
  });
  it("previews a candidate's rest warning in the real picker and clears it without rules", async () => {
    const { el } = await mount();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=labour-count]")).toBeTruthy(),
    );
    click(el.shadowRoot!.querySelector("rota-by-area")!.shadowRoot!, "[data-slot=empty]");
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector<
      LitElement & { week: ReturnType<typeof rotaWeek>; ruleset: unknown }
    >("slot-picker")!;
    picker.week = {
      ...rotaWeek(),
      timeZone: "Europe/Madrid",
      shifts: [
        {
          ...rotaWeek().shifts[0]!,
          shiftId: "late",
          personId: "marc",
          startsAt: "2026-12-03T17:00:00Z",
          endsAt: "2026-12-03T23:00:00Z",
        },
      ],
    };
    await picker.updateComplete;
    expect(picker.shadowRoot!.querySelector("[data-person=marc]")!.textContent).toContain(
      "9 h rest; minimum 12 h",
    );
    expect(picker.shadowRoot!.querySelector("[data-person=joan]")!.textContent).not.toContain(
      "9 h rest",
    );
    picker.ruleset = null;
    await picker.updateComplete;
    expect(picker.shadowRoot!.querySelector("[data-person=marc]")!.textContent).not.toContain(
      "9 h rest",
    );
  });
  it("draws the warning on its shift, counts it and reads changes passively", async () => {
    const { el, request, live, setBreaches } = await mount();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=labour-count]")?.textContent).toContain(
        "1 labour warning",
      ),
    );
    const grid = el.shadowRoot!.querySelector("rota-by-area")!;
    expect(grid.shadowRoot!.querySelector("[data-slot=filled]")!.textContent).toContain("9 h rest");
    expect(request).toHaveBeenCalledWith(
      "/management-api/roster/breaches?locationId=location&period=2026-11-30",
      "GET",
      undefined,
      { passive: true },
    );
    setBreaches([]);
    live.invalidate([{ type: "shifts" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=labour-count]")?.textContent).toContain(
        "0 labour warnings",
      ),
    );
    expect(grid.shadowRoot!.querySelector("[data-slot=filled]")!.textContent).not.toContain(
      "9 h rest",
    );
  });
  it("shows warnings before publishing, goes back, then publishes anyway", async () => {
    const { el, request } = await mount();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=labour-count]")).toBeTruthy(),
    );
    click(el.shadowRoot!, "[data-test=publish-week]");
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector<LitElement>("rota-publish-dialog")!;
    expect(dialog).toBeTruthy();
    await dialog.updateComplete;
    expect(dialog.shadowRoot!.textContent).toContain("Ana");
    expect(dialog.shadowRoot!.textContent).toContain("9 h rest");
    click(dialog.shadowRoot!, "[data-test=back]");
    await el.updateComplete;
    expect(request.mock.calls.some(([p]) => p.endsWith("/publish"))).toBe(false);
    click(el.shadowRoot!, "[data-test=publish-week]");
    await el.updateComplete;
    await dialog.updateComplete;
    click(dialog.shadowRoot!, "[data-test=publish]");
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Published"));
    expect(request).toHaveBeenCalledWith("/management-api/roster/draft/publish", "POST");
  });
  it("keeps filling and publishing available without labour rules", async () => {
    const { el, request } = await mount(true);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=bar]")!.textContent).toContain(
        "No labour rules to check against",
      ),
    );
    click(el.shadowRoot!.querySelector("rota-by-area")!.shadowRoot!, "[data-slot=empty]");
    await el.updateComplete;
    const picker = el.shadowRoot!.querySelector<LitElement>("slot-picker")!;
    await picker.updateComplete;
    click(picker.shadowRoot!, "[data-person=marc]");
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("slot-picker")).toBeNull());
    click(el.shadowRoot!, "[data-test=publish-week]");
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector<LitElement>("rota-publish-dialog")!;
    await dialog.updateComplete;
    click(dialog.shadowRoot!, "[data-test=publish]");
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Published"));
    expect(request.mock.calls.filter(([p]) => p.endsWith("/publish"))).toHaveLength(1);
  });
});

describe("planning request failures", () => {
  it("keeps a publish refusal through a background recovery and retries without reopening", async () => {
    const { el, request, live } = await mount();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=labour-count]")).toBeTruthy(),
    );
    const original = request.getMockImplementation()!;
    let refuse = true;
    request.mockImplementation(async (path, method) => {
      if (path.endsWith("/publish") && refuse) throw { code: "connection.failed" };
      return original(path, method);
    });
    click(el.shadowRoot!, "[data-test=publish-week]");
    await el.updateComplete;
    const dialog = el.shadowRoot!.querySelector<LitElement & { error: string; open: boolean }>(
      "rota-publish-dialog",
    )!;
    await dialog.updateComplete;
    click(dialog.shadowRoot!, "[data-test=publish]");
    await vi.waitFor(() => expect(dialog.error).toContain("Could not publish"));
    live.invalidate([{ type: "shifts" }]);
    await vi.waitFor(() =>
      expect(request.mock.calls.filter(([p]) => p.includes("/rota?")).length).toBeGreaterThan(1),
    );
    expect(dialog.error).toContain("Could not publish");
    expect(dialog.open).toBe(true);
    refuse = false;
    click(dialog.shadowRoot!, "[data-test=publish]");
    await vi.waitFor(() => expect(el.shadowRoot!.textContent).toContain("Published"));
  });
  it("keeps a change-week refusal for retry", async () => {
    const { el, request, setPublished } = await mount();
    setPublished();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=change-week]")).toBeTruthy(),
    );
    const original = request.getMockImplementation()!;
    let refuse = true;
    request.mockImplementation(async (path, method) => {
      if (path.endsWith("/change-week") && refuse) throw { code: "connection.failed" };
      return original(path, method);
    });
    click(el.shadowRoot!, "[data-test=change-week]");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("Could not change this week"),
    );
    refuse = false;
    click(el.shadowRoot!, "[data-test=change-week]");
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=publish-week]")).toBeTruthy(),
    );
  });
  it("distinguishes a failed warning read from missing rules and recovers on a rules change", async () => {
    const { el, request, live } = await mount();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=labour-count]")).toBeTruthy(),
    );
    const original = request.getMockImplementation()!;
    let refuse = true;
    request.mockImplementation(async (path, method) => {
      if (path.includes("/roster/breaches?") && refuse) throw { code: "connection.failed" };
      return original(path, method);
    });
    live.invalidate([{ type: "work_time_rules" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).toContain("Could not load labour warnings"),
    );
    expect(el.shadowRoot!.textContent).not.toContain("No labour rules to check against");
    expect(
      (
        el.shadowRoot!.querySelector(
          "[data-test=publish-week]",
        )! as HTMLElementTagNameMap["wt-button"]
      ).disabled,
    ).toBe(true);
    refuse = false;
    live.invalidate([{ type: "work_time_rules" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.textContent).not.toContain("Could not load labour warnings"),
    );
    expect(el.shadowRoot!.querySelector("[data-test=labour-count]")!.textContent).toContain(
      "1 labour warning",
    );
  });
});

it("draws a daily warning on that person's cards on that date in the area, and the bar counts the weekly one", async () => {
  const { el, setBreaches, live } = await mount();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=labour-count]")).toBeTruthy(),
  );
  setBreaches([
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
  ]);
  live.invalidate([{ type: "shifts" }]);
  const grid = () => el.shadowRoot!.querySelector("rota-by-area")!.shadowRoot!;
  await vi.waitFor(() =>
    expect(grid().querySelector("[data-slot=filled]")!.textContent).toContain(
      "2026-12-01: 10 h planned; daily maximum 9 h",
    ),
  );
  expect(el.shadowRoot!.querySelector("[data-test=labour-count]")!.textContent).toContain(
    "2 labour warnings",
  );
  el.params = { area: "everyone" };
  await vi.waitFor(() =>
    expect(
      el
        .shadowRoot!.querySelector("rota-by-person")
        ?.shadowRoot?.querySelector("[data-person=joan] th")?.textContent,
    ).toContain("weekly maximum 40 h"),
  );
});

it("reads the warnings once per live rota change", async () => {
  const { el, request, live } = await mount();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("[data-test=labour-count]")).toBeTruthy(),
  );
  request.mockClear();
  live.invalidate([{ type: "shifts" }]);
  await vi.waitFor(() =>
    expect(
      request.mock.calls.filter(([path]) => path.includes("/roster/breaches?")).length,
    ).toBeGreaterThan(0),
  );
  await el.updateComplete;
  await Promise.resolve();
  expect(request.mock.calls.filter(([path]) => path.includes("/roster/breaches?"))).toHaveLength(1);
});

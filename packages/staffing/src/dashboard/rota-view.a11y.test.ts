import type { RosterBreach, WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import { rotaApi, rotaWeek } from "../testing/rota-fixture.js";
import { RotaView } from "./rota-view.js";

const breach: RosterBreach = {
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
afterEach(() => {
  cleanup();
  setLocale("en");
});
describe.each(["light", "dark"] as const)("Rota accessibility (%s)", (theme) => {
  test.each([
    "draft",
    "published",
    "empty",
    "everyone",
    "loading",
    "error",
    "picker",
    "no-version",
    "changing",
    "all-filled",
    "published-all-filled",
    "no-rules",
    "labour-count",
  ])("%s", async (state) => {
    setLocale("en");
    await mountThemed("<div></div>", theme);
    const client = rotaApi(async (week) => {
      if (state === "loading") return new Promise(() => undefined);
      if (state === "error") throw { code: "connection.failed" };
      const read = rotaWeek(week);
      if (state === "empty") read.areas = [];
      if (state === "published" || state === "published-all-filled")
        read.version = { id: "published", status: "published", changedSincePublished: false };
      if (state === "changing")
        read.version = changing
          ? { id: "draft", status: "draft", changedSincePublished: true }
          : { id: "published", status: "published", changedSincePublished: false };
      if (state === "no-version") {
        read.version = null;
        read.shifts = [];
        for (const day of read.days) {
          day.notInSlot = [];
          for (const a of day.areas) a.match = { slots: [], over: [] };
        }
      }
      if (state === "all-filled" || state === "published-all-filled")
        for (const day of read.days)
          for (const a of day.areas) {
            a.match.over = [];
            for (const s of a.match.slots)
              s.status = { kind: "filled", shiftId: "filled", outsideRole: false };
          }
      return read;
    });
    let changing = false;
    const original = client.request.getMockImplementation()!;
    client.request.mockImplementation((async (path: string, method: string, body: unknown) => {
      if (path.includes("/roster/breaches?") && state === "labour-count")
        return { breaches: [breach], ruleset };
      if (path.endsWith("/change-week"))
        return { versionId: "draft", openSwaps: [{ swapId: "s1", fromShiftId: "filled" }] };
      return original(path, method, body);
    }) as unknown as typeof original);
    const el = new RotaView();
    el.api = client.api;
    el.week = "2026-11-30";
    el.canWrite = true;
    el.open = () => undefined;
    if (state === "everyone") el.params = { area: "everyone" };
    host.append(el);
    if (state === "loading")
      await vi.waitFor(() => expect(el.shadowRoot?.textContent).toContain("Loading rota"));
    else if (state === "error")
      await vi.waitFor(() => expect(el.shadowRoot?.querySelector("[role=alert]")).toBeTruthy());
    else if (state === "empty")
      await vi.waitFor(() => {
        expect(el.shadowRoot?.textContent).toContain("No active areas");
        expect(el.shadowRoot?.querySelector("rota-by-person")).toBeTruthy();
      });
    else if (state === "everyone")
      await vi.waitFor(() => expect(el.shadowRoot?.querySelector("rota-by-person")).toBeTruthy());
    else await vi.waitFor(() => expect(el.shadowRoot?.querySelector("rota-by-area")).toBeTruthy());
    if (state === "picker") {
      const area = el.shadowRoot!.querySelector("rota-by-area")!;
      await (area as import("lit").LitElement).updateComplete;
      area.shadowRoot!.querySelector<HTMLElement>("[data-slot=empty]")!.click();
      await el.updateComplete;
      expect(el.shadowRoot!.querySelector("slot-picker")).toBeTruthy();
    }
    if (state === "no-rules")
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=no-rules]")).toBeTruthy(),
      );
    if (state === "labour-count")
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=labour-count]")).toBeTruthy(),
      );
    if (state === "all-filled" || state === "published-all-filled")
      expect(el.shadowRoot!.querySelector("[data-test=summary]")!.textContent).toContain(
        "All slots filled",
      );
    if (state === "changing") {
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=change-week]")).toBeTruthy(),
      );
      changing = true;
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=change-week]")!.click();
      await vi.waitFor(() => {
        expect(el.shadowRoot!.querySelector("[data-test=swap-notice]")).toBeTruthy();
        expect(el.shadowRoot!.querySelector("[data-test=still-published]")).toBeTruthy();
      });
    }
    await expectNoA11yViolations(host);
  });
});

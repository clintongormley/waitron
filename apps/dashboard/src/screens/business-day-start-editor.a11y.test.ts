import { afterEach, expect, it, vi } from "vitest";
import type { LitElement } from "lit";
import type { WtDialog } from "@waitron/ui";
import type {
  DashboardApi,
  BusinessDayClockModel,
  BusinessDayStartPreview,
} from "../api/client.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { venueDetailsFixture } from "../testing/venue-details-fixture.js";
import { setLocale } from "../i18n/t.js";
import "./business-day-start-editor.js";

type Editor = LitElement & { api: DashboardApi; model: BusinessDayClockModel; readOnly: boolean };

const model = (
  cutoverChanges: BusinessDayClockModel["clock"]["cutoverChanges"] = [],
  startsAt = "",
): BusinessDayClockModel => ({
  clock: { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges },
  revision: 4,
  currentBusinessDay: "2026-10-20",
  pending: cutoverChanges[0] ? { ...cutoverChanges[0], startsAt } : null,
});
const clash = (weekday: number, endsAt: string) => ({
  departmentId: "d",
  departmentName: "Restaurant",
  weekday,
  seasonId: "all",
  seasonName: "All year",
  periodId: "p",
  periodName: "Dinner",
  startsAt: "21:00",
  endsAt,
  rangeIndex: 0,
  reason: "range" as const,
});
const preview = (conflicts: BusinessDayStartPreview["conflicts"]): BusinessDayStartPreview => ({
  revision: 4,
  previousDay: {
    businessDay: "2026-10-20",
    dayCutover: "05:00",
    startAt: "2026-10-20T03:00:00.000Z",
    endAt: "2026-10-21T01:00:00.000Z",
  },
  effectiveDay: {
    businessDay: "2026-10-21",
    dayCutover: "03:00",
    startAt: "2026-10-21T01:00:00.000Z",
    endAt: "2026-10-22T01:00:00.000Z",
  },
  conflicts,
  conflictCount: conflicts.length,
  backupDeadlines: { archive: null, cloud: null },
});

const states = {
  "card, nothing waiting": { model: model(), conflicts: null },
  "card, one waiting change": {
    model: model(
      [{ effectiveBusinessDay: "2026-10-21", dayCutover: "03:00" }],
      "2026-10-21T01:00:00.000Z",
    ),
    conflicts: null,
  },
  "card, two waiting changes": {
    model: model(
      [
        { effectiveBusinessDay: "2026-10-21", dayCutover: "21:00" },
        { effectiveBusinessDay: "2026-10-22", dayCutover: "10:00" },
      ],
      "2026-10-21T19:00:00.000Z",
    ),
    conflicts: null,
  },
  "dialog, ready preview": { model: model(), conflicts: [] },
  "dialog, clashes": { model: model(), conflicts: [clash(5, "04:00"), clash(6, "04:30")] },
} as const;

const cases = (["light", "dark"] as const).flatMap((theme) =>
  ["en-GB", "es-ES"].flatMap((locale) =>
    (Object.keys(states) as (keyof typeof states)[]).map((state) => ({ theme, locale, state })),
  ),
);

afterEach(() => {
  cleanupWidgets();
  setLocale("es-ES");
});

it.each(cases)(
  "the Business-day editor has no accessibility violations: $state, $locale, $theme",
  async ({ theme, locale, state }) => {
    setLocale(locale);
    const { model: clockModel, conflicts } = states[state];
    const api = {
      liveData: { invalidate: vi.fn() },
      previewBusinessDayStart: vi.fn(async () => preview(conflicts ? [...conflicts] : [])),
      putBusinessDayStart: vi.fn(async () => ({ changed: true, model: venueDetailsFixture() })),
    } as unknown as DashboardApi;
    const { el, host } = await mountWidget<Editor>(
      "dashboard-business-day-start-editor",
      { api, model: clockModel, readOnly: false },
      theme,
    );
    await el.updateComplete;
    const waiting = clockModel.clock.cutoverChanges.length;
    expect(el.shadowRoot!.querySelectorAll("[data-test=saved-new-start]")).toHaveLength(waiting);
    if (conflicts !== null) {
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=change]")!.click();
      await el.updateComplete;
      el.shadowRoot!.querySelector("[name=dayCutover]")!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "03:00" }, bubbles: true, composed: true }),
      );
      await expect.poll(() => el.shadowRoot!.querySelector("[data-test=preview]")).toBeTruthy();
      expect(el.shadowRoot!.querySelectorAll("[data-test=conflict-rows] li")).toHaveLength(
        conflicts.length,
      );
      if (conflicts.length) {
        const probe = document.createElement("span");
        probe.style.color = "var(--wt-color-primary-text)";
        host.append(probe);
        const link = el.shadowRoot!.querySelector("[data-test=conflicts] a")!;
        expect(getComputedStyle(link).color).toBe(getComputedStyle(probe).color);
        probe.remove();
      }
      const dialog = el.shadowRoot!.querySelector<WtDialog>("wt-dialog")!;
      await dialog.updateComplete;
      expect(dialog.shadowRoot!.querySelector("dialog")!.matches(":modal")).toBe(true);
    }
    await expectNoA11yViolations(host);
  },
);

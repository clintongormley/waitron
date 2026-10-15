import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { hoursView, hoursWithPending } from "../../test/hours-fixtures.js";
import type { MyHoursPanel } from "./my-hours-panel.js";
import "./my-hours-panel.js";
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("own Hours panel in%s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "empty/loading/refused/open/break/automatic/pending/frozen/disputed in%s",
    async (language) => {
      setLocale(language);
      for (const state of [
        "empty",
        "loading",
        "refused",
        "open",
        "break",
        "automatic",
        "pending",
        "frozen",
        "disputed",
      ]) {
        const view = state === "pending" || state === "disputed" ? hoursWithPending() : hoursView();
        view.selection = { kind: "week" };
        if (state === "empty") {
          view.days = [];
          view.record.entries = [];
          view.workedMinutes = 0;
          view.pending = { prompts: [], items: [], automaticEntryIds: [] };
        }
        if (state === "disputed") view.pending.items[0]!.status = "disputed";
        if (state === "open" || state === "break")
          view.openShifts = [
            {
              start: { ...view.record.entries[0]!.entry, entryKind: "in" },
              breakStart:
                state === "break"
                  ? { ...view.record.entries[0]!.entry, entryKind: "break_start" }
                  : null,
            },
          ];
        if (state === "frozen") {
          view.closures = [
            {
              closureId: "frozen",
              period: { start: "2026-01-01", end: "2026-02-01" },
              clock: view.clock,
              scheduledCloseAt: "2026-02-01T04:00Z",
              closedAt: "2026-02-01T04:00Z",
              closureHash: "stored",
              frozenWorkedMinutes: 480,
            },
          ];
          view.record.closedPeriodImpacts = [
            {
              closureId: "frozen",
              personId: "p1",
              beforeWorkedMinutes: 480,
              afterWorkedMinutes: 540,
              deltaWorkedMinutes: 60,
            },
          ];
        }
        let release!: () => void;
        const waiting = new Promise<void>((resolve) => {
          release = resolve;
        });
        const request: DashboardRequest = async <T>(url: string) => {
          if (state === "loading") await waiting;
          if (state === "refused") throw { status: 403, code: "permission.denied" };
          return (
            url.endsWith("/inbox")
              ? {
                  personId: "p1",
                  revision: "r",
                  locations: [{ id: "venue", name: "Deli", timeZone: "Europe/Madrid" }],
                  prompts: view.pending.prompts,
                  items: view.pending.items,
                }
              : view
          ) as T;
        };
        const { el, host } = await mountWidget<MyHoursPanel>(
          "dashboard-my-hours-panel",
          { request, personId: "p1", active: true },
          theme,
        );
        try {
          if (state === "refused")
            await vi.waitFor(() =>
              expect(el.shadowRoot!.querySelector("[data-read-error]")).not.toBeNull(),
            );
          else if (state !== "loading")
            await vi.waitFor(() =>
              expect(el.shadowRoot!.querySelector("dashboard-hours-record")?.view).not.toBeNull(),
            );
          await expectNoA11yViolations(host);
        } finally {
          host.remove();
          release();
        }
      }
    },
  );
});

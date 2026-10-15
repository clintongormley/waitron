import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { hoursView, hoursWithPending } from "../../test/hours-fixtures.js";
import type { HoursRecord } from "./hours-record.js";
import "./hours-record.js";
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("My hours in %s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "empty/loading/refused/open/automatic/pending/frozen/disputed/self-approved in%s",
    async (language) => {
      setLocale(language);
      for (const state of [
        "empty",
        "loading",
        "refused",
        "open",
        "automatic",
        "pending",
        "frozen",
        "disputed",
        "self-approved",
      ]) {
        const view = state === "pending" || state === "disputed" ? hoursWithPending() : hoursView();
        if (state === "empty") {
          view.days = [];
          view.record.entries = [];
          view.pending = { prompts: [], items: [], automaticEntryIds: [] };
          view.workedMinutes = 0;
        }
        if (state === "open")
          view.openShifts = [
            {
              start: { ...view.record.entries[0]!.entry, entryKind: "in" },
              breakStart: { ...view.record.entries[0]!.entry, entryKind: "break_start" },
            },
          ];
        if (state === "disputed") view.pending.items[0]!.status = "disputed";
        if (state === "self-approved") view.record.entries[0]!.selfApproved = true;
        if (state === "frozen") {
          view.closures = [
            {
              closureId: "closure",
              period: { start: "2026-01-01", end: "2026-02-01" },
              clock: view.clock,
              scheduledCloseAt: "2026-02-01T04:00:00Z",
              closedAt: "2026-02-01T04:00:00Z",
              closureHash: "stored",
              frozenWorkedMinutes: 480,
            },
          ];
          view.record.closedPeriodImpacts = [
            {
              closureId: "closure",
              personId: "p1",
              beforeWorkedMinutes: 480,
              afterWorkedMinutes: 540,
              deltaWorkedMinutes: 60,
            },
          ];
        }
        const { el, host } = await mountWidget<HoursRecord>(
          "dashboard-hours-record",
          {
            view,
          },
          theme,
        );
        expect(el.shadowRoot!.querySelector("[data-total]")).not.toBeNull();
        await expectNoA11yViolations(host);
        host.remove();
      }
    },
  );
});

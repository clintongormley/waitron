import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { attendanceEntry } from "../../test/attendance-fixtures.js";
import {
  click,
  deferred,
  managerHours,
  mountManagerHours,
  openDay,
  record,
} from "../../test/manager-hours-fixtures.js";
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("manager Hours accessibility in %s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "empty/loading/refused/open/automatic/pending/frozen/proposal in %s",
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
        "proposal",
      ]) {
        const waiting = deferred<ReturnType<typeof managerHours>>();
        const m = await mountManagerHours({
          theme,
          live: true,
          fail: state === "refused",
          ...(state === "loading" ? { held: waiting.promise } : {}),
        });
        try {
          if (state === "refused")
            await expect.poll(() => m.root.querySelector("[data-read-error]")).toBeTruthy();
          else if (state !== "loading") {
            await record(m.root);
            const hours = m.data.hours.people[0]!.hours;
            if (state === "empty") m.data.hours.people = [];
            if (state === "open")
              hours.openShifts = [
                {
                  start: attendanceEntry({ entryKind: "in" }),
                  breakStart: attendanceEntry({ entryKind: "break_start" }),
                },
              ];
            if (state === "pending")
              hours.pending.items = ["waiting-manager", "waiting-worker", "disputed"].map(
                (status) => ({
                  ...hours.pending.items[0]!,
                  id: status,
                  status: status as "waiting-manager" | "waiting-worker" | "disputed",
                  direction: status === "waiting-manager" ? "worker_request" : "manager_proposal",
                }),
              );
            if (state === "frozen") {
              hours.record.entries[0]!.selfApproved = true;
              hours.closures = [
                {
                  closureId: "closed",
                  period: hours.period,
                  clock: hours.clock,
                  scheduledCloseAt: "2026-02-01T04:00:00Z",
                  closedAt: "2026-02-01T04:00:00Z",
                  closureHash: "hash",
                  frozenWorkedMinutes: 480,
                },
              ];
              hours.record.closedPeriodImpacts = [
                {
                  closureId: "closed",
                  personId: "worker",
                  beforeWorkedMinutes: 480,
                  afterWorkedMinutes: 540,
                  deltaWorkedMinutes: 60,
                },
              ];
            }
            if (state === "proposal") {
              await openDay(m.root);
              await click(m.root, "[data-add-shift]");
              const editor = m.root.querySelector("dashboard-attendance-proposal-dialog")!;
              await editor.updateComplete;
              await editor.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
              expect(editor.open).toBe(true);
            } else {
              const count = m.reads.length;
              m.liveData!.invalidate([{ type: "time_entries" }]);
              await expect.poll(() => m.reads.length).toBeGreaterThan(count);
              await m.el.updateComplete;
            }
          }
          await expectNoA11yViolations(m.host);
        } finally {
          waiting.resolve(managerHours());
          m.host.remove();
        }
      }
    },
  );
});

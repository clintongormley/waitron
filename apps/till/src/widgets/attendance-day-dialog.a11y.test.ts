import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { attendanceEntry, attendanceItem } from "../../test/attendance-fixtures.js";
import type { AttendanceDayView } from "../api/client.js";
import type { AttendanceDayDialog } from "./attendance-day-dialog.js";
import "./attendance-day-dialog.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("chosen attendance day in %s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "effective, empty, pending, disputed, loading and refused in %s",
    async (language) => {
      const locale = currentLocale();
      setLocale(language);
      try {
        for (const state of [
          "effective",
          "empty",
          "pending",
          "disputed",
          "loading",
          "refused",
        ] as const) {
          const view: AttendanceDayView = {
            personId: "worker",
            locationId: "deli",
            date: "2026-10-14",
            timeZone: "Europe/Madrid",
            revision: "revision",
            record: {
              sessions: [],
              closures: [],
              closedPeriodImpacts: [],
              entries:
                state === "effective"
                  ? [
                      {
                        entry: attendanceEntry(),
                        author: { kind: "automatic", personId: null },
                        effective: true,
                        confirmed: true,
                        confirmedByWorker: true,
                        selfApproved: false,
                        corrected: false,
                        disputed: false,
                        closedPeriodIds: [],
                      },
                    ]
                  : [],
            },
            items:
              state === "pending"
                ? [attendanceItem({ direction: "worker_request", status: "waiting-manager" })]
                : state === "disputed"
                  ? [attendanceItem({ status: "disputed" })]
                  : [],
          };
          const { el, host } = await mountWidget<AttendanceDayDialog>(
            "till-attendance-day-dialog",
            {
              open: true,
              view: state === "loading" || state === "refused" ? null : view,
              date: view.date,
              locationId: "deli",
              locations: [{ id: "deli", name: "The deli", timeZone: "Europe/Madrid" }],
              reading: state === "loading",
              error: state === "refused" ? "Hours could not be read" : "",
            },
            theme,
          );
          await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
          expect(el.shadowRoot!.querySelector("[data-close]")).not.toBeNull();
          await expectNoA11yViolations(host);
          host.remove();
        }
      } finally {
        setLocale(locale);
      }
    },
  );
});

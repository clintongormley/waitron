import { afterEach, describe, expect, it } from "vitest";
import { createRequest } from "@waitron/dashboard-kit";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import { AttendanceCorrectionsScreen } from "./attendance-corrections-screen.js";

afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("attendance queue in %s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "empty, loading, refused and missing-time proposal in %s",
    async (language) => {
      const locale = currentLocale();
      setLocale(language);
      try {
        for (const state of ["empty", "loading", "refused", "proposal"]) {
          let release!: () => void;
          const waiting = new Promise<void>((resolve) => {
            release = resolve;
          });
          const request = createRequest({
            fetchImpl: async (path) => {
              if (state === "loading") await waiting;
              if (state === "refused")
                return Response.json({ error: { code: "permission.denied" } }, { status: 403 });
              if (path.endsWith("/lookups"))
                return Response.json({
                  viewer: { personId: "manager", canSelfApprove: false },
                  locations: [{ id: "shop", name: "Deli", timeZone: "Europe/Madrid" }],
                  people: [{ personId: "worker", displayName: "Ana Worker" }],
                });
              if (path.includes("/queue?")) return Response.json({ locationId: "shop", items: [] });
              return Response.json({
                personId: "worker",
                locationId: "shop",
                date: "2026-10-14",
                timeZone: "Europe/Madrid",
                revision: "revision",
                items: [],
                record: { entries: [], sessions: [], closures: [], closedPeriodImpacts: [] },
              });
            },
          });
          const { el, host } = await mountWidget<AttendanceCorrectionsScreen>(
            "dashboard-attendance-corrections-screen",
            { request },
            theme,
          );
          try {
            if (state === "refused")
              await expect
                .poll(() => el.shadowRoot!.querySelector("[data-read-error]"))
                .not.toBeNull();
            else if (state !== "loading")
              await expect
                .poll(
                  () =>
                    el.shadowRoot!.querySelector<HTMLElement & { options: unknown[] }>(
                      "[name=attendancePerson]",
                    )!.options.length,
                )
                .toBe(1);
            if (state === "proposal") {
              el.shadowRoot!.querySelector("[name=attendanceDay]")!.dispatchEvent(
                new CustomEvent("wt-change", { detail: { value: "2026-10-14" } }),
              );
              await el.updateComplete;
              el.shadowRoot!.querySelector<HTMLElement>("[data-open-day]")!.click();
              await expect
                .poll(() => el.shadowRoot!.querySelector("[data-add-shift]"))
                .not.toBeNull();
              el.shadowRoot!.querySelector<HTMLElement>("[data-add-shift]")!.click();
              await el.updateComplete;
              const editor = el.shadowRoot!.querySelector("dashboard-attendance-proposal-dialog")!;
              await editor.updateComplete;
              await editor.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
              expect(editor.open).toBe(true);
            }
            await expectNoA11yViolations(host);
          } finally {
            release();
            host.remove();
          }
        }
      } finally {
        setLocale(locale);
      }
    },
  );
});

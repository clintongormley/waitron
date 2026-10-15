import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import type { AttendanceProposalDialog } from "./attendance-proposal-dialog.js";
import "./attendance-proposal-dialog.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("attendance correction in %s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "original, missing pair, disagreement, busy and refused in %s",
    async (language) => {
      const locale = currentLocale();
      setLocale(language);
      try {
        for (const props of [
          {
            initialChanges: [
              {
                target: { entryId: "original" },
                at: "2026-10-25T00:30:00.000Z",
                offsetMinutes: 120,
              },
            ],
          },
          {
            initialChanges: [
              { target: { missingKind: "in" as const }, at: "", offsetMinutes: 0 },
              { target: { missingKind: "out" as const }, at: "", offsetMinutes: 0 },
            ],
          },
          { reasonOnly: true, initialChanges: [] },
          { recovery: "uncertain" as const, blocked: true, initialChanges: [] },
          { recovery: "retry" as const, blocked: true, initialChanges: [] },
          {
            busy: true,
            initialChanges: [{ target: { missingKind: "in" as const }, at: "", offsetMinutes: 0 }],
          },
          {
            error: "The record changed. Read it again.",
            initialChanges: [
              {
                target: { entryId: "original" },
                at: "2026-10-13T15:00:00.000Z",
                offsetMinutes: 120,
              },
            ],
          },
        ]) {
          const { el, host } = await mountWidget<AttendanceProposalDialog>(
            "dashboard-attendance-proposal-dialog",
            { open: true, timeZone: "Europe/Madrid", ...props },
            theme,
          );
          await el.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
          expect(el.shadowRoot!.querySelector("wt-textarea")).not.toBeNull();
          await expectNoA11yViolations(host);
          host.remove();
        }
      } finally {
        setLocale(locale);
      }
    },
  );
});

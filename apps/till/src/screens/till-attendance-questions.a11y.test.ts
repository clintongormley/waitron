import { afterEach, describe, expect, it } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import { currentLocale, setLocale } from "../i18n/t.js";
import {
  attendanceInbox,
  attendanceItem,
  attendancePrompt,
} from "../../test/attendance-fixtures.js";
import type { TillAttendanceQuestions } from "./till-attendance-questions.js";
import "./till-attendance-questions.js";
afterEach(cleanupWidgets);
describe.each(["light", "dark"] as const)("attendance questions in %s", (theme) => {
  it.each(["en-GB", "es-ES"])(
    "automatic, missing, proposal, blocked, loading and refused in %s",
    async (language) => {
      const locale = currentLocale();
      setLocale(language);
      try {
        const item = attendanceItem();
        const proposal = attendancePrompt({
          kind: "proposal",
          itemId: item.id,
          history: item.history,
        });
        for (const props of [
          { inbox: attendanceInbox() },
          {
            inbox: attendanceInbox([
              attendancePrompt({ kind: "missing-times", history: [], missingKinds: ["in", "out"] }),
            ]),
          },
          { inbox: attendanceInbox([proposal], [item]) },
          { inbox: attendanceInbox([proposal], [{ ...item, readyToApply: false }]) },
          { inbox: attendanceInbox([proposal], [{ ...item, status: "overtaken" as const }]) },
          { inbox: null, reading: true },
          { inbox: null, error: "Hours could not be read" },
          { inbox: attendanceInbox(), busy: true },
        ]) {
          const { el, host } = await mountWidget<TillAttendanceQuestions>(
            "till-attendance-questions",
            props,
            theme,
          );
          expect(el.shadowRoot!.querySelector("h1")).not.toBeNull();
          await expectNoA11yViolations(host);
          host.remove();
        }
      } finally {
        setLocale(locale);
      }
    },
  );
});

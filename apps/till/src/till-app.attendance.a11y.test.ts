import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanupWidgets, expectNoA11yViolations } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
import { clockApp, signIn } from "../test/clock-app.js";
import { attendanceInbox, attendanceItem, attendancePrompt } from "../test/attendance-fixtures.js";
const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  localStorage.clear();
  setLocale(locale);
});
describe.each(["light", "dark"] as const)("real attendance flow accessibility in %s", (theme) => {
  it.each([
    ["en-GB", 390],
    ["es-ES", 390],
    ["en-GB", 1280],
    ["es-ES", 1280],
  ] as const)("questions and correction editor in %s at %s", async (language, width) => {
    const oldWidth = innerWidth,
      oldHeight = innerHeight;
    await page.viewport(width, 844);
    try {
      const f = await clockApp({ theme });
      f.api.login.mockResolvedValueOnce({ personId: "p1", permissions: [], locale: language });
      const proposal = attendanceItem({ personId: "p1", locationId: "venue" });
      f.api.getAttendanceInbox.mockResolvedValue({
        ...attendanceInbox(
          [
            attendancePrompt({ personId: "p1", locationId: "venue", timeZone: "Europe/Madrid" }),
            attendancePrompt({
              id: "missing",
              questionId: "missing",
              personId: "p1",
              locationId: "venue",
              timeZone: "Europe/Madrid",
              kind: "missing-times",
              history: [],
              missingKinds: ["in", "out"],
            }),
            attendancePrompt({
              id: "proposal",
              questionId: null,
              itemId: proposal.id,
              personId: "p1",
              locationId: "venue",
              timeZone: "Europe/Madrid",
              kind: "proposal",
              history: proposal.history,
            }),
          ],
          [proposal],
        ),
        personId: "p1",
        locations: [{ id: "venue", name: "Clock venue", timeZone: "Europe/Madrid" }],
      });
      await signIn(f.el);
      await vi.waitFor(() =>
        expect(
          f.el.shadowRoot!.querySelector("till-attendance-questions")?.inbox?.prompts.length,
        ).toBe(3),
      );
      const questions = f.el.shadowRoot!.querySelector("till-attendance-questions")!;
      expect(innerWidth).toBe(width);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(f.host);
      await userEvent.click(questions.shadowRoot!.querySelector<HTMLElement>("[data-edit]")!);
      const editor = f.el.shadowRoot!.querySelector("till-attendance-correction-dialog")!;
      await editor.updateComplete;
      await editor.shadowRoot!.querySelector("wt-dialog")!.updateComplete;
      expect(editor.open).toBe(true);
      expect(editor.getBoundingClientRect().width).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(f.host);
    } finally {
      await page.viewport(oldWidth, oldHeight);
    }
  });
});

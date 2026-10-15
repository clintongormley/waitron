import { describe, expect, it } from "vitest";
import { catalogues } from "./strings.js";
import { codeMessage } from "./codes.js";

describe("attendance wording", () => {
  it.each([
    ["en-GB", /count/i, /confirm.*worker/i, /unconfirmed/i],
    ["es-ES", /cuenta/i, /confirmad.*trabajador/i, /sin confirmar|no confirmad/i],
  ])(
    "%s distinguishes counted automatic time from worker acknowledgment",
    (locale, counted, acknowledged, misleading) => {
      const copy = catalogues[locale]!;
      expect(copy["attendance.automatic_counted"]).toMatch(counted);
      expect(copy["attendance.confirmed_by_worker"]).toMatch(acknowledged);
      expect(copy["attendance.automatic_counted"]).not.toMatch(misleading);
    },
  );

  it.each(["en-GB", "es-ES"])(
    "%s gives each response state and recoverable failure its own wording",
    (locale) => {
      const keys = [
        "attendance.waiting_manager",
        "attendance.waiting_worker",
        "attendance.self_approved",
        "attendance.disputed",
        "attendance.uncertain",
        "attendance.overtaken",
      ] as const;
      const values = keys.map((key) => catalogues[locale]![key]);
      expect(new Set(values).size).toBe(keys.length);
      for (const value of values) expect(value).toBeTypeOf("string");
      for (const code of [
        "attendance.read_failed",
        "attendance.write_failed",
        "attendance.not_pending",
        "correction.not_pending",
        "correction.not_permitted",
        "correction.target_not_found",
      ]) {
        const message = codeMessage(code, locale);
        expect(message).not.toBe(codeMessage("unknown-code", locale));
        expect(message).not.toContain(code);
      }
    },
  );
});

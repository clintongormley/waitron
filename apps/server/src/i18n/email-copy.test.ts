import { describe, expect, it } from "vitest";
import { ACCOUNT_EMAIL_WORDS } from "./account-email.js";
import { ATTENDANCE_EMAIL_WORDS } from "./attendance-email.js";

describe("account email wording", () => {
  it.each([
    [
      "en",
      "Hello Ann,",
      "This single-use link expires at tomorrow.",
      "Enter 123456 in your Waitron profile. This code expires at tomorrow.",
      "Use this link to",
    ],
    [
      "es",
      "Hola Ann,",
      "Este enlace de un solo uso caduca el tomorrow.",
      "Introduce 123456 en tu perfil de Waitron. Este código caduca el tomorrow.",
      "Usa este enlace para",
    ],
  ] as const)(
    "keeps the %s greeting and expiry instructions",
    (language, hello, expiry, code, useLink) => {
      const words = ACCOUNT_EMAIL_WORDS[language];
      expect(words.hello("Ann")).toBe(hello);
      expect(words.expires("tomorrow")).toBe(expiry);
      expect(words.emailChangeCode("123456", "tomorrow")).toBe(code);
      expect(words.useLink).toBe(useLink);
    },
  );
});

describe("attendance email wording", () => {
  it.each([
    [
      "en",
      "clock in",
      "clock out",
      "clock in or out",
      "Missing clock times: 2026-01-05",
      "On 2026-01-05 at Harbour, you did not clock out. Fix your hours at your next clock-in.",
    ],
    [
      "es",
      "fichar la entrada",
      "fichar la salida",
      "fichar la entrada o la salida",
      "Fichajes pendientes: 2026-01-05",
      "El 2026-01-05, en Harbour, faltó fichar la salida. Corrige las horas en tu próximo fichaje de entrada.",
    ],
  ] as const)(
    "keeps the %s missing-clock instructions",
    (language, clockIn, clockOut, both, subject, text) => {
      const words = ATTENDANCE_EMAIL_WORDS[language];
      expect(words.missingIn).toBe(clockIn);
      expect(words.missingOut).toBe(clockOut);
      expect(words.missingBoth).toBe(both);
      expect(words.subject("2026-01-05")).toBe(subject);
      expect(words.text("2026-01-05", "Harbour", clockOut)).toBe(text);
    },
  );
});

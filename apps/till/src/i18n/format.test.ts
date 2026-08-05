import { expect, it } from "vitest";
import { formatMoney } from "./format.js";

// es-ES currency formatting puts a NON-BREAKING SPACE (U+00A0) — and on some ICU
// builds a NARROW NO-BREAK SPACE (U+202F) — between the amount and the €. The
// exact separator is an ICU-version detail we do not want to pin, so normalise
// both to a plain ASCII space before asserting the human-readable form. The raw
// byte sequence is recorded in the task report.
const norm = (s: string): string => s.replace(/[\u00A0\u202F]/g, " ");

it("formats a Decimal string as es-ES currency", () => {
  expect(norm(formatMoney("12.27", "es-ES"))).toBe("12,27 €");
  expect(norm(formatMoney("1500.00", "es-ES"))).toBe("1500,00 €");
});

it("formats the English base as €12.27", () => {
  // en-locale currency puts € first with no separating space, so normalisation
  // is a no-op here and the assertion pins the exact string.
  expect(formatMoney("12.27", "en")).toBe("€12.27");
});

it("defaults to es-ES when no locale is passed", () => {
  expect(norm(formatMoney("12.27"))).toBe("12,27 €");
});

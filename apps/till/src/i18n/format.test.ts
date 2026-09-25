import { afterEach, expect, it } from "vitest";
import { formatMoney } from "./format.js";
import { setLocale } from "./t.js";

afterEach(() => {
  // t.ts's locale is module-level, so a setLocale in one test would leak into the next.
  setLocale("en-GB");
});

// The es-ES separator before the € is U+00A0 or U+202F depending on the ICU build, so it is
// normalised rather than pinned.
const norm = (s: string): string => s.replace(/[\u00A0\u202F]/g, " ");

it("formats a Decimal string as es-ES currency", () => {
  expect(norm(formatMoney("12.27", "es-ES"))).toBe("12,27 €");
  expect(norm(formatMoney("1500.00", "es-ES"))).toBe("1500,00 €");
});

it("formats the English base as €12.27", () => {
  expect(formatMoney("12.27", "en")).toBe("€12.27");
});

it("follows the active UI locale when no locale is passed", () => {
  setLocale("en-GB");
  expect(formatMoney("12.27")).toBe("€12.27");
  setLocale("es-ES");
  expect(norm(formatMoney("12.27"))).toBe("12,27 €");
});

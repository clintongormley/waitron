import { expect, it } from "vitest";
import { codeMessage } from "./codes.js";
import { en, es } from "./strings.js";
for (const [code, key] of [
  ["allergy.unanswered", "allergy.unanswered"],
  ["allergy.out_of_date", "allergy.stale"],
  ["allergy.invalid", "allergy.invalid"],
] as const) {
  it(`explains ${code} in both languages instead of the generic error`, () => {
    expect(codeMessage(code, "en-GB")).toBe(en[key]);
    expect(codeMessage(code, "es-ES")).toBe(es[key]);
    expect(codeMessage(code, "en-GB")).not.toBe(codeMessage("server.internal", "en-GB"));
  });
}

import { afterEach, expect, it } from "vitest";
import { codeMessage } from "./codes.js";
import { setLocale } from "./t.js";

afterEach(() => setLocale("en-GB"));

it.each([
  ["en", "Fingerprint check failed; ask a manager."],
  ["en-GB", "Fingerprint check failed; ask a manager."],
  ["es", "Ha fallado la comprobación de la huella; avisa a un responsable."],
  ["es-ES", "Ha fallado la comprobación de la huella; avisa a un responsable."],
])("explains a fingerprint refusal in %s without exposing context", (locale, sentence) => {
  expect(codeMessage("fiscal.fingerprint_mismatch", locale)).toBe(sentence);
  expect(codeMessage("unknown.fingerprint_test", locale)).not.toBe(sentence);
  expect(codeMessage("unknown.fingerprint_test", locale)).not.toContain("unknown.");
});

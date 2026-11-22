import { expect, it } from "vitest";
import { CONFLICT_RECOVERY_STRINGS } from "./conflict-recovery-strings.js";
import { AEAT_CERTIFICATE_CODE_MESSAGES, AEAT_CERTIFICATE_STRINGS } from "./strings.js";

// The Waitron machine is "the box" in English and "el servidor" in Spanish (owner, 2026-11-22).
// A placeholder name is code, not words.
const OTHER_SERVERS = /\btime servers?\b|\bServers\b|\{server\}/g;

it("calls the Waitron machine the box in English and never el equipo in Spanish", () => {
  const english = [
    ...Object.entries(AEAT_CERTIFICATE_STRINGS.en),
    ...Object.entries(CONFLICT_RECOVERY_STRINGS.en),
    ...Object.entries(AEAT_CERTIFICATE_CODE_MESSAGES).map(([code, words]) => [code, words.en]),
  ];
  const spanish = [
    ...Object.entries(AEAT_CERTIFICATE_STRINGS.es),
    ...Object.entries(CONFLICT_RECOVERY_STRINGS.es),
    ...Object.entries(AEAT_CERTIFICATE_CODE_MESSAGES).map(([code, words]) => [code, words.es]),
  ];
  expect(
    english.filter(([, text]) => /\bservers?\b/i.test(text!.replace(OTHER_SERVERS, ""))),
  ).toEqual([]);
  expect(spanish.filter(([, text]) => /\bequipos?\b/i.test(text!))).toEqual([]);
});

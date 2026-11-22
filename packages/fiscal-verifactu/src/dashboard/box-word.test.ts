import { expect, it } from "vitest";
import { CONFLICT_RECOVERY_STRINGS } from "./conflict-recovery-strings.js";
import { EXPORT_GUIDE_STRINGS } from "./export-guides.js";
import { AEAT_CERTIFICATE_CODE_MESSAGES, AEAT_CERTIFICATE_STRINGS } from "./strings.js";

// The Waitron machine is "the box" in English and "el servidor" in Spanish (owner, 2026-11-22).
// Weaker than its name: reads only the tables below, not words written in components or in the
// recovery pack's pages. A placeholder name is code, not words.
const OTHER_SERVERS = [/\btime[- ]servers?\b/gi, /\bthe Servers page\b/g, /\{server\}/g];

function texts(locale: "en" | "es"): [string, string][] {
  return [
    ...Object.entries(AEAT_CERTIFICATE_STRINGS[locale]),
    ...Object.entries(CONFLICT_RECOVERY_STRINGS[locale]),
    ...Object.entries(AEAT_CERTIFICATE_CODE_MESSAGES).map(([code, words]): [string, string] => [
      code,
      words[locale],
    ]),
    ...Object.entries(EXPORT_GUIDE_STRINGS).map(([key, words]): [string, string] => [
      key,
      words[locale],
    ]),
  ];
}

function namesTheBoxAServer(text: string): boolean {
  return /\bservers?\b/i.test(
    OTHER_SERVERS.reduce((rest, phrase) => rest.replace(phrase, ""), text),
  );
}

it("calls the Waitron machine the box in English and never el equipo in Spanish", () => {
  expect(texts("en").filter(([, text]) => namesTheBoxAServer(text))).toEqual([]);
  expect(texts("es").filter(([, text]) => /\bequipos?\b/i.test(text))).toEqual([]);
});

it("still sees the machine named beside an allowed phrase", () => {
  expect(namesTheBoxAServer("Open Servers on the main box")).toBe(true);
  expect(namesTheBoxAServer("Ask the time server, then the Servers page on {server}")).toBe(false);
});

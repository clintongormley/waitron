import { expect, it } from "vitest";
import { MASTER_KEY_FIELD_WORDS } from "@waitron/recovery-pack/src/i18n/master-key-field.js";
import { checkVenueStrings } from "./check-venue.js";
import { clockWaitStrings } from "./clock-wait.js";
import { firstHourStrings } from "./first-hour.js";
import { promotionWords, recoveryHourStrings } from "./recovery-hour.js";
import { fiscalSetupStrings } from "./strings.js";

// The Waitron machine is "the box" in English and "servidor" in Spanish, never "equipo" (owner,
// 2026-11-22). Weaker than its name: reads only the tables below, not words written inside a
// component, the series register PDF's inline sentences, or the emergency record's printout.
const OTHER_SERVERS = [/\btime[- ]servers?\b/gi];

function collect(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") out.push([path, value]);
  else if (typeof value === "function") {
    try {
      collect((value as (...a: unknown[]) => unknown)("X", "X", "X"), `${path}()`, out);
    } catch {
      // A builder needing a real argument is not read; the header says so.
    }
  } else if (value !== null && typeof value === "object")
    for (const [key, v] of Object.entries(value)) collect(v, `${path}.${key}`, out);
}

function texts(): [string, string][] {
  const out: [string, string][] = [];
  collect(checkVenueStrings, "checkVenue", out);
  collect(clockWaitStrings, "clockWait", out);
  collect(firstHourStrings, "firstHour", out);
  collect(recoveryHourStrings, "recoveryHour", out);
  collect(promotionWords, "promotion", out);
  collect(fiscalSetupStrings, "fiscalSetup", out);
  collect(MASTER_KEY_FIELD_WORDS, "masterKeyField", out);
  for (const locale of ["en", "es"] as const)
    out.push([
      `masterKeyField.${locale}.elsewhere(null)`,
      MASTER_KEY_FIELD_WORDS[locale].elsewhere(null),
    ]);
  return out;
}

function namesTheBoxAServer(text: string): boolean {
  return /\bservers?\b/i.test(
    OTHER_SERVERS.reduce((rest, phrase) => rest.replace(phrase, ""), text),
  );
}

it("reads every table", () => {
  const paths = texts().map(([path]) => path);
  for (const expected of [
    "checkVenue.en.blocked",
    "clockWait.en.theServer",
    "firstHour.en.packLead",
    "recoveryHour.en.heading",
    "promotion.emergency.en.secondClockDo",
    "masterKeyField.es.elsewhere()",
  ])
    expect(paths).toContain(expected);
});

it("calls the Waitron machine the box in English and never equipo in Spanish", () => {
  expect(texts().filter(([, text]) => namesTheBoxAServer(text))).toEqual([]);
  expect(texts().filter(([, text]) => /\bequipos?\b/i.test(text))).toEqual([]);
});

it("still sees the machine named beside an allowed phrase", () => {
  expect(namesTheBoxAServer("Ask the time server, then the server")).toBe(true);
  expect(namesTheBoxAServer("Ask the time-servers")).toBe(false);
});

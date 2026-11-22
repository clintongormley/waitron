import { expect, it } from "vitest";
import { ALERT_MESSAGES, ALERT_WORDS } from "./alert-messages.js";
import { CODE_MESSAGES } from "./codes.js";
import { en, es } from "./strings.js";

// The Waitron machine is "the box" in English and "el servidor" in Spanish (owner, 2026-11-22).
// "Servers" with a capital and a plural is the Servers page's name, which stays.
const OTHER_SERVERS = /\b([Mm]ail|SMTP|time)[- ]servers?\b|\bServers\b/g;
const SERVER = /\bservers?\b/i;
// The mail server's settings.
const SERVER_MEANS_SOMETHING_ELSE = new Set([
  "email.settings.remove_capture",
  "email.settings.remove_live",
]);

const EQUIPO = /\bequipos?\b/i;
// Staff team, device equipment, or the computer a printer is plugged into.
const EQUIPO_MEANS_SOMETHING_ELSE = new Set([
  "nav.group.team",
  "printers.agent_host",
  "printers.address",
  "printers.host_required",
  "equipment.label",
  "equipment.label_title",
  "equipment.label_hint",
  "code:device.equipment_held",
]);

function englishTexts(): [string, string][] {
  return [
    ...Object.entries(en),
    ...Object.entries(CODE_MESSAGES).map(([code, words]): [string, string] => [
      `code:${code}`,
      words.en,
    ]),
    ...alertTexts("en"),
  ];
}

function spanishTexts(): [string, string][] {
  return [
    ...Object.entries(es),
    ...Object.entries(CODE_MESSAGES).map(([code, words]): [string, string] => [
      `code:${code}`,
      words.es,
    ]),
    ...alertTexts("es"),
  ];
}

function alertTexts(locale: "en" | "es"): [string, string][] {
  const texts: [string, string][] = [];
  for (const [code, message] of Object.entries(ALERT_MESSAGES)) {
    texts.push([`alert:${code}`, message[locale]]);
    if (message.items) texts.push([`alert:${code}.items`, message.items[locale]]);
    if (message.one) texts.push([`alert:${code}.one`, message.one[locale]]);
    for (const [name, variant] of Object.entries(message.variants ?? {}))
      texts.push([`alert:${code}.${name}`, variant[locale]]);
  }
  for (const [table, { words, otherwise }] of Object.entries(ALERT_WORDS)) {
    for (const [name, word] of Object.entries(words))
      texts.push([`alert-word:${table}.${name}`, word[locale]]);
    texts.push([`alert-word:${table}.otherwise`, otherwise[locale]]);
  }
  return texts;
}

it("calls the Waitron machine the box in English", () => {
  const offending = englishTexts()
    .filter(([key]) => !SERVER_MEANS_SOMETHING_ELSE.has(key))
    .filter(([, text]) => SERVER.test(text.replace(OTHER_SERVERS, "")))
    .map(([key, text]) => `${key}: ${text}`);
  expect(offending).toEqual([]);
});

it("calls the Waitron machine el servidor in Spanish, never el equipo", () => {
  const offending = spanishTexts()
    .filter(([key]) => !EQUIPO_MEANS_SOMETHING_ELSE.has(key))
    .filter(([, text]) => EQUIPO.test(text))
    .map(([key, text]) => `${key}: ${text}`);
  expect(offending).toEqual([]);
});

it("still sees a server named in a sentence beside the page's name", () => {
  expect(SERVER.test("Open Servers on the main server".replace(OTHER_SERVERS, ""))).toBe(true);
  expect(SERVER.test("Check the mail server and the Servers page".replace(OTHER_SERVERS, ""))).toBe(
    false,
  );
});

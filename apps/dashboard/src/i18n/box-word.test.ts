import { expect, it } from "vitest";
import { ALERT_MESSAGES, ALERT_WORDS } from "./alert-messages.js";
import { CODE_MESSAGES, SET_MENU_FIELDS } from "./codes.js";
import { diskStopMessage } from "./disk-stop-words.js";
import { en, es } from "./strings.js";

// The Waitron machine is "the box" in English and "el servidor" in Spanish (owner, 2026-11-22).
// Weaker than its name: reads only the tables below, not domain.ts's name tables, words written
// inline in codes.ts's message functions or in components, nor other packages' dashboard strings.
const OTHER_SERVERS = [/\b(mail|SMTP|time)[- ]servers?\b/gi, /\bthe Servers page\b/g];
// The page's own title, which the owner kept.
const PAGE_TITLES = new Set(["nav.servers", "servers.title"]);
const SERVER = /\bservers?\b/i;

const EQUIPO = /\bequipos?\b/i;
// Each phrase means a staff team, a piece of equipment, or the computer a printer is plugged into.
// One occurrence of each is allowed, so another "equipo" added to the entry is still seen.
const OTHER_EQUIPOS: Record<string, string[]> = {
  "nav.group.team": ["Equipo"],
  "printers.agent_host": ["Equipo"],
  "printers.address": ["Equipo"],
  "printers.host_required": ["nombre de equipo"],
  "equipment.label": ["Etiqueta del equipo"],
  "equipment.label_title": ["Etiqueta del equipo"],
  "equipment.label_hint": ["pégala en el equipo", "el equipo pasa"],
  "code:device.equipment_held": ["ese equipo"],
};

function texts(locale: "en" | "es"): [string, string][] {
  const deleted = { count: 2, date: "2026-11-01", lastDate: "2026-11-02", severalDays: false };
  return [
    ...Object.entries(locale === "en" ? en : es),
    ...Object.entries(CODE_MESSAGES).map(([code, words]): [string, string] => [
      `code:${code}`,
      words[locale],
    ]),
    ...Object.entries(SET_MENU_FIELDS).map(([field, words]): [string, string] => [
      `set-menu-field:${field}`,
      words[locale],
    ]),
    ["disk-stop:no-status", diskStopMessage(null, false, locale)],
    ["disk-stop:none-deleted", diskStopMessage(null, true, locale)],
    ["disk-stop:one-deleted", diskStopMessage({ ...deleted, count: 1 }, true, locale)],
    ["disk-stop:deleted", diskStopMessage(deleted, true, locale)],
    ["disk-stop:several-days", diskStopMessage({ ...deleted, severalDays: true }, true, locale)],
    ...alertTexts(locale),
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

function namesTheBoxAServer(key: string, text: string): boolean {
  if (PAGE_TITLES.has(key) && text === "Servers") return false;
  return SERVER.test(OTHER_SERVERS.reduce((rest, phrase) => rest.replace(phrase, ""), text));
}

function namesTheBoxEquipo(key: string, text: string): boolean {
  const phrases = OTHER_EQUIPOS[key] ?? [];
  return EQUIPO.test(phrases.reduce((rest, phrase) => rest.replace(phrase, ""), text));
}

it("reads every table, nested alert wording included", () => {
  const keys = texts("en").map(([key]) => key);
  expect(keys).toEqual(
    expect.arrayContaining([
      "servers.title",
      "code:backup.spare_stream_active",
      "set-menu-field:setPrice",
      "disk-stop:several-days",
      "alert:payment.capture_mismatch.items",
      "alert:backup.archives_deleted.one",
      "alert:backup.run_stopped.spaceLow",
      "alert-word:spare_copy_phase.upload",
    ]),
  );
});

it("calls the Waitron machine the box in English", () => {
  const offending = texts("en")
    .filter(([key, text]) => namesTheBoxAServer(key, text))
    .map(([key, text]) => `${key}: ${text}`);
  expect(offending).toEqual([]);
});

it("calls the Waitron machine el servidor in Spanish, never el equipo", () => {
  const offending = texts("es")
    .filter(([key, text]) => namesTheBoxEquipo(key, text))
    .map(([key, text]) => `${key}: ${text}`);
  expect(offending).toEqual([]);
});

it("still sees the machine named beside an allowed phrase", () => {
  expect(namesTheBoxAServer("x", "Open the Servers page on the main server")).toBe(true);
  expect(namesTheBoxAServer("x", "Open Servers on the main box")).toBe(true);
  expect(namesTheBoxAServer("x", "Check the mail server and the Servers page")).toBe(false);
  expect(namesTheBoxAServer("nav.servers", "Servers on this server")).toBe(true);
  expect(namesTheBoxEquipo("nav.group.team", "Equipo")).toBe(false);
  expect(namesTheBoxEquipo("nav.group.team", "Equipo de este equipo")).toBe(true);
});

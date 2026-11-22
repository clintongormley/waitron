import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { guideRoot } from "./guide-catalogue.js";

// The Waitron machine is "the box" in English and "servidor" in Spanish, never "equipo" (owner,
// 2026-11-22). Weaker than its name: it reads the guide pages' text for those two words only, so a
// "caja" that means the box, or a sentence that names the box some other way, passes.
const OTHER_SERVERS = [
  /\b(e?mail|SMTP|time)[\s-]+servers?\b/gi,
  /\b(the|its|box[’']s)\s+(\*\*)?Servers(\*\*)?\s+page\b/g,
  /\*\*System\s+→\s+Servers\*\*/g,
  /^# Servers$/gm,
  /\bservers\.md\b/g,
  /\{#[^}]*\}/g,
];

// "Equipo" meaning a staff team or a piece of equipment, each allowed once in its file.
const OTHER_EQUIPOS: Record<string, string[]> = {
  "appearance.md": ["la etiqueta del equipo"],
  "staff.md": [
    "roles de acceso del equipo",
    "**Equipo**",
    "activa los equipos que puede usar este perfil",
  ],
  "printers.md": ["Los nombres de equipos en gris", "Elige un equipo para fijarlo"],
  "table-service.md": [
    "**Equipo de este dispositivo**",
    "**Equipo**, **Idioma**",
    "## Elegir el equipo de este dispositivo",
    "**Ajustes** y **Equipo**",
    "y **Equipo**. En cada lista",
    "elige el equipo que quieres usar",
    "en **Equipo**",
    "equipo que lleva otro dispositivo",
    "qué equipo estás escaneando",
  ],
};

const root = guideRoot();

function pages(lang: string): [string, string][] {
  return readdirSync(join(root, lang))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => [file, readFileSync(join(root, lang, file), "utf8")]);
}

function serverLines(text: string): string[] {
  return hits(
    OTHER_SERVERS.reduce((acc, allowed) => acc.replace(allowed, "~"), text),
    /\bservers?\b/i,
  );
}

function hits(text: string, word: RegExp): string[] {
  return text.split("\n").filter((line) => word.test(line));
}

function escaped(phrase: string): RegExp {
  return new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"));
}

describe("the user guides call the Waitron machine the box", () => {
  it.each(pages("en"))("en/%s says box, not server", (_file, text) => {
    expect(serverLines(text)).toEqual([]);
  });

  it("still sees the machine named beside an allowed phrase", () => {
    expect(serverLines("Open **Servers** to check the pair.")).not.toEqual([]);
    expect(serverLines("Ask the mail server, then the main server.")).not.toEqual([]);
    expect(serverLines("Open **System → Servers** on the main server.")).not.toEqual([]);
    expect(serverLines("Open the **Servers** page; ask the time server.")).toEqual([]);
  });

  it.each(pages("es"))("es/%s says servidor, not equipo", (file, text) => {
    const rest = (OTHER_EQUIPOS[file] ?? []).reduce(
      (acc, phrase) => acc.replace(escaped(phrase), "~"),
      text,
    );
    expect(hits(rest, /\bequipos?\b/i)).toEqual([]);
  });

  it("names only phrases each page still holds", () => {
    const es = new Map(pages("es"));
    for (const [file, phrases] of Object.entries(OTHER_EQUIPOS))
      for (const phrase of phrases) expect(es.get(file), phrase).toMatch(escaped(phrase));
  });
});

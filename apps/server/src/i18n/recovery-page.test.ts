import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOT_INCOMPLETE,
  ENVIRONMENT_RECOVERY_TEXT,
  GENERIC_TEXT,
  OPERATOR_TEXT,
  RECOVERY_PAGE_WORDS,
  holderStalledText,
} from "./recovery-page.js";

describe("recovery page wording", () => {
  it.each([
    ["en-GB", "Waitron did not start", "Retry a normal boot"],
    ["es-ES", "Waitron no ha arrancado", "Reintentar un arranque normal"],
  ] as const)("provides the %s heading and retry button", (locale, heading, retry) => {
    expect(RECOVERY_PAGE_WORDS[locale].heading).toBe(heading);
    expect(RECOVERY_PAGE_WORDS[locale].retry).toBe(retry);
  });

  it("provides the generic line in both languages", () => {
    expect(GENERIC_TEXT).toEqual({
      "en-GB": {
        title: "Waitron could not start.",
        action:
          "Press “Retry a normal boot”. If it fails again, this is a fault in Waitron or this box.",
      },
      "es-ES": {
        title: "Waitron no ha podido arrancar.",
        action:
          "Pulsa «Reintentar un arranque normal». Si vuelve a fallar, es un fallo de Waitron o de este equipo.",
      },
    });
  });

  it("provides the database-ahead wording in both languages", () => {
    expect(OPERATOR_TEXT["provisioning.database_ahead"]).toEqual({
      "en-GB": {
        title:
          "This box's database was set up by a different version of Waitron than the one installed.",
        action:
          "Restore it from a backup, or reinstall. If you reinstall Waitron, the box starts fresh, but everything on it is lost, sales included, unless a backup is restored afterwards.",
      },
      "es-ES": {
        title:
          "La base de datos de este equipo la configuró una versión de Waitron distinta de la instalada.",
        action:
          "Restáurala desde una copia de seguridad, o reinstala. Si reinstalas Waitron, el equipo empieza de cero, pero se pierde todo lo que contiene, ventas incluidas, salvo que después se restaure una copia de seguridad.",
      },
    });
  });

  it("keys the unfinished-start wording by its recorded code", () => {
    expect(BOOT_INCOMPLETE).toBe("server.boot_incomplete");
    expect(Object.hasOwn(OPERATOR_TEXT, "server.boot_incomplete")).toBe(true);
    expect(OPERATOR_TEXT[BOOT_INCOMPLETE]).toBeDefined();
  });

  it("names the stalled holder in the title", () => {
    expect(holderStalledText("restore")["en-GB"].title).toBe(
      "The box's database is held by a restore from a backup, which appears to have stopped responding.",
    );
  });

  it.each(["server", "restore", "rejoin", "provisioning", "script", undefined] as const)(
    "tells the person to switch the box off and on when a stalled holder (%s) outlasts Retry, and names nobody to ask",
    (kind) => {
      const text = holderStalledText(kind);
      expect(text["en-GB"].action).toContain(
        "If it fails again, switch the box off and on: that ends any program holding the database.",
      );
      expect(text["es-ES"].action).toContain(
        "Si vuelve a fallar, apaga y enciende el equipo: así se cierra cualquier programa que tenga ocupada la base de datos.",
      );
      for (const lang of ["en-GB", "es-ES"] as const) {
        expect(text[lang].action, lang).not.toMatch(
          /whoever installed|quien instaló|support|soporte/i,
        );
      }
    },
  );

  it("sends nobody to someone else on any row, in either language", () => {
    const rows: [string, Record<string, string>][] = [
      ...Object.entries(OPERATOR_TEXT).flatMap(([code, text]) =>
        (["en-GB", "es-ES"] as const).map(
          (lang) => [`${code} ${lang}`, { ...text![lang] }] as [string, Record<string, string>],
        ),
      ),
      ...(["en-GB", "es-ES"] as const).map(
        (lang) =>
          [`generic ${lang}`, { ...GENERIC_TEXT[lang] }] as [string, Record<string, string>],
      ),
      ...(["en-GB", "es-ES"] as const).map(
        (lang) =>
          [`environment ${lang}`, { ...ENVIRONMENT_RECOVERY_TEXT[lang] }] as [
            string,
            Record<string, string>,
          ],
      ),
      ...(["en-GB", "es-ES"] as const).map(
        (lang) =>
          [
            `page words ${lang}`,
            Object.fromEntries(
              Object.entries(RECOVERY_PAGE_WORDS[lang]).map(([key, value]) => [
                key,
                typeof value === "function"
                  ? (value as (...args: unknown[]) => string)("x", 1)
                  : value,
              ]),
            ),
          ] as [string, Record<string, string>],
      ),
    ];
    expect(rows.length).toBeGreaterThan(6);
    for (const [label, fields] of rows) {
      for (const [field, value] of Object.entries(fields)) {
        expect(value, `${label} ${field}`).not.toMatch(
          /whoever installed|quien instaló|support|soporte/i,
        );
      }
    }
  });

  // Reads the module's source as text; it does not observe what loads at runtime.
  it("imports only types", () => {
    const source = readFileSync(new URL("./recovery-page.ts", import.meta.url), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type\b/);
  });
});

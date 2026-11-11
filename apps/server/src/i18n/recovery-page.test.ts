import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOOT_INCOMPLETE,
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
        action: "Ask whoever installed this box to look at it.",
      },
      "es-ES": {
        title: "Waitron no ha podido arrancar.",
        action: "Pide a quien instaló este equipo que lo revise.",
      },
    });
  });

  it("provides the database-ahead wording in both languages", () => {
    expect(OPERATOR_TEXT["provisioning.database_ahead"]).toEqual({
      "en-GB": {
        title:
          "This box's database was set up by a different version of Waitron than the one installed.",
        action:
          "Restore it from a backup, or reinstall. If you do not have a backup, ask whoever installed this box for help.",
      },
      "es-ES": {
        title:
          "La base de datos de este equipo la configuró una versión de Waitron distinta de la instalada.",
        action:
          "Restáurala desde una copia de seguridad, o reinstala. Si no tienes copia de seguridad, pide ayuda a quien instaló este equipo.",
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
        expect(text[lang].action, lang).not.toMatch(/whoever installed|quien instaló/i);
      }
    },
  );

  // Reads the module's source as text; it does not observe what loads at runtime.
  it("imports only types", () => {
    const source = readFileSync(new URL("./recovery-page.ts", import.meta.url), "utf8");
    const imports = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line).toMatch(/^import type\b/);
  });
});

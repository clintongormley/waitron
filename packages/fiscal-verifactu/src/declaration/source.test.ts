import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declarationSourceFor } from "../../test/declaration.js";
import {
  declarationDate,
  declarationItems,
  parseFunctions,
  prepareDeclarationSource,
  releaseBlockers,
  spanishDate,
  type PrepareInput,
} from "./source.js";

const template = readFileSync(new URL("../../declarations/template.md", import.meta.url), "utf8");
const functions = readFileSync(new URL("../../declarations/functions.md", import.meta.url), "utf8");

function input(overrides: Partial<PrepareInput> = {}): PrepareInput {
  return {
    template,
    functions,
    version: "1.2.3",
    libraryVersion: "0.2.1",
    date: "2026-10-22",
    place: "Elche",
    ...overrides,
  };
}

describe("prepareDeclarationSource", () => {
  it("fills the real template's release slots and leaves only the producer's", () => {
    const source = prepareDeclarationSource(input());
    const items = declarationItems(source);

    expect(items.get("1.a")).toBe("Waitron");
    expect(items.get("1.b")).toBe("W1");
    expect(items.get("1.c")).toBe("1.2.3");
    expect(items.get("1.e")).toBe("S - Sí");
    expect(items.get("1.f")).toBe("N - No");
    expect(source).toContain("(versión 0.2.1)");
    expect(source).toContain("22 de octubre de 2026");
    expect(source).toContain("Elche – España");
    expect(source.match(/‹[^›]*›/g)).toEqual(["‹nombre y apellidos›", "‹NIF›", "‹dirección›"]);
  });

  it("keeps the template's comment lines", () => {
    expect(releaseBlockers(prepareDeclarationSource(input()))).toHaveLength(1);
  });

  it("joins the functions list as Spanish prose", () => {
    const source = prepareDeclarationSource(
      input({
        functions: "- toma de pedidos — a.ts\n- cobro — b.ts\n- informes de ventas — c.ts\n",
      }),
    );
    expect(source).toContain(
      "Principales funcionalidades: toma de pedidos, cobro e informes de ventas.",
    );
  });

  it("refuses a slot it does not know", () => {
    expect(() =>
      prepareDeclarationSource(input({ template: "**1.a) Nombre:** ‹nada›\n" })),
    ).toThrow(
      expect.objectContaining({ code: "declaration.slot_unfilled", params: { slot: "‹nada›" } }),
    );
  });

  it("writes a filled value literally, never reading it again as a slot", () => {
    const source = prepareDeclarationSource(input({ place: "‹versión›" }));
    expect(source).toContain("‹versión› – España");
  });
});

describe("parseFunctions", () => {
  it("answers each line's published text", () => {
    expect(
      parseFunctions("<!-- format -->\n- toma de pedidos — a.ts\n- informes de ventas — c.ts\n"),
    ).toEqual(["toma de pedidos", "informes de ventas"]);
  });

  it("refuses a line with no route, naming its line", () => {
    expect(() => parseFunctions("<!-- format -->\n- cobro — b.ts\n- informes de ventas\n")).toThrow(
      expect.objectContaining({ code: "declaration.functions_malformed", params: { line: 3 } }),
    );
  });

  it("reads every line of the committed list", () => {
    const listed = functions.split("\n").filter((line) => line.startsWith("- "));
    expect(parseFunctions(functions)).toHaveLength(listed.length);
    expect(listed.length).toBeGreaterThan(0);
  });
});

describe("releaseBlockers", () => {
  it("answers each blocker line's text in the real template", () => {
    const blockers = releaseBlockers(template);
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/^Item 1\.d\) is the draft sent to the asesor as Q53\./);
  });

  it("answers nothing for a text with none", () => {
    expect(releaseBlockers("<!-- a note -->\n**1.a) Nombre:** Waitron\n")).toEqual([]);
  });
});

describe("declarationItems", () => {
  it("collapses whitespace in a value that wraps", () => {
    const items = declarationItems("**1.k)** La persona\nproductora   hace\n\n**2.a) Otras:** x\n");
    expect(items.get("1.k")).toBe("La persona productora hace");
    expect(items.get("2.a")).toBe("x");
  });
});

describe("spanishDate", () => {
  it("writes the date with the Spanish month name", () => {
    expect(spanishDate("2026-03-01")).toBe("1 de marzo de 2026");
    expect(spanishDate("2026-10-22")).toBe("22 de octubre de 2026");
    expect(spanishDate("2028-02-29")).toBe("29 de febrero de 2028");
  });

  it.each([
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "22/10/2026",
    "2026-10-22T00:00",
    " 2026-10-22",
    "0999-02-28",
    "0000-01-01",
  ])("refuses %j, which is not a calendar date written YYYY-MM-DD", (date) => {
    expect(() => spanishDate(date)).toThrow(
      expect.objectContaining({ code: "declaration.date_invalid", params: { date } }),
    );
  });
});

describe("declarationDate", () => {
  it.each([
    ["2026-12-03", "3 de diciembre de 2026"],
    ["2026-03-01", "1 de marzo de 2026"],
  ])("reads %s back from item 1.l)'s %j", (date, words) => {
    const source = declarationSourceFor("1.2.3", { date });
    expect(source).toContain(`responsable del mismo: ${words}.`);

    expect(declarationDate(source)).toBe(date);
  });

  it.each([
    ["an impossible day", "31 de febrero de 2026"],
    ["a slot never filled", "‹fecha›"],
    ["a day with a leading zero", "03 de diciembre de 2026"],
    ["a month that is not one", "3 de brumario de 2026"],
  ])("refuses %s", (_name, line) => {
    const source = declarationSourceFor("1.2.3").replace("22 de octubre de 2026", line);

    expect(() => declarationDate(source)).toThrow(
      expect.objectContaining({ code: "declaration.date_unreadable", params: { line } }),
    );
  });

  it("refuses a bullet with no `: `, naming the whole bullet", () => {
    const source = declarationSourceFor("1.2.3").replace(
      /(\*\*1\.l\)\*\*\s*\n- )[\s\S]*?22 de octubre de 2026\./,
      "$1x3 de diciembre de 2026",
    );
    expect(source).toContain("- x3 de diciembre de 2026\n");

    expect(() => declarationDate(source)).toThrow(
      expect.objectContaining({
        code: "declaration.date_unreadable",
        params: { line: "x3 de diciembre de 2026" },
      }),
    );
  });

  it("refuses a source with no 1.l) bullet", () => {
    expect(() => declarationDate("**1.k)** nada\n")).toThrow(
      expect.objectContaining({ code: "declaration.date_unreadable", params: { line: "" } }),
    );
  });
});

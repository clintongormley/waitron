import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { declarationBlocks, fillProducer, renderDeclaration } from "./render.js";
import { declarationItems, prepareDeclarationSource } from "./source.js";

const template = readFileSync(new URL("../../declarations/template.md", import.meta.url), "utf8");
const functions = readFileSync(new URL("../../declarations/functions.md", import.meta.url), "utf8");

const source = prepareDeclarationSource({
  template,
  functions,
  version: "1.2.3",
  libraryVersion: "0.2.1",
  date: "2026-10-22",
  place: "Elche",
});

const producer = {
  name: "PRODUCER PERSON",
  taxId: "00000000T",
  address: "1 Example Street, 00000 Nowhere (Province), Spain",
};

describe("renderDeclaration", () => {
  it("renders the real template as text and HTML with the producer's values", () => {
    const { text, html } = renderDeclaration(source, producer);
    for (const output of [text, html]) {
      expect(output).toContain("PRODUCER PERSON");
      expect(output).toContain("00000000T");
      expect(output).toContain("1 Example Street, 00000 Nowhere (Province), Spain");
      expect(output).not.toContain("‹");
      expect(output).not.toContain("\\");
      expect(output).not.toContain("release-blocker");
      expect(output).not.toContain("**");
    }
  });

  it("writes the text one paragraph per line and one list item per line", () => {
    const { text } = renderDeclaration(source, producer);
    const lines = text.split("\n");
    expect(lines[0]).toBe("DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN");
    expect(lines[1]).toBe("");
    expect(lines).toContain(
      "1.i) Número de identificación fiscal (NIF) español de la persona productora del sistema informático a que se refiere esta declaración responsable: 00000000T",
    );
    expect(lines).toContain(
      "- Lugar en que la persona productora de este sistema informático suscribe esta declaración responsable del mismo: Elche – España.",
    );
  });

  it("writes a whole Spanish HTML document with the title as its heading", () => {
    const { html } = renderDeclaration(source, producer);
    expect(html).toMatch(/^<!DOCTYPE html>\n<html lang="es">/);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain(
      "<h1>DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN</h1>",
    );
    expect(html).toContain("<p><strong>1.a) Nombre del sistema informático");
    expect(html).toContain("<ul><li>Histórico de declaraciones responsables");
    expect(html).not.toMatch(/<(style|script|link)\b/);
  });

  it("escapes a producer's markup in HTML and keeps it whole in text", () => {
    const { text, html } = renderDeclaration(source, {
      name: "Pérez & Hijos <SL>",
      taxId: `"0'0"`,
      address: "‹NIF›",
    });
    expect(html).toContain("Pérez &amp; Hijos &lt;SL&gt;");
    expect(html).toContain("&quot;0&#39;0&quot;");
    expect(html).not.toContain("<SL>");
    expect(text).toContain("Pérez & Hijos <SL>");
    expect(
      declarationItems(fillProducer(source, { ...producer, address: "‹NIF›" })).get("1.j"),
    ).toBe("‹NIF›");
  });

  it("writes a producer's values literally, never reading them as markup", () => {
    const odd = {
      name: "**Unpaired",
      taxId: "<!-- 0 --> - 1",
      address: "Example Street **Door 2**",
    };
    const { text, html } = renderDeclaration(source, odd);
    const lines = text.split("\n");
    for (const value of Object.values(odd)) {
      expect(lines.filter((line) => line.endsWith(`responsable: ${value}`))).toHaveLength(1);
    }
    expect(html).toContain("</strong> **Unpaired</p>");
    expect(html).toContain("</strong> &lt;!-- 0 --&gt; - 1</p>");
    expect(html).toContain("</strong> Example Street **Door 2**</p>");
    const strong = (output: string) => output.split("<strong>").length;
    expect(strong(html)).toBe(strong(renderDeclaration(source, producer).html));
  });

  it.each([
    ["name", "LF", "\n"],
    ["taxId", "U+2028", "\u2028"],
    ["address", "U+2029", "\u2029"],
    ["address", "U+0085", "\u0085"],
    ["address", "VT", "\v"],
    ["address", "FF", "\f"],
    ["address", "TAB", "\t"],
    ["address", "NUL", "\u0000"],
  ] as const)("refuses a producer's %s holding %s", (field, _label, character) => {
    const odd = { ...producer, [field]: `1 Example Street${character}Nowhere` };
    for (const render of [renderDeclaration, declarationBlocks, fillProducer]) {
      expect(() => render(source, odd)).toThrow(
        expect.objectContaining({ code: "declaration.producer_invalid", params: { field } }),
      );
    }
  });

  it("refuses a source still holding a release slot", () => {
    expect(() => renderDeclaration("**1.c) Versión:** ‹versión›\n", producer)).toThrow(
      expect.objectContaining({
        code: "declaration.slot_unfilled",
        params: { slot: "‹versión›" },
      }),
    );
    expect(() => fillProducer("**1.c) Versión:** ‹versión›\n", producer)).toThrow(
      expect.objectContaining({
        code: "declaration.slot_unfilled",
        params: { slot: "‹versión›" },
      }),
    );
  });
});

describe("declarationBlocks", () => {
  it("reads a list item's continuation and keeps a backslash as an ordinary character", () => {
    expect(declarationBlocks("Título\n\n**A)** x\\y\n\n- uno\n  dos\n- tres\n", producer)).toEqual([
      { kind: "title", lines: [[{ bold: false, text: "Título" }]] },
      {
        kind: "paragraph",
        lines: [
          [
            { bold: true, text: "A)" },
            { bold: false, text: " x\\y" },
          ],
        ],
      },
      {
        kind: "list",
        lines: [[{ bold: false, text: "uno dos" }], [{ bold: false, text: "tres" }]],
      },
    ]);
  });

  it("puts a producer's value into the run its slot sits in, as it is", () => {
    expect(
      declarationBlocks("Título\n\n**1.j)** ‹dirección›\n", {
        ...producer,
        address: "Example Street **Door 2**",
      }),
    ).toEqual([
      { kind: "title", lines: [[{ bold: false, text: "Título" }]] },
      {
        kind: "paragraph",
        lines: [
          [
            { bold: true, text: "1.j)" },
            { bold: false, text: " Example Street **Door 2**" },
          ],
        ],
      },
    ]);
  });
});

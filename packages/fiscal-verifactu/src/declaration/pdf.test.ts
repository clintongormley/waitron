import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderDeclarationPdf } from "./pdf.js";
import { prepareDeclarationSource } from "./source.js";

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

async function pages(bytes: Uint8Array) {
  const task = getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
  });
  const pdf = await task.promise;
  const read = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const size = page.getViewport({ scale: 1 });
    const text = (await page.getTextContent()).items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ");
    read.push({ width: size.width, height: size.height, text });
  }
  await task.destroy();
  return read;
}

describe("renderDeclarationPdf", () => {
  it("draws the real template on A4 pages with the producer's values", async () => {
    const read = await pages(await renderDeclarationPdf(source, producer));
    for (const page of read) {
      expect(page.width).toBeCloseTo(595.28, 1);
      expect(page.height).toBeCloseTo(841.89, 1);
    }
    const text = read.map((page) => page.text).join(" ");
    expect(text).toContain("DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN");
    expect(text).toContain("00000000T");
    expect(text).toContain("España");
    expect(text).not.toContain("[U+");
  });

  it("refuses a character the font cannot draw, naming its code point", async () => {
    await expect(
      renderDeclarationPdf(source, { ...producer, name: "PRODUCER 漢 PERSON" }),
    ).rejects.toThrow("U+6F22");
  });
});

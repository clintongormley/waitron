import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { expect, it } from "vitest";

it("renders English sample identities and dishes while retaining the Spanish invoice presentation", async () => {
  const out = mkdtempSync(join(tmpdir(), "waitron-receipt-look-"));
  try {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/receipt-look.ts", out], {
      cwd: new URL("..", import.meta.url),
      timeout: 90_000,
      stdio: "pipe",
    });
    const files = readdirSync(out);
    const texts: Record<string, string> = {};
    for (const file of files.filter((name) => name.endsWith(".pdf"))) {
      const loading = getDocument({ data: Uint8Array.from(readFileSync(join(out, file))) });
      try {
        const pdf = await loading.promise;
        const pages: string[] = [];
        for (let number = 1; number <= pdf.numPages; number++) {
          const page = await pdf.getPage(number);
          const content = await page.getTextContent();
          pages.push(content.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" "));
        }
        texts[file] = pages.join(" ").replace(/\s+/g, " ");
      } finally {
        await loading.destroy();
      }
    }
    expect(Object.keys(texts)).toHaveLength(13);
    const target = texts["full-addresses-match-a4.pdf"]!;
    for (const text of [
      "Water, bread and olive oil",
      "Sample Food Distribution Ltd",
      "215 Sample Avenue",
      "245 Customer Street",
      "36,60",
      "B12345678",
    ])
      expect(target).toContain(text);
    const fixture = texts["full-invoice-a4.pdf"]!;
    for (const text of [
      "Sample Deli Ltd",
      "Customer with a particularly long registered company name Ltd",
      "Set menu with a particularly long name",
      "Mineral water",
      "19,69",
    ])
      expect(fixture).toContain(text);
    const allText = Object.values(texts).join(" ");
    for (const dish of [
      "Iberian ham",
      "Extra cheese",
      "Burger",
      "Country bread",
      "Olives",
      "Croquettes",
      "Set menu",
    ])
      expect(allText).toContain(dish);
    for (const text of ["FACTURA", "VERI*FACTU", "TOTAL"]) expect(target).toContain(text);
    for (const file of files.filter((name) => name.endsWith(".png"))) {
      const metadata = await sharp(join(out, file)).metadata();
      expect(metadata.width).toBeGreaterThan(100);
      expect(metadata.height).toBeGreaterThan(100);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

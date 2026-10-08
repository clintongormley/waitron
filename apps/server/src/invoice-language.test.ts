import { createCanvas } from "@napi-rs/canvas";
import { COUNTRY_PACKS } from "@waitron/country-packs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { invoiceFont } from "./invoice-font.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { renderInvoiceRaster } from "./invoice-raster.js";
import { FULL_INVOICE_DOCUMENT_FIXTURE as fixture } from "./testing/full-invoice-fixture.js";

const languages = [
  {
    locale: "es-ES",
    name: "Menú de piñón y café",
    want: [
      "Factura completa",
      "Fecha de operación",
      "Precio sin IVA 10,00 € / 1",
      "Descuento 10% (IVA incluido) -1,21 €",
      "Base 21% 9,00 € IVA 21% 1,89 € Base 10% 8,00 € IVA 10% 0,80 €",
      "TOTAL 19,69 €",
      "Efectivo 20,00 €",
      "Cambio 0,31 €",
      "DUPLICADO",
      "PRUEBA - SIN COBRO REAL",
    ],
  },
  {
    locale: "ca-ES",
    name: "Menú de pinyó amb cafè i il·lusió",
    want: [
      "Factura completa",
      "Data de l'operació",
      "Preu sense IVA 10,00 € / 1",
      "Descompte 10% (IVA inclòs) -1,21 €",
      "Base 21% 9,00 € IVA 21% 1,89 € Base 10% 8,00 € IVA 10% 0,80 €",
      "TOTAL 19,69 €",
      "Efectiu 20,00 €",
      "Canvi 0,31 €",
      "DUPLICAT",
      "PROVA - SENSE COBRAMENT REAL",
    ],
  },
  {
    locale: "gl-ES",
    name: "Menú de piñón e café",
    want: [
      "Factura completa",
      "Data da operación",
      "Prezo sen IVE 10,00 € / 1",
      "Desconto 10% (IVE incluído) -1,21 €",
      "Base 21% 9,00 € IVE 21% 1,89 € Base 10% 8,00 € IVE 10% 0,80 €",
      "TOTAL 19,69 €",
      "Efectivo 20,00 €",
      "Cambio 0,31 €",
      "DUPLICADO",
      "PROBA - SEN COBRO REAL",
    ],
  },
  {
    locale: "eu-ES",
    name: "Pinoi eta kafe menua",
    want: [
      "Faktura osoa",
      "Eragiketaren data",
      "BEZik gabeko prezioa 10,00 € / 1",
      "Deskontua 10% (BEZa barne) -1,21 €",
      "Oinarria 21% 9,00 € BEZ 21% 1,89 € Oinarria 10% 8,00 € BEZ 10% 0,80 €",
      "GUZTIRA 19,69 €",
      "Eskudirua 20,00 €",
      "Itzulia 0,31 €",
      "BIKOIZKARIA",
      "PROBA - BENETAKO KOBRANTZARIK GABE",
    ],
  },
];

describe("invoice receipt languages", () => {
  it("exercises every receipt language labelled by an installed country pack", () => {
    expect(languages.map(({ locale }) => locale).sort()).toEqual(
      [...new Set(COUNTRY_PACKS.flatMap((pack) => Object.keys(pack.receiptLabels ?? {})))].sort(),
    );
  });

  it("keeps the chosen name language separate from fixed invoice words", async () => {
    const bytes = await renderInvoicePdf({
      ...fixture,
      invoiceLocale: "ca-ES",
      namesLocale: "es-ES",
    });
    const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
    const pdf = await loading.promise;
    try {
      const content = await (await pdf.getPage(1)).getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ")
        .replace(/\s+/g, " ");
      expect(text).toContain("Data de l'operació");
      expect(text).toContain("Menú del día con un nombre especialmente largo");
      expect(text).not.toContain("Set menu with a particularly long name");
    } finally {
      await loading.destroy();
    }
  });

  it.each(
    languages.flatMap((language) =>
      ([300, 600] as const).map((resolution) => ({ ...language, resolution })),
    ),
  )(
    "preserves $locale figures, names and glyphs in the PDF and outlined page at $resolution dpi",
    async ({ locale, name, want, resolution }) => {
      const input = {
        ...fixture,
        invoiceLocale: locale,
        duplicate: true,
        simulated: true,
        result: {
          ...fixture.result,
          lines: fixture.result.lines.map((line, index) => ({
            ...line,
            descriptions: {
              "en-GB": "Wrong frozen name from another language",
              [locale]: index === 0 ? name : "Agua mineral",
            },
          })),
        },
      };
      const bytes = await renderInvoicePdf(input);
      const loading = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: false });
      const pdf = await loading.promise;
      try {
        expect(pdf.numPages).toBe(1);
        const page = await pdf.getPage(1);
        const content = await page.getTextContent();
        const items = content.items.filter((item) => "str" in item);
        const text = items
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+/g, " ");
        for (const expected of [...want, name, "FF/1", "B12345678", "B11223344", "VERI*FACTU"])
          expect(text).toContain(expected);
        expect(text).not.toContain("Wrong frozen name from another language");
        for (const character of new Set(text)) {
          expect(
            invoiceFont.hasGlyphForCodePoint(character.codePointAt(0)!),
            `${locale} missing glyph ${character}`,
          ).toBe(true);
        }

        const width = 2480 * (resolution / 300);
        const height = 3508 * (resolution / 300);
        const [raster] = await renderInvoiceRaster(input, resolution);
        const canvas = createCanvas(width, height);
        const context = canvas.getContext("2d");
        const viewport = page.getViewport({ scale: width / 595.28 });
        await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
          .promise;
        const reference = context.getImageData(0, 0, width, height).data;
        for (const item of items) {
          if (item.str.trim() === "") continue;
          const [left, baseline] = viewport.convertToViewportPoint(
            item.transform[4],
            item.transform[5],
          );
          const top = Math.max(2, Math.floor(baseline! - item.height * viewport.scale - 3));
          const bottom = Math.min(height - 2, Math.ceil(baseline! + 3));
          const start = Math.max(2, Math.floor(left! - 2));
          const end = Math.min(width - 2, Math.ceil(left! + item.width * viewport.scale + 2));
          let ink = 0;
          let matched = 0;
          for (let y = top; y < bottom; y++) {
            for (let x = start; x < end; x++) {
              if (reference[(y * width + x) * 4]! >= 128) continue;
              ink++;
              let present = false;
              for (let dy = -2; dy <= 2 && !present; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                  if (raster!.pixels[(y + dy) * width + x + dx]! < 128) {
                    present = true;
                    break;
                  }
                }
              }
              if (present) matched++;
            }
          }
          expect(ink, item.str).toBeGreaterThan(25);
          expect(matched / ink, `${locale}: ${item.str}`).toBeGreaterThan(0.99);
        }
        expect(await renderInvoicePdf(input)).toEqual(bytes);
      } finally {
        await loading.destroy();
      }
    },
  );
});

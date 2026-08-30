import { describe, expect, it } from "vitest";

import { toInvoiceLineDescriptions } from "./invoice-descriptions.js";

describe("toInvoiceLineDescriptions", () => {
  it("region-strips a full tag to its bare language and uses that text", () => {
    expect(toInvoiceLineDescriptions({ es: "Café" }, ["es-ES"])).toEqual({
      "es-ES": "Café",
    });
  });

  it("resolves each full tag independently from its bare language", () => {
    expect(toInvoiceLineDescriptions({ es: "Café", ca: "Cafè" }, ["es-ES", "ca-ES"])).toEqual({
      "es-ES": "Café",
      "ca-ES": "Cafè",
    });
  });

  it("graceful-fills a missing language from the primary catalogue value (never throws)", () => {
    expect(toInvoiceLineDescriptions({ es: "Café" }, ["es-ES", "ca-ES"])).toEqual({
      "es-ES": "Café",
      "ca-ES": "Café",
    });
  });

  it("drops catalogue languages not requested in invoiceLocales", () => {
    expect(toInvoiceLineDescriptions({ es: "Café", en: "Coffee" }, ["es-ES"])).toEqual({
      "es-ES": "Café",
    });
  });

  it("tolerates a catalogue already keyed by full tag (exact-tag arm)", () => {
    expect(toInvoiceLineDescriptions({ "es-ES": "Café" }, ["es-ES"])).toEqual({
      "es-ES": "Café",
    });
  });

  it("matches by language when the catalogue is keyed by a different full tag", () => {
    // Catalogue authored under es-419 (Latin-American Spanish), invoice wants es-ES: neither the
    // exact tag nor the bare `es` key exists, so it resolves via the first same-language key.
    expect(toInvoiceLineDescriptions({ "es-419": "Café" }, ["es-ES"])).toEqual({
      "es-ES": "Café",
    });
  });

  it("maps every tag to the empty string for an empty catalogue (no throw)", () => {
    expect(toInvoiceLineDescriptions({}, ["es-ES"])).toEqual({ "es-ES": "" });
  });

  it("returns exactly the invoiceLocales keys — no extra, none missing", () => {
    const result = toInvoiceLineDescriptions({ es: "Café", en: "Coffee" }, ["es-ES", "ca-ES"]);
    expect(Object.keys(result).sort()).toEqual(["ca-ES", "es-ES"]);
  });
});

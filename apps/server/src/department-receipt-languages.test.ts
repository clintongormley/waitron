import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS, contentLanguages } from "@waitron/catalogue";
import { locationId } from "@waitron/shared";
import { departmentReceiptLanguages } from "./department-receipt-languages.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

async function read(receiptLanguage: string, languages?: string[], country: string | null = "ES") {
  if (country !== null)
    await suite.db
      .insert(tenants)
      .values({ id: 1, country, taxId: "B12345678", legalName: "Venue SL" });
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: randomUUID(),
      invoiceLocales: [receiptLanguage],
      operationDescription: "Bootstrap",
    })
    .returning();
  if (languages !== undefined) {
    await suite.db
      .insert(contentLanguages)
      .values({
        defaultLanguage: languages[0]!,
        languages,
      })
      .onConflictDoUpdate({
        target: contentLanguages.id,
        set: { defaultLanguage: languages[0]!, languages },
      });
  }
  return withTransaction(suite.db, (tx) =>
    departmentReceiptLanguages(tx, { locationId: locationId(location!.id) }),
  );
}

describe("department receipt languages", () => {
  it("offers the current receipt language first and only labelled enabled content languages", async () => {
    expect(await read("gl-ES", ["es", "ca", "en"])).toEqual({
      receiptLanguage: "gl-ES",
      languages: ["gl-ES", "es-ES", "ca-ES"],
      storageLanguages: ["gl-ES", "es-ES", "ca-ES", "eu-ES"],
    });
  });
  it("deduplicates the current language when it is enabled content", async () => {
    expect(await read("ca-ES", ["ca", "es", "gl", "eu"])).toEqual({
      receiptLanguage: "ca-ES",
      languages: ["ca-ES", "es-ES", "gl-ES", "eu-ES"],
      storageLanguages: ["ca-ES", "es-ES", "gl-ES", "eu-ES"],
    });
  });
  it("does not treat Valencian content as Catalan receipt content", async () => {
    expect(await read("es-ES", ["es", "ca-ES-valencia", "en"])).toEqual({
      receiptLanguage: "es-ES",
      languages: ["es-ES"],
      storageLanguages: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
    });
  });
  it("retains an unlabelled current locale without inventing labelled English copies", async () => {
    expect(await read("en-GB", ["en", "ca"])).toEqual({
      receiptLanguage: "en-GB",
      languages: ["en-GB", "ca-ES"],
      storageLanguages: ["en-GB", "es-ES", "ca-ES", "gl-ES", "eu-ES"],
    });
  });
  it("uses the receipt locale's content language when no content settings are saved", async () => {
    expect(await read("eu-ES")).toEqual({
      receiptLanguage: "eu-ES",
      languages: ["eu-ES"],
      storageLanguages: ["eu-ES", "es-ES", "ca-ES", "gl-ES"],
    });
  });
  it("keeps all labelled locales available for storage when only one is offered", async () => {
    const result = await read("es-ES", ["en"]);
    expect(result.languages).toEqual(["es-ES"]);
    expect(result.storageLanguages).toEqual(["es-ES", "ca-ES", "gl-ES", "eu-ES"]);
  });
});

it.each([null, "XX"])(
  "does not offer another installed country's translations for country %s",
  async (country) => {
    expect(await read("es-ES", ["es", "ca", "gl", "eu"], country)).toEqual({
      receiptLanguage: "es-ES",
      languages: ["es-ES"],
      storageLanguages: ["es-ES", "ca-ES", "gl-ES", "eu-ES"],
    });
  },
);

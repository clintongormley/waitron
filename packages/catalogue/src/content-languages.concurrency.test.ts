import { expect, it } from "vitest";
import { CORE_MIGRATIONS, catalogues, products, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  readContentLanguages,
  validateContentTranslations,
  writeContentLanguages,
} from "./content-languages.js";
import { racePair } from "../test/fixtures.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

async function configuredTenant() {
  await seedTenant(suite.db);
  await withTransaction(suite.db, (tx) =>
    writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "fr"] }),
  );
  const [menu] = await suite.db
    .insert(catalogues)
    .values({ name: "Lunch" })
    .returning({ id: catalogues.id });
  return { menuId: menu!.id };
}

it("a default switch waits for an authoring transaction and keeps its incomplete customer map", async () => {
  const { menuId } = await configuredTenant();

  const [write, change] = await racePair(
    suite.db,
    async (tx) => {
      await validateContentTranslations(tx, { en: "Bread" }, "es");
      await tx.insert(products).values({
        catalogueId: menuId,
        name: "Bread",
        customerName: { en: "Bread" },
        pricingUnit: "each",
        unitPrice: 2,
        vatClass: "general",
      });
    },
    (tx) => writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["en", "fr"] }),
  );

  expect(write.status).toBe("fulfilled");
  expect(change.status).toBe("fulfilled");
  expect((await suite.db.select().from(products))[0]!.customerName).toEqual({ en: "Bread" });
  expect(
    (await withTransaction(suite.db, (tx) => readContentLanguages(tx, "es"))).defaultLanguage,
  ).toBe("fr");
});

it("an authoring transaction waits for the default switch and validates against the committed new language", async () => {
  await configuredTenant();

  const [change, write] = await racePair(
    suite.db,
    (tx) => writeContentLanguages(tx, { defaultLanguage: "fr", languages: ["en", "fr"] }),
    (tx) => validateContentTranslations(tx, { en: "Bread" }, "es"),
  );

  expect(change.status).toBe("fulfilled");
  expect(write.status).toBe("rejected");
  if (write.status === "rejected")
    expect(write.reason).toMatchObject({
      code: "content.translation_required",
      params: { language: "fr" },
    });
});

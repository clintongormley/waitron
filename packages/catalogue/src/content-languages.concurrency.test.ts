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

/**
 * An authoring transaction and a change of the venue's DEFAULT LANGUAGE do not interleave, and
 * whichever runs second validates against the other's committed state.
 *
 * That is the whole subject, and it survived the storage switch; what arranged it did not.
 * `findContentTranslationGap` and `writeContentLanguages` used to take
 * `pg_advisory_xact_lock(hashtextextended('content-languages', 0))` as their first statement, and
 * this file used to watch the second backend block on it. There is one writer on this engine:
 * `racePair` (`test/fixtures.ts`) carries the mechanism, the measurement and its control.
 *
 * What is NOT here any more is a third case — that `content_languages` is read and written as
 * `app_user` with exactly `INSERT,SELECT,UPDATE`, and that a `delete from content_languages` is
 * refused. There are no roles and no grants; the commit message says so.
 */
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

it("a default switch waits for an authoring transaction and rejects its newly committed missing translation", async () => {
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
  expect(change.status).toBe("rejected");
  if (change.status === "rejected")
    expect(change.reason).toMatchObject({
      code: "content.default_missing",
      params: { language: "fr", count: 1 },
    });
  expect(
    (await withTransaction(suite.db, (tx) => readContentLanguages(tx, "es"))).defaultLanguage,
  ).toBe("en");
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

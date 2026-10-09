import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import {
  readContentLanguages,
  writeContentLanguages,
  listContentTranslationGaps,
} from "./content-languages.js";
import { createUnit } from "./units.js";
import { units } from "./schema/units.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const valencian = "ca-ES-valencia";

describe("stored Valencian content", () => {
  it("stores Catalan and Valencian separately without copying either text", async () => {
    await seedTenant(suite.db);
    await withTransaction(suite.db, async (tx) => {
      const unit = await createUnit(
        tx,
        {
          name: { es: "Spanish", ca: "Catalan", [valencian]: "Valencian" },
          abbreviation: { es: "u" },
          precision: 0,
        },
        "es",
      );
      await writeContentLanguages(
        tx,
        { defaultLanguage: valencian, languages: [valencian, "ca", "es"] },
        "es",
        undefined,
        [valencian, "es"],
      );
      expect(await readContentLanguages(tx, "es")).toEqual({
        defaultLanguage: valencian,
        languages: [valencian, "ca", "es"],
      });
      const [stored] = await tx
        .select({ name: units.name })
        .from(units)
        .where(eq(units.id, unit.id));
      expect(stored!.name).toEqual({ es: "Spanish", ca: "Catalan", [valencian]: "Valencian" });
      expect(await listContentTranslationGaps(tx, valencian)).toEqual([]);
    });
  });
  it("reports missing Valencian text even when Catalan exists", async () => {
    await seedTenant(suite.db);
    const unit = await withTransaction(suite.db, (tx) =>
      createUnit(
        tx,
        { name: { es: "Spanish", ca: "Catalan" }, abbreviation: { es: "u" }, precision: 0 },
        "es",
      ),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        writeContentLanguages(
          tx,
          { defaultLanguage: valencian, languages: [valencian, "ca", "es"] },
          "es",
        ),
      ),
    ).rejects.toMatchObject({
      code: "content.default_missing",
      params: { language: valencian, count: 1 },
    });
    expect(
      await withTransaction(suite.db, (tx) => listContentTranslationGaps(tx, valencian)),
    ).toEqual([{ kind: "unit", id: unit.id }]);
    expect(await withTransaction(suite.db, (tx) => readContentLanguages(tx, "es"))).toEqual({
      defaultLanguage: "es",
      languages: ["es"],
    });
  });
  it("refuses Catalan in place of the required Valencian code", async () => {
    await expect(
      withTransaction(suite.db, (tx) =>
        writeContentLanguages(
          tx,
          { defaultLanguage: "es", languages: ["es", "ca"] },
          "es",
          undefined,
          [valencian, "es"],
        ),
      ),
    ).rejects.toMatchObject({ code: "content.language_required", params: { language: valencian } });
  });
});

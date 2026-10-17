import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { contentLanguages } from "./schema/menu.js";
import { units } from "./schema/units.js";
import { createUnit, getUnit, updateUnit, EACH_UNIT } from "./units.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const input = () => ({
  staffName: "Kilogramo",
  staffAbbreviation: "kg",
  name: {},
  abbreviation: {},
  precision: 3,
});
const run = <T>(action: (tx: Parameters<typeof createUnit>[0]) => Promise<T> | T) =>
  withTransaction(suite.db, async (tx) => action(tx));

describe("explicit unit staff identity", () => {
  it("stores and returns independent staff fields with no translations", async () => {
    const saved = await run((tx) => createUnit(tx, input(), "en"));
    expect(saved).toEqual({ id: expect.any(String), ...input() });
    expect(await run((tx) => getUnit(tx, saved.id))).toEqual(saved);
    const [stored] = await suite.db.select().from(units);
    expect(stored).toMatchObject(input());
    expect(EACH_UNIT).toMatchObject({
      id: "00000000-0000-0000-0000-000000000001",
      staffName: "Each",
      staffAbbreviation: "ea",
      precision: 0,
      hardwareUnit: null,
    });
  });

  it("clears enabled translations, preserves disabled text and keeps PATCH omissions", async () => {
    await suite.db
      .insert(contentLanguages)
      .values({ defaultLanguage: "en", languages: ["en", "es"] });
    const saved = await run((tx) =>
      createUnit(
        tx,
        { ...input(), name: { en: "Weight", es: "Peso" }, abbreviation: { en: "w", es: "p" } },
        "en",
      ),
    );
    await suite.db.update(contentLanguages).set({ languages: ["en"] });
    const cleared = await run((tx) =>
      updateUnit(tx, saved.id, { name: {}, abbreviation: {} }, "en"),
    );
    expect(cleared).toEqual({ ...saved, name: { es: "Peso" }, abbreviation: { es: "p" } });
    expect(await run((tx) => updateUnit(tx, saved.id, {}, "en"))).toEqual(cleared);
    expect(
      await run((tx) =>
        updateUnit(tx, saved.id, { staffName: "Masa", staffAbbreviation: "M" }, "en"),
      ),
    ).toEqual({ ...cleared, staffName: "Masa", staffAbbreviation: "M" });
    await expect(
      run((tx) => updateUnit(tx, saved.id, { name: { es: "Changed" } }, "en")),
    ).rejects.toMatchObject({ code: "content.translation_invalid", params: {} });
    for (const es of ["", " Peso "]) {
      await expect(
        run((tx) => updateUnit(tx, saved.id, { name: { es } }, "en")),
      ).rejects.toMatchObject({ code: "content.translation_invalid", params: {} });
    }
    expect(await run((tx) => getUnit(tx, saved.id))).toEqual({
      ...cleared,
      staffName: "Masa",
      staffAbbreviation: "M",
    });
  });

  for (const field of ["staffName", "staffAbbreviation"] as const) {
    it.each([undefined, null, "", "  ", 42, "é".repeat(2049)])(
      `refuses invalid ${field} %j before any create or update`,
      async (value) => {
        const invalid = { ...input(), [field]: value } as unknown as Parameters<
          typeof createUnit
        >[1];
        await expect(run((tx) => createUnit(tx, invalid, "en"))).rejects.toMatchObject({
          code: "unit.invalid",
          params: { field },
        });
        expect(await suite.db.select().from(units)).toEqual([]);
        const saved = await run((tx) => createUnit(tx, input(), "en"));
        if (value !== undefined) {
          await expect(
            run((tx) =>
              updateUnit(
                tx,
                saved.id,
                { [field]: value } as Parameters<typeof updateUnit>[2],
                "en",
              ),
            ),
          ).rejects.toMatchObject({ code: "unit.invalid", params: { field } });
          expect(await run((tx) => getUnit(tx, saved.id))).toEqual(saved);
        }
      },
    );
  }

  it("trims staff fields and accepts the 4096-byte boundary without copying translations", async () => {
    const saved = await run((tx) =>
      createUnit(
        tx,
        { ...input(), staffName: `  ${"é".repeat(2048)}  `, staffAbbreviation: " kg " },
        "en",
      ),
    );
    expect(saved).toEqual({ id: expect.any(String), ...input(), staffName: "é".repeat(2048) });
  });

  it.each(["name", "abbreviation"] as const)(
    "refuses null %s maps and leaves the stored unit intact",
    async (field) => {
      const saved = await run((tx) => createUnit(tx, input(), "en"));
      await expect(
        run((tx) =>
          updateUnit(
            tx,
            saved.id,
            { [field]: null } as unknown as Parameters<typeof updateUnit>[2],
            "en",
          ),
        ),
      ).rejects.toMatchObject({ code: "content.translation_invalid", params: {} });
      expect(await run((tx) => getUnit(tx, saved.id))).toEqual(saved);
    },
  );

  it("requires both staff columns at storage without translation defaults", async () => {
    await expect(
      run((tx) =>
        tx.execute(
          sql`insert into units (id, name, abbreviation, precision) values ('missing-staff', '{"es":"Kilogramo"}', '{"es":"kg"}', 3)`,
        ),
      ),
    ).rejects.toMatchObject({
      errcode: 1299,
      message: "NOT NULL constraint failed: units.staff_name",
    });
    await expect(
      run((tx) =>
        tx.execute(
          sql`insert into units (id, staff_name, name, abbreviation, precision) values ('missing-abbr', 'Kilogramo', '{}', '{}', 3)`,
        ),
      ),
    ).rejects.toMatchObject({
      errcode: 1299,
      message: "NOT NULL constraint failed: units.staff_abbreviation",
    });
    expect(await suite.db.select().from(units)).toEqual([]);
  });
});

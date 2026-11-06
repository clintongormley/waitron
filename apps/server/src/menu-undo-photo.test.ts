import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  CATALOGUE_MIGRATIONS,
  createCatalogue,
  createProduct,
  previewMenu,
  publishMenu,
  readMenuStructure,
  sections,
  updateSection,
} from "@waitron/catalogue";
import { createCategory } from "@waitron/catalogue/src/categories.js";
import { menuChangeActions } from "@waitron/catalogue/src/menu-undo.js";
import { updateMenuItem } from "@waitron/catalogue/src/operations.js";
import { addMember, createSectionIn } from "@waitron/catalogue/src/sections.js";
import { seedLegacySellingUnits, seedVenueWithSeries } from "@waitron/catalogue/test/fixtures.js";
import { offerOf } from "@waitron/catalogue/test/menus-fixture.js";
import { MEDIA_MIGRATIONS, mediaImages } from "@waitron/media";

// The catalogue's own test database has no media tables, so it cannot store a section photo
// (`mediaImageExists`); this case needs them.
const PHOTO = `${"a".repeat(64)}.jpg`;

const fx = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, MEDIA_MIGRATIONS] });
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

/** Dinner holds Mains, which holds Burger; Lunch holds Soup. */
async function twoMenus() {
  await seedVenueWithSeries(fx.db);
  await seedLegacySellingUnits(fx.db);
  return app(async (tx) => {
    const categoryId = (await createCategory(tx, { name: "Food" })).id;
    const dinner = (await createCatalogue(tx, { name: "Dinner Menu" })).id;
    const lunch = (await createCatalogue(tx, { name: "Lunch Menu" })).id;
    const make = async (name: string) =>
      (
        await createProduct(tx, {
          catalogueId: dinner,
          categoryId,
          name,
          pricingUnit: "each",
          unitPrice: "12.00",
          vatClass: "reduced",
          allergens: {},
        })
      ).id;
    const burger = await make("Burger");
    const soup = await make("Soup");
    const mains = (
      await createSectionIn(tx, (await readMenuStructure(tx, dinner)).rootSectionId, {
        internalName: "Mains",
        names: { en: "Main courses" },
      })
    ).id;
    await addMember(tx, mains, { kind: "product", productId: burger });
    await addMember(tx, (await readMenuStructure(tx, lunch)).rootSectionId, {
      kind: "product",
      productId: soup,
    });
    return { dinner, lunch, mains, burger };
  });
}

it("puts back an own section's photo added since publishing, through the section save", async () => {
  const f = await twoMenus();
  await fx.db.insert(mediaImages).values({ filename: PHOTO, names: { en: "Plates" } });
  const { hash } = await app((tx) => previewMenu(tx, f.dinner));
  await app((tx) => publishMenu(tx, f.dinner, hash, "person-1"));
  await app((tx) => updateSection(tx, f.mains, { image: PHOTO }));
  await app(async (tx) =>
    updateMenuItem(tx, f.dinner, await offerOf(tx, f.dinner, f.burger), { grossPrice: "13.50" }),
  );
  const lunchBefore = await app((tx) => previewMenu(tx, f.lunch));

  const before = await app((tx) => previewMenu(tx, f.dinner));
  const change = before.changes.find(
    (found) => found.kind === "section_changed" && found.sectionId === f.mains,
  )!;
  const action = menuChangeActions({ preview: before, languages: ["en"] }).get(change.id);
  expect(action).toEqual({
    kind: "undo",
    command: { method: "updateSection", sectionId: f.mains, patch: { image: null }, name: "Mains" },
  });
  const { sectionId, patch } = (action as { command: { sectionId: string; patch: object } })
    .command;
  await app((tx) => updateSection(tx, sectionId, patch));

  const after = await app((tx) => previewMenu(tx, f.dinner));
  expect(after.changes.map(({ id }) => id)).not.toContain(change.id);
  const others = before.changes.filter(({ id }) => id !== change.id);
  expect(others.length).toBeGreaterThan(0);
  expect(after.changes).toEqual(others);
  expect((await app((tx) => previewMenu(tx, f.lunch))).changes).toEqual(lunchBefore.changes);
  const [row] = await fx.db
    .select({ names: sections.names, color: sections.color, image: sections.image })
    .from(sections)
    .where(eq(sections.id, f.mains));
  expect(row).toEqual({ names: { en: "Main courses" }, color: null, image: null });
});

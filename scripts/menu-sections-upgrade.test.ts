import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { table, id, count } from "../packages/db/src/schema/columns.js";
import { menuItems } from "../packages/catalogue/src/schema/menu.js";
import { menuItemVariantOverrides } from "../packages/catalogue/src/schema/variant-overrides.js";
import { setProductVariants } from "../packages/catalogue/src/variants.js";
import { withTransaction } from "../packages/db/src/tenancy.js";
import { seedTenant } from "../packages/db/src/testing/seed.js";
import { seedLegacySellingUnits } from "../packages/catalogue/test/fixtures.js";
import { createProduct } from "../packages/catalogue/src/operations.js";
import { buildMenuDocument, menuDocumentHash } from "../packages/catalogue/src/menu-document.js";
import { publishMenu } from "../packages/catalogue/src/menu-publication.js";
import { openVenueDatabase } from "../packages/db/src/client.js";
import { applyMigrations } from "../packages/migrations/src/apply.js";
import {
  migrationOptionsFor,
  resolveMigrationsFolder,
} from "../packages/migrations/src/manifest.js";
import { orderedMigrationSets } from "../packages/module/src/module.js";
import { scratchParent } from "./scratch-dir.mjs";

const oldMembers = table("section_members", {
  id: id("id"),
  sectionId: id("section_id"),
  position: count("position"),
  productId: id("product_id"),
});

// Checks one populated venue shape; it does not establish that a later sections rebuild carries rows.
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const sets = orderedMigrationSets(ALL_MODULES);
async function stage(control = false) {
  const root = mkdtempSync(join(scratchParent(), "wt-menu-sections-upgrade-"));
  scratch.push(root);
  const staged = join(root, "migrations");
  const journals = new Map<string, { entries: { tag: string }[] }>();
  for (const set of sets) {
    const source = resolveMigrationsFolder(set, null);
    cpSync(source, join(staged, set.name), { recursive: true });
    const journal = JSON.parse(readFileSync(join(source, "meta", "_journal.json"), "utf8"));
    journals.set(set.name, journal);
    if (set.name === "catalogue" || set.name === "media") {
      const marker =
        set.name === "catalogue" ? "sections_owned_prepare" : "recreate_section_image_triggers";
      const cut = journal.entries.findIndex((entry: { tag: string }) => entry.tag.endsWith(marker));
      expect(cut, `${set.name} has its upgrade entry`).toBeGreaterThan(0);
      writeFileSync(
        join(staged, set.name, "meta", "_journal.json"),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut) }),
      );
    }
  }
  const venueDir = join(root, "venue");
  await applyMigrations(venueDir, migrationOptionsFor(sets, staged));
  const store = await openVenueDatabase(venueDir);
  try {
    await seedTenant(store.venue);
    await seedLegacySellingUnits(store.venue);
    store.venue.run(
      "insert into catalogues(id,name,created_at,updated_at) values ('menu','Lunch','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')",
    );
    store.venue.run(
      "insert into sections(id,internal_name,role,owner_menu_id) values ('root','Lunch','menu_root','menu'),('home','Home','home_layout','menu'),('library','Drinks','library',null)",
    );
    store.venue.run(
      "insert into menu_details(menu_id,root_section_id,default_home_layout_id) values ('menu','root','home')",
    );
    store.venue.run(
      "insert into media_images(id,filename,names,created_at,updated_at) values ('photo','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg','{}','2026-10-01','2026-10-01')",
    );
    store.venue.run(
      "update sections set image = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg' where id = 'library'",
    );
    const soup = await withTransaction(store.venue, (tx) =>
      createProduct(tx, {
        catalogueId: "menu",
        categoryId: null,
        name: "Soup staff",
        customerName: { en: "Soup guest" },
        kitchenName: "SOUP",
        pricingUnit: "each",
        unitPrice: "5",
        vatClass: "general",
      }),
    );
    await store.venue
      .insert(oldMembers)
      .values({ id: "soup-placement", sectionId: "root", position: 1, productId: soup.id });
    await store.venue
      .insert(menuItems)
      .values({ id: "soup-offer", menuId: "menu", productId: soup.id });
    const [variant] = await withTransaction(store.venue, (tx) =>
      setProductVariants(
        tx,
        soup.id,
        [
          {
            name: "Half soup",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "3",
            available: true,
          },
        ],
        "en",
      ),
    );
    await store.venue.insert(menuItemVariantOverrides).values({
      menuItemId: "soup-offer",
      productId: soup.id,
      variantId: variant!.id,
      price: 275,
      offered: true,
    });
    store.venue.run(
      "insert into section_members(id,section_id,position,child_section_id) values ('library-placement','root',0,'library'),('tile','home',0,'root')",
    );
  } finally {
    await store.close();
  }
  for (const [name, journal] of journals)
    writeFileSync(join(staged, name, "meta", "_journal.json"), JSON.stringify(journal));
  if (control) {
    const entry = journals
      .get("catalogue")!
      .entries.find((e) => e.tag.endsWith("sections_owned_prepare"))!;
    const path = join(staged, "catalogue", `${entry.tag}.sql`);
    const sql = readFileSync(path, "utf8")
      .split("--> statement-breakpoint")
      .filter(
        (statement) =>
          !/CREATE TABLE __keep_|DELETE FROM menu_details|DELETE FROM section_members/.test(
            statement,
          ),
      )
      .map((statement) => statement.trim())
      .filter(Boolean)
      .join(";--> statement-breakpoint\n");
    writeFileSync(path, sql);
  }
  return { venueDir, staged };
}
it("keeps menu details and a home tile across the rebuild, removes the library, and reinstalls media guards", async () => {
  const { venueDir, staged } = await stage();
  await applyMigrations(venueDir, migrationOptionsFor(sets, staged));
  const store = await openVenueDatabase(venueDir);
  try {
    expect(store.venue.all("select id from section_members order by id")).toEqual([
      { id: "soup-placement" },
      { id: "tile" },
    ]);
    expect(store.venue.all("select menu_id from menu_details")).toEqual([{ menu_id: "menu" }]);
    expect(store.venue.all("select role from sections order by role")).toEqual([
      { role: "home_layout" },
      { role: "menu_root" },
    ]);
    expect(
      store.venue.all(
        "select name from sqlite_master where type='trigger' and name like 'sections_media_image_fk_%' order by name",
      ),
    ).toEqual(
      ["insert", "parent_delete", "parent_rename", "update"].map((suffix) => ({
        name: `sections_media_image_fk_${suffix}`,
      })),
    );
    expect(
      store.venue.all("select menu_item_id,price,offered from menu_item_variant_overrides"),
    ).toEqual([{ menu_item_id: "soup-offer", price: 275, offered: 1 }]);
    expect(store.venue.all("pragma foreign_key_check")).toEqual([]);
    expect(store.venue.all("select name from sqlite_master where name like '__keep_%'")).toEqual(
      [],
    );
    const { document } = await withTransaction(store.venue, (tx) => buildMenuDocument(tx, "menu"));
    expect(
      await withTransaction(store.venue, (tx) =>
        publishMenu(tx, "menu", menuDocumentHash(document), "manager"),
      ),
    ).toMatchObject({ number: 1 });
    expect(() =>
      store.venue.run(
        "insert into sections(id,internal_name,role,owner_menu_id,image) values ('invalid','Invalid','section','menu','nowhere.jpg')",
      ),
    ).toThrow(
      expect.objectContaining({
        cause: expect.objectContaining({
          message: expect.stringContaining("sections_media_image_fk"),
        }),
      }),
    );
  } finally {
    await store.close();
  }
});
it("refuses the same populated upgrade without the carry and rolls its journal back", async () => {
  const { venueDir, staged } = await stage(true);
  const store = await openVenueDatabase(venueDir);
  const before = store.venue.all("select * from __drizzle_migrations_catalogue");
  await store.close();
  await expect(applyMigrations(venueDir, migrationOptionsFor(sets, staged))).rejects.toMatchObject({
    cause: expect.objectContaining({
      cause: expect.objectContaining({
        message: expect.stringContaining("FOREIGN KEY constraint failed"),
      }),
    }),
  });
  const after = await openVenueDatabase(venueDir);
  try {
    expect(after.venue.all("select * from __drizzle_migrations_catalogue")).toEqual(before);
  } finally {
    await after.close();
  }
});

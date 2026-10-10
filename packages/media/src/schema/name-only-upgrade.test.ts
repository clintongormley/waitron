import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CATALOGUE_MIGRATIONS,
  menuPublications,
  menuVersionImages,
  menuVersions,
  sections,
} from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  installChangeFeed,
  openVenueDatabase,
  products,
  type Database,
  type VenueDatabase,
} from "@waitron/db";
import { applyMigrations, type VenueMigrationOptions } from "@waitron/migrations";
import { MEDIA_MIGRATIONS } from "../migrations.js";
import { MEDIA_CHANGE_SOURCES } from "../module.js";

/**
 * A venue migrated to media's `0004` and holding photos, upgraded through `applyMigrations` to
 * `0007`, past the migration that drops `alt_text` and `labels`. The rows are written BEFORE that
 * migration runs, because the table rebuild it carries is what could lose them.
 *
 */

const BEFORE = "0004_drop_category_image_triggers";
const UPGRADED = "0007_recreate_product_image_triggers";

const photo = (digit: string) => `${digit.repeat(64)}.jpg`;
const PRODUCT_PHOTO = photo("1");
const SECTION_PHOTO = photo("2");
const MENU_PHOTO = photo("3");
const UNUSED_PHOTO = photo("4");
const ABSENT = photo("f");
const PHOTOS = [PRODUCT_PHOTO, SECTION_PHOTO, MENU_PHOTO, UNUSED_PHOTO];

interface Snapshot {
  rows: unknown[];
  bytes: unknown[];
  triggers: unknown[];
}

let root: string | undefined;
let store: VenueDatabase | undefined;
let before: Snapshot;
let after: Snapshot;
let catalogueId: string;

const db = (): Database => store!.venue;

function setsUpTo(mediaFolder: string): VenueMigrationOptions[] {
  return [
    CORE_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    { ...MEDIA_MIGRATIONS, migrationsFolder: mediaFolder },
  ];
}

/** Media's folder as it stood at `tag`: the same files, with the journal cut there. */
function stageMediaAt(into: string, tag: string): string {
  const folder = join(into, `media-${tag}`);
  cpSync(MEDIA_MIGRATIONS.migrationsFolder, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  const cut = journal.entries.findIndex((entry) => entry.tag === tag);
  if (cut === -1) throw new Error(`media's journal has no ${tag}`);
  writeFileSync(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, cut + 1) }),
  );
  return folder;
}

async function snapshot(database: Database): Promise<Snapshot> {
  const rows = await database.execute(
    sql`select id, filename, names, created_at, updated_at from media_images order by filename`,
  );
  const bytes = await database.execute(
    sql`select image_id, hex(bytes) as bytes from media_image_data order by image_id`,
  );
  const triggers = await database.execute(sql`
    select name, tbl_name, sql from sqlite_master
    where type = 'trigger' and sql like '%media_images%' and name not glob 'waitron_change_*'
    order by name`);
  return { rows: rows.rows, bytes: bytes.rows, triggers: triggers.rows };
}

async function seed(database: Database): Promise<void> {
  for (const [index, filename] of PHOTOS.entries()) {
    const id = `photo-${index}`;
    await database.execute(sql`
      insert into media_images (id, filename, names, alt_text, labels, created_at, updated_at)
      values (${id}, ${filename}, ${JSON.stringify({ en: `Photo ${index}` })},
              ${JSON.stringify({ en: `Alt ${index}` })}, ${JSON.stringify(["label"])},
              ${`2026-09-0${index + 1}T10:00:00.000Z`}, ${`2026-09-1${index}T10:00:00.000Z`})`);
    await database.execute(
      sql`insert into media_image_data (image_id, bytes) values (${id}, ${new Uint8Array([index, 0xff, index * 7, 0])})`,
    );
  }
  const [catalogue] = await database
    .insert(catalogues)
    .values({ name: "Lunch" })
    .returning({ id: catalogues.id });
  catalogueId = catalogue!.id;
  await database.insert(products).values({
    catalogueId,
    name: "Bread",
    pricingUnit: "each",
    unitPrice: 200,
    vatClass: "general",
    image: PRODUCT_PHOTO,
  });
  await database
    .insert(sections)
    .values({ internalName: "Bakery", ownerMenuId: catalogueId, image: SECTION_PHOTO });
  const publishedAt = new Date("2026-09-20T10:00:00.000Z");
  const [version] = await database
    .insert(menuVersions)
    .values({
      menuId: catalogueId,
      number: 1,
      document: {} as never,
      contentHash: "hash",
      publishedAt,
      publishedBy: "person-1",
    })
    .returning({ id: menuVersions.id });
  const versionId = version!.id;
  await database.insert(menuVersionImages).values({ versionId, filename: MENU_PHOTO });
  await database.insert(menuPublications).values({ menuId: catalogueId, versionId, publishedAt });
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "wt-media-name-only-"));
  const venueDir = join(root, "venue");
  await applyMigrations(venueDir, setsUpTo(stageMediaAt(root, BEFORE)));
  const old = await openVenueDatabase(venueDir);
  try {
    await seed(old.venue);
    before = await snapshot(old.venue);
    // What a box's boot leaves on the table; `applyMigrations` removes it before migrating.
    await installChangeFeed(old.venue, MEDIA_CHANGE_SOURCES);
  } finally {
    await old.close();
  }
  await applyMigrations(venueDir, setsUpTo(stageMediaAt(root, UPGRADED)));
  store = await openVenueDatabase(venueDir);
  after = await snapshot(store.venue);
});

afterAll(async () => {
  if (store !== undefined) await store.close();
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

async function imageExists(filename: string): Promise<boolean> {
  const rows = await db().execute(sql`select 1 from media_images where filename = ${filename}`);
  return rows.rows.length === 1;
}

/** Read by the photo's id, which outlives its `media_images` row. */
async function bytesFor(filename: string): Promise<number> {
  const id = `photo-${PHOTOS.indexOf(filename)}`;
  const rows = await db().execute<{ n: number }>(
    sql`select count(*) as n from media_image_data where image_id = ${id}`,
  );
  return rows.rows[0]!.n;
}

const remove = async (filename: string): Promise<void> => {
  await db().execute(sql`delete from media_images where filename = ${filename}`);
};
const rename = async (filename: string): Promise<void> => {
  await db().execute(
    sql`update media_images set filename = ${ABSENT} where filename = ${filename}`,
  );
};

describe("upgrading a venue to photos with a name only", () => {
  it("drops the alt text and labels columns", async () => {
    const columns = await db().execute<{ name: string }>(
      sql`select name from pragma_table_info('media_images') order by cid`,
    );
    expect(columns.rows.map((column) => column.name)).toEqual([
      "id",
      "filename",
      "names",
      "created_at",
      "updated_at",
    ]);
  });

  it("keeps every photo's row and bytes", () => {
    expect(before.rows).toHaveLength(PHOTOS.length);
    expect(before.bytes).toHaveLength(PHOTOS.length);
    expect(after.rows).toEqual(before.rows);
    expect(after.bytes).toEqual(before.bytes);
  });

  it("puts back every trigger that names media_images, word for word", () => {
    expect(before.triggers).toHaveLength(11);
    expect(after.triggers).toEqual(before.triggers);
  });

  it("keeps the table's indexes", async () => {
    const indexes = await db().execute<{ name: string }>(sql`
      select name from sqlite_master
      where type = 'index' and tbl_name = 'media_images' and name not glob 'sqlite_*'
      order by name`);
    expect(indexes.rows.map((index) => index.name)).toEqual([
      "media_images_date_idx",
      "media_images_filename_key",
    ]);
  });

  it("still refuses names that are not an object, and accepts names that are", async () => {
    const insert = async (filename: string, names: string): Promise<void> => {
      await db().execute(sql`
        insert into media_images (id, filename, names, created_at, updated_at)
        values (${filename}, ${filename}, ${names}, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`);
    };
    await expect(insert(photo("a"), "[]")).rejects.toMatchObject({
      message: expect.stringContaining("media_images_names_ck"),
    });
    await insert(photo("b"), "{}");
    expect(await imageExists(photo("b"))).toBe(true);
  });

  it("lets an unused photo go, and its bytes with it", async () => {
    expect(await bytesFor(UNUSED_PHOTO)).toBe(1);
    await remove(UNUSED_PHOTO);
    expect(await imageExists(UNUSED_PHOTO)).toBe(false);
    expect(await bytesFor(UNUSED_PHOTO)).toBe(0);
  });
});

describe("after the upgrade, a product's photo", () => {
  it("cannot be deleted or renamed while the product names it", async () => {
    await expect(remove(PRODUCT_PHOTO)).rejects.toMatchObject({
      message: "products_media_image_fk",
    });
    await expect(rename(PRODUCT_PHOTO)).rejects.toMatchObject({
      message: "products_media_image_fk",
    });
    expect(await imageExists(PRODUCT_PHOTO)).toBe(true);
  });

  it("is checked on a product insert and update", async () => {
    const insert = async (image: string): Promise<void> => {
      await db().insert(products).values({
        catalogueId,
        name: "Roll",
        pricingUnit: "each",
        unitPrice: 100,
        vatClass: "general",
        image,
      });
    };
    await expect(insert(ABSENT)).rejects.toMatchObject({ message: "products_media_image_fk" });
    await insert(PRODUCT_PHOTO);
    await expect(async () => {
      await db().execute(sql`update products set image = ${ABSENT} where name = 'Roll'`);
    }).rejects.toMatchObject({ message: "products_media_image_fk" });
  });

  it("can be deleted once no product names it", async () => {
    await db().execute(sql`update products set image = null where image = ${PRODUCT_PHOTO}`);
    expect(await bytesFor(PRODUCT_PHOTO)).toBe(1);
    await remove(PRODUCT_PHOTO);
    expect(await imageExists(PRODUCT_PHOTO)).toBe(false);
    expect(await bytesFor(PRODUCT_PHOTO)).toBe(0);
  });
});

describe("after the upgrade, a section's photo", () => {
  it("cannot be deleted or renamed while the section names it", async () => {
    await expect(remove(SECTION_PHOTO)).rejects.toMatchObject({
      message: "sections_media_image_fk",
    });
    await expect(rename(SECTION_PHOTO)).rejects.toMatchObject({
      message: "sections_media_image_fk",
    });
    expect(await imageExists(SECTION_PHOTO)).toBe(true);
  });

  it("is checked on a section insert and update", async () => {
    const insert = async (image: string): Promise<void> => {
      await db()
        .insert(sections)
        .values({ internalName: "Drinks", ownerMenuId: catalogueId, image });
    };
    await expect(insert(ABSENT)).rejects.toMatchObject({ message: "sections_media_image_fk" });
    await insert(SECTION_PHOTO);
    await expect(async () => {
      await db().execute(sql`update sections set image = ${ABSENT} where internal_name = 'Drinks'`);
    }).rejects.toMatchObject({ message: "sections_media_image_fk" });
  });

  it("can be deleted once no section names it", async () => {
    await db().execute(sql`update sections set image = null where image = ${SECTION_PHOTO}`);
    expect(await bytesFor(SECTION_PHOTO)).toBe(1);
    await remove(SECTION_PHOTO);
    expect(await imageExists(SECTION_PHOTO)).toBe(false);
    expect(await bytesFor(SECTION_PHOTO)).toBe(0);
  });
});

describe("after the upgrade, a photo the live menu version names", () => {
  it("cannot be deleted or renamed", async () => {
    await expect(remove(MENU_PHOTO)).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    await expect(rename(MENU_PHOTO)).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    expect(await imageExists(MENU_PHOTO)).toBe(true);
  });

  it("is checked when a version names a photo", async () => {
    const [draft] = await db()
      .insert(menuVersions)
      .values({
        menuId: catalogueId,
        number: 2,
        document: {} as never,
        contentHash: "hash-2",
        publishedAt: new Date("2026-09-21T10:00:00.000Z"),
        publishedBy: "person-1",
      })
      .returning({ id: menuVersions.id });
    const insert = async (filename: string): Promise<void> => {
      await db().insert(menuVersionImages).values({ versionId: draft!.id, filename });
    };
    await expect(insert(ABSENT)).rejects.toMatchObject({
      message: "menu_version_images_media_image_fk",
    });
    await insert(MENU_PHOTO);
    const rows = await db().execute<{ n: number }>(
      sql`select count(*) as n from menu_version_images where version_id = ${draft!.id}`,
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("can be deleted once the live version no longer names it", async () => {
    const [next] = await db()
      .insert(menuVersions)
      .values({
        menuId: catalogueId,
        number: 3,
        document: {} as never,
        contentHash: "hash-3",
        publishedAt: new Date("2026-09-22T10:00:00.000Z"),
        publishedBy: "person-1",
      })
      .returning({ id: menuVersions.id });
    await db()
      .update(menuPublications)
      .set({ versionId: next!.id })
      .where(sql`${menuPublications.menuId} = ${catalogueId}`);
    expect(await bytesFor(MENU_PHOTO)).toBe(1);
    await remove(MENU_PHOTO);
    expect(await imageExists(MENU_PHOTO)).toBe(false);
    expect(await bytesFor(MENU_PHOTO)).toBe(0);
  });
});

describe("then upgrading to the end of media's folder", () => {
  const REWRITTEN = [
    "menu_version_images_media_image_fk_parent_delete",
    "menu_version_images_media_image_fk_parent_rename",
  ];
  const LIVE_CLAUSE =
    "JOIN menu_publications ON menu_publications.version_id = menu_version_images.version_id";
  const QUEUED_JOIN =
    "JOIN menu_scheduled_publications ON menu_scheduled_publications.version_id = menu_version_images.version_id";
  const QUEUED_STATE = "menu_scheduled_publications.state = 'queued'";
  const ADDED = [
    "section_members_media_image_fk_insert",
    "section_members_media_image_fk_parent_delete",
    "section_members_media_image_fk_parent_rename",
    "section_members_media_image_fk_update",
  ];
  type Trigger = { name: string; sql: string };
  let latest: Trigger[];

  beforeAll(async () => {
    const venueDir = join(root!, "venue");
    await store!.close();
    store = undefined;
    await applyMigrations(venueDir, setsUpTo(MEDIA_MIGRATIONS.migrationsFolder));
    store = await openVenueDatabase(venueDir);
    latest = (await snapshot(store.venue)).triggers as Trigger[];
  });

  it("leaves the other nine triggers word for word", () => {
    const untouched = (triggers: unknown[]) =>
      (triggers as Trigger[]).filter((trigger) => !REWRITTEN.includes(trigger.name));
    expect(untouched(after.triggers)).toHaveLength(9);
    expect(untouched(latest).filter((trigger) => !ADDED.includes(trigger.name))).toEqual(
      untouched(after.triggers),
    );
  });

  it("adds the four include-folder image triggers", () => {
    for (const name of ADDED) {
      const trigger = latest.find((each) => each.name === name);
      expect(trigger?.sql).toContain("folder_overrides");
      if (name.endsWith("_insert") || name.endsWith("_update"))
        expect(trigger?.sql).toContain("json_extract");
      else expect(trigger?.sql).toContain("->> '$.image'");
    }
  });

  it("gives each of the two rewritten triggers the live join, the queued join and the queued-state filter", () => {
    for (const name of REWRITTEN) {
      const trigger = latest.find((each) => each.name === name);
      expect(trigger?.sql).toContain(LIVE_CLAUSE);
      expect(trigger?.sql).toContain(QUEUED_JOIN);
      expect(trigger?.sql).toContain(QUEUED_STATE);
    }
  });
});

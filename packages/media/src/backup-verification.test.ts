import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, catalogues } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  sections,
  sectionMembers,
  CATALOGUE_MIGRATIONS,
  menuVersions,
  menuVersionImages,
  menuDocumentHash,
  type MenuDocument,
} from "@waitron/catalogue";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { openBackupQuery } from "@waitron/store";
import {
  validateBackupVerificationContribution,
  validateBackupModuleResult,
} from "@waitron/module";
import { MEDIA_BACKUP_VERIFICATION as OWNER, MEDIA_MODULE, MEDIA_CLASSIFICATION } from "./index.js";
import { MEDIA_MIGRATIONS } from "./migrations.js";
import { mediaImages, mediaImageData, mediaImageBlobs, mediaImageEdits } from "./schema/images.js";
import { sampleImage } from "./testing/sample-image.js";
const migrations = [
  CORE_MIGRATIONS,
  CATALOGUE_MIGRATIONS,
  VENUE_SERVICE_MIGRATIONS,
  MEDIA_MIGRATIONS,
];
const original = useVenueDb({ migrations });
const restored = useVenueDb({ migrations });
const absent = useVenueDb({
  migrations: [CORE_MIGRATIONS],
});
const id = "10000000-0000-4000-8000-000000000001";
const menu = "10000000-0000-4000-8000-000000000002";
const version = "10000000-0000-4000-8000-000000000003";
const bytes = await sampleImage({ width: 8, height: 6, format: "webp" });
const hash = createHash("sha256").update(bytes).digest("hex");
const filename = hash + ".webp";
const replacement = await sampleImage({ width: 9, height: 6, format: "webp" });
const replacementHash = createHash("sha256").update(replacement).digest("hex");
const stamp = new Date("2026-10-20T08:00:00.000Z");
const passed = { status: "passed", checks: [{ code: "data", status: "passed" }] };
beforeEach(async () => {
  for (const suite of [original, restored]) {
    await suite.db
      .insert(mediaImages)
      .values({ id, filename, names: { en: "Bread" }, createdAt: stamp, updatedAt: stamp });
    await suite.db.insert(mediaImageData).values({ imageId: id, bytes });
    await suite.db.insert(mediaImageBlobs).values({ hash: replacementHash, bytes: replacement });
    await suite.db
      .insert(mediaImageEdits)
      .values({ imageId: id, sourceHash: replacementHash, revision: 2 });
  }
});
async function run(missingBefore = false, sourceSchema = 1) {
  const path = (suite: typeof original) =>
    suite.db
      .all<{ file: string }>(sql`pragma database_list`)
      .find((row) => row.file.endsWith("venue.db"))!.file;
  const before = await openBackupQuery(path(missingBefore ? absent : original));
  try {
    const after = await openBackupQuery(path(restored));
    try {
      return await OWNER.verifyRestoredData({
        before: before.query,
        after: after.query,
        entries: {
          async read() {
            throw new Error("No non-database inputs declared");
          },
        },
        source: {
          nodeId: "source-node",
          locationId: "source-location",
          environment: "preproduction",
          createdAt: "2026-10-20T08:00:00.000Z",
        },
        sourceSchema,
        targetSchema: 1,
        signal: new AbortController().signal,
      });
    } finally {
      await after.close();
    }
  } finally {
    await before.close();
  }
}
async function corrupt(suite: typeof original, statement: string) {
  const triggers = suite.db.all<{ sql: string }>(
    sql`select sql from sqlite_schema where type='trigger'`,
  );
  for (const row of suite.db.all<{ name: string }>(
    sql`select name from sqlite_schema where type='trigger'`,
  ))
    suite.db.run(sql.raw(`drop trigger "${row.name.replaceAll('"', '""')}"`));
  suite.db.run(sql`pragma foreign_keys=off`);
  suite.db.run(sql`pragma ignore_check_constraints=on`);
  try {
    suite.db.run(sql.raw(statement));
  } finally {
    suite.db.run(sql`pragma ignore_check_constraints=off`);
    suite.db.run(sql`pragma foreign_keys=on`);
    for (const row of triggers) suite.db.run(sql.raw(row.sql));
  }
}

describe("media backup evidence", () => {
  it("checks image bytes blobs edits and stored digests", async () => {
    expect(await run()).toEqual(passed);
  });
  it.each([
    "update media_image_data set bytes=x'1234'",
    "update media_image_blobs set bytes=x'1234'",
    "delete from media_image_data",
    "delete from media_image_blobs",
    "update media_image_edits set revision=3",
    `update media_images set names='{"en":"Other"}'`,
  ])("retains all source state: %s", async (statement) => {
    await corrupt(restored, statement);
    expect((await run()).status).toBe("invalid");
  });
  it.each([
    "update media_image_data set bytes=x'1234'",
    "update media_image_blobs set bytes=x'1234'",
    "delete from media_image_data",
    "delete from media_image_blobs",
    "update media_image_data set image_id='missing'",
    "update media_image_edits set image_id='missing'",
    "update media_image_edits set focus_x=10001",
    "update media_image_edits set zoom=99",
    "update media_image_edits set revision=0",
    "update media_image_edits set original_filename=char(0)",
    "update media_images set names='null'",
    "update media_images set names='broken'",
    "update media_images set names='[]'",
    `update media_images set names='{"en":7}'`,
    "update media_images set names=x'7b7d'",
    "update media_image_edits set focus_y=-1",
    "update media_image_edits set focus_x=0.5",
    "update media_image_edits set zoom=401",
    "update media_image_edits set revision=9007199254740992",
    "update media_image_edits set original_filename=x'61'",
    "update media_image_edits set original_filename='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'",
    "insert into media_image_data values ('missing',x'1234')",
    "update media_images set filename='broken.webp'",
  ])("checks invalid source and restored state: %s", async (statement) => {
    for (const suite of [original, restored]) await corrupt(suite, statement);
    expect((await run()).status).toBe("invalid");
  });
  it.each(["jpg", "png"] as const)("accepts authentic retained %s bytes", async (extension) => {
    const data = await sampleImage({
      width: 11,
      height: 6,
      format: extension === "jpg" ? "jpeg" : "png",
    });
    const name = createHash("sha256").update(data).digest("hex") + "." + extension;
    for (const suite of [original, restored]) {
      await suite.db.insert(mediaImages).values({
        id: menu,
        filename: name,
        names: { en: "Soup" },
        createdAt: stamp,
        updatedAt: stamp,
      });
      await suite.db.insert(mediaImageData).values({ imageId: menu, bytes: data });
    }
    expect(await run()).toEqual(passed);
  });
  it("current configuration requires a photo identity even when its bytes survive as a blob", async () => {
    for (const suite of [original, restored]) {
      await suite.db.insert(catalogues).values({ id: menu, name: "Menu" });
      await suite.db.insert(sections).values({
        id: menu,
        ownerMenuId: menu,
        internalName: "Section",
        names: { en: "Section" },
        image: filename,
      });
    }
    expect(await run()).toEqual(passed);
    for (const suite of [original, restored])
      await corrupt(suite, `update sections set image='${replacementHash}.webp'`);
    expect((await run()).status).toBe("invalid");
  });
  it.each([
    [{}, "passed"],
    [{ image: null }, "passed"],
    [{ image: filename }, "passed"],
    [{ image: "missing.webp" }, "invalid"],
    [{ image: 42 }, "invalid"],
    [[], "invalid"],
  ] as const)("checks retained folder picture configuration %j", async (value, want) => {
    for (const suite of [original, restored]) {
      await suite.db.insert(catalogues).values({ id: menu, name: "Menu" });
      await suite.db
        .insert(sections)
        .values({ id: menu, ownerMenuId: menu, internalName: "Section", names: { en: "Section" } });
      await suite.db
        .insert(sectionMembers)
        .values({ id: version, sectionId: menu, position: 0, missingName: "Removed" });
      await corrupt(
        suite,
        `update section_members set folder_overrides='${JSON.stringify(value)}'`,
      );
    }
    expect((await run()).status).toBe(want);
  });
  it("checks valid encoded bytes against their stored digest", async () => {
    for (const suite of [original, restored])
      await corrupt(
        suite,
        `update media_image_data set bytes=x'${Buffer.from(replacement).toString("hex")}'`,
      );
    expect((await run()).status).toBe("invalid");
  });
  it("inactive media remains checked through its actual descriptor", async () => {
    expect(MEDIA_MODULE.backup?.verification).toBe(OWNER);
    await corrupt(restored, "update media_image_data set bytes=x'1234'");
    expect((await run()).status).toBe("invalid");
  });
  it("schema zero cannot hide blobs", async () => {
    await corrupt(restored, "update media_image_blobs set bytes=x'1234'");
    expect((await run(false, 0)).status).toBe("invalid");
  });
  it("checks a blob referenced only by a historical menu version", async () => {
    const document: MenuDocument = {
      format: 3,
      menuId: menu,
      menuName: "Old menu",
      root: {
        members: [
          {
            kind: "section",
            sectionId: menu,
            internalName: "History",
            names: { en: "History" },
            image: filename,
            color: null,
            members: [],
          },
        ],
      },
      offers: {},
      home: {
        shortcuts: [],
        handheld: { columns: 2, tiles: "colours", order: "home_first" },
        till: { columns: 3, tiles: "colours", order: "home_first" },
      },
    };
    for (const suite of [original, restored]) {
      await suite.db.insert(catalogues).values({ id: menu, name: "Old menu", active: false });
      await suite.db.insert(menuVersions).values({
        id: version,
        menuId: menu,
        number: 1,
        document,
        contentHash: menuDocumentHash(document),
        publishedBy: id,
        publishedAt: new Date("2026-10-20T08:00:00.000Z"),
      });
      await suite.db.insert(menuVersionImages).values({ versionId: version, filename });
      await suite.db.insert(mediaImageBlobs).values({ hash, bytes });
      for (const table of ["media_image_edits", "media_image_data", "media_images"])
        await corrupt(suite, `delete from "${table}"`);
    }
    expect(await run()).toEqual(passed);
    for (const suite of [original, restored]) await corrupt(suite, "delete from media_image_blobs");
    expect((await run()).status).toBe("invalid");
  });
  it("accepts honest absence and rejects target-only invented blobs", async () => {
    for (const table of [
      "media_image_edits",
      "media_image_data",
      "media_images",
      "media_image_blobs",
    ])
      await corrupt(restored, `delete from "${table}"`);
    expect(await run(true)).toEqual(passed);
    await restored.db.insert(mediaImageBlobs).values({ hash, bytes });
    expect((await run(true)).status).toBe("invalid");
  });
  it("declares actual database state without file or effect obligations", () => {
    const owner = validateBackupVerificationContribution(OWNER);
    expect(owner.data.tables).toEqual(MEDIA_CLASSIFICATION.map((c) => c.table));
    expect(owner.data.immutableTables).toEqual(["media_image_data", "media_image_blobs"]);
    expect([owner.secrets, owner.entries, owner.effects]).toEqual([[], [], []]);
    expect(validateBackupModuleResult(passed, owner, false)).toEqual(passed);
  });
});

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, catalogues } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery } from "@waitron/store";
import {
  validateBackupModuleResult,
  validateBackupVerificationContribution,
} from "@waitron/module";
import { CATALOGUE_BACKUP_VERIFICATION as OWNER } from "./index.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { CATALOGUE_CLASSIFICATION } from "./classification.js";
import { menuPublications, menuVersions, menuVersionImages } from "./schema/publication.js";
import { catalogueSettings } from "./schema/settings.js";
import { contentSuggestionJobs } from "./schema/suggestions.js";
import type { MenuDocument } from "./menu-document-types.js";
const migrations = [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS];
const original = useVenueDb({ migrations });
const restored = useVenueDb({ migrations });
const absent = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const menu = "10000000-0000-4000-8000-000000000001";
const version = "10000000-0000-4000-8000-000000000002";
const person = "10000000-0000-4000-8000-000000000003";
const image = "a".repeat(64) + ".webp";
const documentText = JSON.stringify({
  format: 3,
  home: {
    handheld: { columns: 2, order: "home_first", tiles: "colours" },
    shortcuts: [],
    till: { columns: 3, order: "home_first", tiles: "colours" },
  },
  menuId: menu,
  menuName: "Lunch",
  offers: {},
  root: {
    members: [
      {
        color: null,
        image,
        internalName: "Archive",
        kind: "section",
        members: [],
        names: { en: "Archive" },
        sectionId: menu,
      },
    ],
  },
});
const hash = createHash("sha256").update(documentText).digest("hex");
const passed = { status: "passed", checks: [{ code: "data", status: "passed" }] };
beforeEach(async () => {
  for (const suite of [original, restored]) {
    await suite.db.insert(catalogues).values({ id: menu, name: "Lunch" });
    await suite.db.insert(menuVersions).values({
      id: version,
      menuId: menu,
      number: 1,
      document: JSON.parse(documentText) as MenuDocument,
      contentHash: hash,
      publishedAt: new Date("2026-10-20T08:00:00.000Z"),
      publishedBy: person,
    });
    await suite.db.insert(menuVersionImages).values({ versionId: version, filename: image });
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

describe("catalogue backup evidence", () => {
  it("accepts unchanged captured catalogue", async () => {
    expect(await run()).toEqual(passed);
  });
  it("checks a live version belongs to its publication menu", async () => {
    const other = "10000000-0000-4000-8000-000000000099";
    for (const suite of [original, restored]) {
      await suite.db.insert(catalogues).values({ id: other, name: "Other" });
      await suite.db.insert(menuPublications).values({
        menuId: menu,
        versionId: version,
        publishedAt: new Date("2026-10-20T08:00:00.000Z"),
      });
    }
    expect(await run()).toEqual(passed);
    for (const suite of [original, restored])
      await corrupt(suite, `update menu_publications set menu_id='${other}'`);
    expect((await run()).status).toBe("invalid");
  });

  it("preserves every immutable menu version and image reference", async () => {
    expect(await run()).toEqual(passed);
    await corrupt(restored, "update menu_versions set published_by='changed'");
    expect((await run()).status).toBe("invalid");
  });
  it.each(["menu_versions", "menu_version_images"])("refuses missing %s history", async (table) => {
    await corrupt(restored, `delete from "${table}"`);
    expect((await run()).status).toBe("invalid");
  });
  it("compares current configuration too", async () => {
    await original.db.insert(catalogueSettings).values({ id: 1, defaultColor: "warm" });
    await restored.db.insert(catalogueSettings).values({ id: 1, defaultColor: "cool" });
    expect((await run()).status).toBe("invalid");
  });
  it.each([
    "update menu_versions set content_hash='broken'",
    "update menu_version_images set filename='missing.webp'",
    "delete from menu_version_images",
    "update menu_versions set document='{}'",
    "update menu_versions set document='{\"format\":3}'",
    "update menu_versions set document='[]'",
    "update menu_versions set document=x'7b7d'",
    "update menu_version_images set filename=x'61'",
    "update menu_versions set document='null'",
    "update menu_versions set document='not json'",
    "update menu_versions set menu_id='missing'",
    "update menu_version_images set version_id='missing'",
  ])("checks source integrity on both sides: %s", async (statement) => {
    for (const suite of [original, restored]) await corrupt(suite, statement);
    expect((await run()).status).toBe("invalid");
  });
  it("does not certify an unknown document format as corruption", async () => {
    const changed = documentText.replace('"format":3', '"format":99');
    for (const suite of [original, restored])
      await suite.db.insert(menuVersions).values({
        id: "10000000-0000-4000-8000-000000000009",
        menuId: menu,
        number: 2,
        document: JSON.parse(changed) as MenuDocument,
        contentHash: createHash("sha256").update(changed).digest("hex"),
        publishedAt: new Date("2026-10-20T08:00:00.000Z"),
        publishedBy: person,
      });
    expect((await run()).status).toBe("unsupported");
  });
  it("keeps an unsupported format inconclusive even beside broken references", async () => {
    const changed = documentText.replace('"format":3', '"format":99');
    for (const suite of [original, restored]) {
      await corrupt(suite, "update menu_version_images set version_id='missing'");
      await corrupt(suite, `update menu_versions set document='${changed}'`);
    }
    expect((await run()).status).toBe("unsupported");
  });
  it("admits only the explicit collection-column defaults from the predecessor", async () => {
    const id = "10000000-0000-4000-8000-000000000010";
    for (const suite of [original, restored])
      await suite.db.insert(contentSuggestionJobs).values({
        id,
        runId: id,
        position: 1,
        state: "running",
        sent: {},
        runTotal: 0,
        failedRefs: [],
        createdAt: "2026-10-20T08:00:00.000Z",
      });
    original.db.run(sql`alter table content_suggestion_jobs drop column collect_cursor`);
    original.db.run(sql`alter table content_suggestion_jobs drop column collected_refs`);
    try {
      expect(await run()).toEqual(passed);
      restored.db.run(sql`update content_suggestion_jobs set collected_refs='["changed"]'`);
      expect((await run()).status).toBe("invalid");
    } finally {
      original.db.run(sql`alter table content_suggestion_jobs add column collect_cursor integer`);
      original.db.run(
        sql`alter table content_suggestion_jobs add column collected_refs text not null default '[]'`,
      );
    }
  });
  it("accepts honest empty target-only data and refuses invented target state", async () => {
    await corrupt(restored, "delete from menu_version_images");
    await corrupt(restored, "delete from menu_versions");
    expect(await run(true)).toEqual(passed);
    await restored.db.insert(catalogueSettings).values({ id: 1 });
    expect((await run(true)).status).toBe("invalid");
  });
  it("declares all tables without secrets entries or effects", () => {
    const owner = validateBackupVerificationContribution(OWNER);
    expect(owner.data.tables).toEqual(CATALOGUE_CLASSIFICATION.map((c) => c.table));
    expect(owner.data.immutableTables).toEqual(["menu_versions", "menu_version_images"]);
    expect([owner.secrets, owner.entries, owner.effects]).toEqual([[], [], []]);
    expect(validateBackupModuleResult(passed, owner, false)).toEqual(passed);
  });
});

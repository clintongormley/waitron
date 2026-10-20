import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { tenants, locations, nodes, invoiceSeries, catalogues } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { migrationOptionsFor, expectedSchemaVersion } from "@waitron/migrations";
import { orderedMigrationSets, type WaitronModule } from "@waitron/module";
import { packArchive, type ArchiveEntry } from "./backup-archive.js";
import { encryptArtifact } from "./artifact-cipher.js";
import { buildManifest } from "./backup-manifest.js";
import { validateBackupArtifactFile } from "./backup-verification-archive.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { placeBackupData, placeBackupDatabase } from "./backup-data-placement.js";

const modules = ALL_MODULES.filter((m) => ["core", "catalogue"].includes(m.name));
const options = migrationOptionsFor(orderedMigrationSets(modules), null);
const catalogue = options.find((s) => s.migrationsTable === "__drizzle_migrations_catalogue")!;
const journal = JSON.parse(
  readFileSync(join(catalogue.migrationsFolder, "meta/_journal.json"), "utf8"),
) as {
  entries: { tag: string }[];
};
const boundary = journal.entries.findIndex(
  (e) => e.tag === "0034_content_suggestion_collect_cursor",
);
if (boundary < 0) throw new Error("catalogue predecessor boundary missing");
let predecessor: string | undefined;
afterAll(() => {
  if (predecessor !== undefined) rmSync(predecessor, { recursive: true, force: true });
});
try {
  predecessor = mkdtempSync(join(tmpdir(), "a850-catalogue-predecessor-"));
  cpSync(catalogue.migrationsFolder, predecessor, { recursive: true });
  writeFileSync(
    join(predecessor, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, boundary) }),
  );
} catch (error) {
  if (predecessor !== undefined) rmSync(predecessor, { recursive: true, force: true });
  throw error;
}
const node = "20000000-0000-4000-8000-000000000002";
const location = "10000000-0000-4000-8000-000000000001";
const capturedAt = "2026-10-20T08:00:00.000Z";
const suite = useVenueDb({
  migrations: options.map((s) => (s === catalogue ? { ...s, migrationsFolder: predecessor! } : s)),
  resetPerTest: false,
  setup: async (db) => {
    await db
      .insert(tenants)
      .values({ id: 1, country: "GB", taxId: "TEST-ONLY", legalName: "Placement fixture" });
    await db.insert(locations).values({
      id: location,
      name: "Placement location",
      operationDescription: "Sale",
      invoiceLocales: ["en"],
    });
    await db.insert(nodes).values({ id: node, locationId: location, name: "Placement node" });
    await db.insert(invoiceSeries).values({
      id: "30000000-0000-4000-8000-000000000003",
      nodeId: node,
      code: "KEEP",
      nextNumber: 37,
    });
    await db
      .insert(catalogues)
      .values({ id: "40000000-0000-4000-8000-000000000004", name: "Captured menu" });
    await db.run(sql`insert into menu_versions (id, menu_id, number, document, content_hash, published_at, published_by)
      values ('version-one', '40000000-0000-4000-8000-000000000004', 1, '{"original":true}', 'captured-hash', ${capturedAt}, 'operator-one')`);
    await db.run(sql`insert into content_suggestion_jobs
      (id, run_id, position, state, refusal, fits, failure, cloud_job_id, body, sent, run_total, total, done, failed, dropped, failed_refs, released, created_at, finished_at, opened_at)
      values ('job-one', 'run-one', 4, 'partly_done', null, 1, 'provider', 'remote-one', '{"original":true}', '["one","two"]', 9, 8, 5, 2, 1, '["failed-one"]', 1, ${capturedAt}, '2026-10-20T08:01:00.000Z', '2026-10-20T08:02:00.000Z')`);
    await db.run(sql`insert into content_suggestions
      (id, job_id, kind, item_id, language, text, expected, placeholder, created_at)
      values ('suggestion-one', 'job-one', 'product', 'product-one', 'en', 'New name', 'Original name', 0, ${capturedAt})`);
  },
});
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "a850-data-placement-"));
  roots.push(root);
  const stagingDir = join(root, "staging");
  const stateDir = join(root, "private-state");
  const venueDir = join(root, "private-venue");
  await mkdir(stagingDir, { mode: 0o700 });
  const source = join(root, "original.db");
  await suite.db.archiveTo(source);
  const manifest = await buildManifest({
    db: suite.db,
    modules,
    environment: "preproduction",
    now: new Date(capturedAt),
  });
  const entries: ArchiveEntry[] = [
    { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    { name: "db.dump", bytes: await readFile(source) },
    ...RECOVERY_FILES.map((name) => ({
      name: "secrets/" + name,
      bytes: Buffer.from(
        name === "trading.env"
          ? `WAITRON_TILL_NODE_ID=${node}\nWAITRON_TILL_LOCATION_ID=${location}\nWAITRON_ENV=preproduction\n`
          : `private-${name}`,
      ),
    })),
    { name: "secrets/modules.json", bytes: Buffer.from('{"disabled":[]}') },
    { name: "secrets/module-evidence/catalogue/probe.json", bytes: Buffer.from('{"kept":true}') },
    {
      name: "secrets/backup.env",
      bytes: Buffer.from(
        "WAITRON_BACKUP_DIR=/old/private/destination\nWAITRON_BACKUP_RECOVERY_KEY=private-long-enough-key\n",
      ),
    },
  ];
  const hook = vi.fn(async () => {
    throw new Error("activation attempted");
  });
  return {
    root,
    source,
    entries,
    manifest,
    stagingDir,
    stateDir,
    venueDir,
    artifactPath: join(root, "input.enc"),
    recoveryKey: "archive-key",
    migrationsRoot: null,
    environment: "preproduction" as const,
    modules: modules.map<WaitronModule>((m) => ({
      ...m,
      backup: {
        ...m.backup,
        restore: hook,
        verification: {
          ...m.backup!.verification!,
          entries: [
            ...m.backup!.verification!.entries,
            ...(m.name === "catalogue"
              ? [
                  {
                    name: "secrets/module-evidence/catalogue/probe.json",
                    presence: "optional" as const,
                  },
                ]
              : []),
          ],
        },
      },
    })),
    hook,
    log: vi.fn(),
    expected: {
      archive: {
        manifestVersion: 1,
        modules: manifest.modules,
        environment: "preproduction" as const,
        sha256: "a".repeat(64),
        bytes: 1,
      },
      capturedAt,
      sourceNodeId: node,
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function seal(f: Fixture) {
  const bytes = encryptArtifact(packArchive(f.entries), f.recoveryKey);
  await writeFile(f.artifactPath, bytes);
  return bytes;
}
function readDatabase(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const data: Record<string, unknown[]> = {};
    for (const { name } of db
      .prepare(
        "select name from sqlite_schema where type = 'table' and name not glob '__drizzle_migrations*' order by name",
      )
      .all() as { name: string }[]) {
      const table = '"' + name.replaceAll('"', '""') + '"';
      data[name] = db
        .prepare("select * from " + table)
        .all()
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return {
      data,
      jobs: db.prepare("select * from content_suggestion_jobs order by id").all(),
      suggestions: db.prepare("select * from content_suggestions order by id").all(),
      series: db.prepare("select * from invoice_series order by id").all(),
      nodes: db.prepare("select * from nodes order by id").all(),
      foreignKeys: db.prepare("pragma foreign_key_check").all(),
    };
  } finally {
    db.close();
  }
}
it("places real data and private declared material without hooks, series settlement or markers", async () => {
  const f = await fixture();
  const input = await seal(f);
  const before = readDatabase(f.source);
  const validated = await validateBackupArtifactFile(f);
  try {
    await placeBackupData(validated, f);
    expect(await readdir(f.root)).toContain("private-venue");
    const placed = readDatabase(join(f.venueDir, "venue.db"));
    expect(placed.series).toEqual(before.series);
    expect(placed.nodes).toEqual(before.nodes);
    expect(placed.suggestions).toEqual(before.suggestions);
    expect(placed.foreignKeys).toEqual([]);
    expect(f.hook).not.toHaveBeenCalled();
    expect(await readdir(f.stateDir)).toContain("trading.env");
    for (const entry of f.entries.filter(
      (e) => e.name.startsWith("secrets/") && e.name !== "secrets/backup.env",
    )) {
      const path = join(f.stateDir, entry.name.slice("secrets/".length));
      expect(await readFile(path)).toEqual(entry.bytes);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
    }
    expect((await stat(f.venueDir)).mode & 0o777).toBe(0o700);
    expect((await stat(join(f.venueDir, "venue.db"))).mode & 0o777).toBe(0o600);
    const names = await readdir(f.stateDir);
    for (const name of ["backup.env", "rebuild-first-start.json", "trading.env.replaced"]) {
      expect(names).not.toContain(name);
    }
    expect(await readFile(f.artifactPath)).toEqual(input);
    expect(readDatabase(f.source)).toEqual(before);
  } finally {
    await validated.discard();
  }
  expect(await readdir(f.stagingDir)).toEqual([]);
});
it("migrates the populated catalogue predecessor and preserves every original column and reference", async () => {
  const f = await fixture();
  const before = readDatabase(f.source);
  expect(before.jobs).toHaveLength(1);
  expect(before.jobs[0]).not.toHaveProperty("collect_cursor");
  await placeBackupDatabase(f.source, f);
  expect(await readdir(f.root)).toContain("private-venue");
  const after = readDatabase(join(f.venueDir, "venue.db"));
  expect(after.jobs).toEqual(
    before.jobs.map((row) => ({ ...row, collect_cursor: null, collected_refs: "[]" })),
  );
  expect({ ...after.data, content_suggestion_jobs: before.jobs }).toEqual(before.data);
  expect(after.suggestions).toEqual(before.suggestions);
  expect(after.series).toEqual(before.series);
  expect(after.nodes).toEqual(before.nodes);
  expect(after.foreignKeys).toEqual([]);
  const db = new DatabaseSync(join(f.venueDir, "venue.db"));
  try {
    expect(db.prepare("select count(*) as n from __drizzle_migrations_catalogue").get()).toEqual({
      n: expectedSchemaVersion(modules[1]!.migrations, null),
    });
    expect(() => db.exec("update menu_versions set published_at = null")).toThrow(/append.only/i);
  } finally {
    db.close();
  }
});
it.each(["WAITRON_BACKUP_DIR=/old/private/destination\n", ""])(
  "rejects an invalid archived backup key before moving the database (destination=%s)",
  async (destination) => {
    const f = await fixture();
    f.entries.find((e) => e.name === "secrets/backup.env")!.bytes = Buffer.from(
      `${destination}WAITRON_BACKUP_RECOVERY_KEY=short\n`,
    );
    await seal(f);
    const validated = await validateBackupArtifactFile(f);
    try {
      await expect(placeBackupData(validated, f)).rejects.toMatchObject({
        code: "backup.recovery_key_too_short",
      });
      await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
      const names = await readdir(f.stateDir);
      for (const name of ["trading.env", "secrets.env", "backup.env"]) {
        expect(names).not.toContain(name);
      }
      expect((await stat(validated.databasePath)).isFile()).toBe(true);
    } finally {
      await validated.discard();
    }
  },
);
it.each([
  ["secrets/../../escape", "restore.unsafe_entry_path"],
  ["secrets/tls/../trading.env", "restore.unsafe_entry_path"],
  ["unexpected", "restore.unexpected_entry"],
  ["secrets/unclaimed.json", "restore.unexpected_entry"],
  ["secrets/cloud-connection.json", "restore.unexpected_entry"],
  ["secrets/cloud-staff.key", "restore.unexpected_entry"],
  ["secrets/first-setup-claim.json", "restore.unexpected_entry"],
])("refuses %s before placement", async (name, code) => {
  const f = await fixture();
  f.entries.push({ name, bytes: Buffer.from("untrusted") });
  await seal(f);
  await expect(
    (async () => {
      const validated = await validateBackupArtifactFile(f);
      try {
        await placeBackupData(validated, f);
      } finally {
        await validated.discard();
      }
    })(),
  ).rejects.toMatchObject({ code });
  await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(f.stagingDir)).toEqual([]);
  expect(f.hook).not.toHaveBeenCalled();
});

it("accepts absent optional backup state and a module with no private entry obligations", async () => {
  const f = await fixture();
  f.entries = f.entries.filter((entry) => entry.name !== "secrets/backup.env");
  f.modules = f.modules.map((module, index) =>
    index === 0 ? { ...module, backup: undefined } : module,
  );
  await seal(f);
  const validated = await validateBackupArtifactFile(f);
  try {
    await placeBackupData(validated, f);
    expect(readDatabase(join(f.venueDir, "venue.db")).jobs).toHaveLength(1);
    await expect(stat(join(f.stateDir, "backup.env"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await validated.discard();
  }
});
it("uses captured env precedence to validate backup settings without reaching the old destination", async () => {
  const f = await fixture();
  f.entries.find((entry) => entry.name === "secrets/secrets.env")!.bytes = Buffer.from(
    "WAITRON_BACKUP_RECOVERY_KEY=earlier-valid-archive-key\n",
  );
  f.entries.find((entry) => entry.name === "secrets/backup.env")!.bytes = Buffer.from(
    "WAITRON_BACKUP_DIR=/old/unreachable/destination\n",
  );
  await seal(f);
  const validated = await validateBackupArtifactFile(f);
  try {
    await placeBackupData(validated, f);
    expect(readDatabase(join(f.venueDir, "venue.db")).jobs).toHaveLength(1);
    expect(await readFile(join(f.stateDir, "secrets.env"), "utf8")).toBe(
      "WAITRON_BACKUP_RECOVERY_KEY=earlier-valid-archive-key\n",
    );
    await expect(stat(join(f.stateDir, "backup.env"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await validated.discard();
  }
});
it("refuses an invalid old backup schedule before moving the database", async () => {
  const f = await fixture();
  f.entries.find((entry) => entry.name === "secrets/backup.env")!.bytes = Buffer.from(
    "WAITRON_BACKUP_DIR=/old/destination\nWAITRON_BACKUP_RECOVERY_KEY=long-enough-backup-key\nWAITRON_BACKUP_SCHEDULE_DAYS=daily\nWAITRON_BACKUP_INTERVAL_MS=1000\n",
  );
  await seal(f);
  const validated = await validateBackupArtifactFile(f);
  try {
    await expect(placeBackupData(validated, f)).rejects.toMatchObject({
      code: "backup.schedule_invalid",
      params: { reason: "interval_and_wall_clock" },
    });
    expect((await stat(validated.databasePath)).isFile()).toBe(true);
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await validated.discard();
  }
});

it("refuses missing vault input before moving the database", async () => {
  const f = await fixture();
  f.entries = f.entries.filter((entry) => entry.name !== "secrets/secrets.env");
  await seal(f);
  const validated = await validateBackupArtifactFile(f);
  try {
    await expect(placeBackupData(validated, f)).rejects.toMatchObject({
      code: "recovery.state_incomplete",
      params: { missing: "secrets.env" },
    });
    expect((await stat(validated.databasePath)).isFile()).toBe(true);
    await expect(stat(join(f.venueDir, "venue.db"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await validated.discard();
  }
});

it("restores the target's append-only protection when the private source lacks its triggers", async () => {
  const f = await fixture();
  const source = new DatabaseSync(f.source);
  try {
    source.exec(
      "drop trigger menu_versions_append_only_update; drop trigger menu_versions_append_only_delete",
    );
  } finally {
    source.close();
  }
  await placeBackupDatabase(f.source, f);
  const db = new DatabaseSync(join(f.venueDir, "venue.db"));
  try {
    expect(
      db.prepare("select document, content_hash from menu_versions where id = 'version-one'").get(),
    ).toEqual({ document: '{"original":true}', content_hash: "captured-hash" });
    expect(() =>
      db.exec("update menu_versions set content_hash = 'changed' where id = 'version-one'"),
    ).toThrow("menu_versions is append-only");
    expect(() => db.exec("delete from menu_versions where id = 'version-one'")).toThrow(
      "menu_versions is append-only",
    );
    expect(
      db.prepare("select content_hash from menu_versions where id = 'version-one'").get(),
    ).toEqual({ content_hash: "captured-hash" });
  } finally {
    db.close();
  }
});

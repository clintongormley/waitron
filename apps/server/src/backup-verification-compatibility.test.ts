import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import type { BackupVerificationContribution, WaitronModule } from "@waitron/module";
import { buildBackupVerificationTarget } from "./backup-verification-target.js";
import type { BackupVerificationTarget } from "./backup-verification-protocol.js";
import type { BackupManifest } from "./backup-manifest.js";
import type { ArchiveEntry } from "./backup-archive.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { checkBackupVerificationCompatibility as check } from "./backup-verification-compatibility.js";

const coreSql = [
  "create table locations (id text primary key);--> statement-breakpoint\ncreate table nodes (id text primary key, location_id text);",
  "create table deployment (id integer primary key, environment text);",
];
const extraSql = ["create table extras (id text);"];
const runtime = { release: "test", revision: "a".repeat(40), fingerprint: "b".repeat(64) };
const verify = vi.fn(async (): Promise<never> => {
  throw new Error("Owner callbacks run after migration only");
});
function policy(
  tables: readonly string[],
  overrides: Partial<BackupVerificationContribution> = {},
): BackupVerificationContribution {
  return {
    version: 1,
    publicEvidenceDigest: null,
    data: { kind: "custom", tables, immutableTables: [], checks: ["data"] },
    secrets: [],
    entries: [],
    effects: [],
    zeroSchema: "absent_tables_and_entries",
    targetOnly: "empty_after_migration",
    verifyRestoredData: verify,
    ...overrides,
  };
}
function module(name: string, tables: string[]): WaitronModule {
  return {
    name,
    version: "1.0.0",
    tier: name === "core" ? "mandatory" : "toggleable",
    migrations: { name, table: "__drizzle_migrations_" + name, from: "unused" },
    classification: tables.map((table) => ({
      table,
      class: "state",
      reason: "Synthetic verification fixture",
    })),
    ...(name === "core" ? {} : { requires: { core: "*" } }),
    backup: { verification: policy(tables) },
  };
}
const baseModules = [
  module("core", ["locations", "nodes", "deployment"]),
  module("extra", ["extras"]),
];
let root: string | undefined;
const suite = useVenueDb({
  migrations: [],
  resetPerTest: false,
  async setup() {
    root = await mkdtemp(join(tmpdir(), "a850-compat-"));
    for (const [name, statements] of [
      ["core", coreSql],
      ["extra", extraSql],
      ["future", ["create table future_data (id text);"]],
      ["empty", []],
    ] as const) {
      await mkdir(join(root, name, "meta"), { recursive: true });
      const entries = Array.from(statements.keys(), (idx) => ({
        idx,
        version: "6",
        when: idx + 1,
        tag: "migration_" + idx,
        breakpoints: true,
      }));
      await writeFile(
        join(root, name, "meta/_journal.json"),
        JSON.stringify({ version: "7", dialect: "sqlite", entries }),
      );
      for (const [idx, text] of statements.entries())
        await writeFile(join(root, name, `migration_${idx}.sql`), text);
    }
  },
});
afterAll(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});
let modules: WaitronModule[];
let manifest: BackupManifest;
let entries: ArchiveEntry[];
let target: BackupVerificationTarget;
const entry = (name: string, text = "test-material"): ArchiveEntry => ({
  name,
  bytes: Buffer.from(text),
});
function setEntry(name: string, text: string) {
  entries = entries.filter((e) => e.name !== name);
  entries.push(entry(name, text));
}
function execute(text: string) {
  for (const statement of text.split(";").filter((s) => s.trim())) suite.db.run(sql.raw(statement));
}
function bindTarget() {
  target = buildBackupVerificationTarget({ modules, migrationsRoot: root!, runtime });
}
beforeEach(async () => {
  verify.mockClear();
  for (const row of suite.db.all<{ name: string; type: string }>(
    sql`select name,type from sqlite_schema where type in ('table', 'view') and name not glob 'sqlite_*' order by type desc`,
  ))
    execute(`drop ${row.type === "view" ? "view" : "table"} "${row.name.replaceAll('"', '""')}"`);
  for (const m of baseModules)
    await runMigrations(suite.db, {
      migrationsFolder: join(root!, m.name),
      migrationsTable: m.migrations.table,
    });
  execute(
    "insert into locations values ('10000000-0000-4000-8000-000000000001'); insert into nodes values ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001'); insert into deployment values (1, 'preproduction');",
  );
  modules = structuredClone(baseModules.map((m) => ({ ...m, backup: undefined }))).map((m, i) => ({
    ...m,
    backup: baseModules[i]!.backup,
  }));
  manifest = {
    manifestVersion: 1,
    createdAt: "2026-10-20T08:00:00.000Z",
    environment: "preproduction",
    modules: { core: 2, extra: 1 },
  };
  entries = RECOVERY_FILES.map((f) => entry("secrets/" + f));
  setEntry(
    "secrets/trading.env",
    "WAITRON_TILL_NODE_ID=20000000-0000-4000-8000-000000000002\nWAITRON_TILL_LOCATION_ID=10000000-0000-4000-8000-000000000001\nWAITRON_ENV=preproduction\n",
  );
  bindTarget();
});
async function run(beforeOverride?: BackupQuery) {
  const path = suite.db
    .all<{ file: string }>(sql`pragma database_list`)
    .find((r) => r.file.endsWith("venue.db"))!.file;
  const handle = await openBackupQuery(path);
  const snapshot = () => suite.db.all(sql`select name, sql from sqlite_schema order by name`);
  const original = snapshot();
  try {
    return await check({
      manifest,
      target,
      modules,
      before: beforeOverride ?? handle.query,
      entries,
      migrationsRoot: root!,
    });
  } finally {
    await handle.close();
    expect(verify).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(original);
  }
}

describe("strict backup compatibility", () => {
  it("accepts a fully reconciled inventory without migration or owner callbacks", async () => {
    await expect(run()).resolves.toBe("passed");
  });
  it("accepts older supported source history", async () => {
    execute("delete from __drizzle_migrations_core where created_at=2; drop table deployment;");
    manifest = { ...manifest, modules: { core: 1, extra: 1 } };
    await expect(run()).resolves.toBe("passed");
  });
  it("refuses a source module absent from the target", async () => {
    manifest = { ...manifest, modules: { ...manifest.modules, missing: 1 } };
    await expect(run()).resolves.toBe("unsupported");
  });
  it("refuses newer source schemas", async () => {
    manifest = { ...manifest, modules: { core: 3, extra: 1 } };
    await expect(run()).resolves.toBe("unsupported");
  });
  it("refuses unknown applied hashes even with the expected count", async () => {
    execute("update __drizzle_migrations_extra set hash='unknown'");
    await expect(run()).resolves.toBe("unsupported");
  });
  it("refuses a skipped prefix with the right row count", async () => {
    execute("update __drizzle_migrations_core set created_at=3 where created_at=1");
    await expect(run()).resolves.toBe("unsupported");
  });
  it("refuses duplicated migration timestamps", async () => {
    execute("update __drizzle_migrations_core set created_at=1");
    await expect(run()).resolves.toBe("unsupported");
  });
  it("refuses hash/timestamp pairs from different prefix entries", async () => {
    const hash = createHash("sha256").update(coreSql[1]!).digest("hex");
    suite.db.run(sql`update __drizzle_migrations_core set hash=${hash} where created_at=1`);
    await expect(run()).resolves.toBe("unsupported");
  });
  it.each(["missing", "count", "extra row"])("reconciles the actual journal: %s", async (mode) => {
    if (mode === "missing") execute("drop table __drizzle_migrations_extra");
    if (mode === "count") execute("delete from __drizzle_migrations_extra");
    if (mode === "extra row")
      execute(
        "insert into __drizzle_migrations_extra(hash,created_at) select hash,2 from __drizzle_migrations_extra",
      );
    await expect(run()).resolves.toBe("invalid");
  });
  it.each(["missing", "version", "cycle"])("refuses target dependency %s", async (mode) => {
    modules[1] = {
      ...modules[1]!,
      requires: {
        modules: { [mode === "missing" ? "unknown" : "core"]: mode === "version" ? ">=2" : "*" },
      },
    };
    if (mode === "cycle") modules[0] = { ...modules[0]!, requires: { modules: { extra: "*" } } };
    await expect(run()).resolves.toBe("unsupported");
  });
  it("refuses a missing source dependency although it exists only in target", async () => {
    modules[0] = { ...modules[0]!, requires: { modules: { future: "*" } } };
    modules.push({ ...module("future", ["future_data"]), requires: undefined });
    bindTarget();
    await expect(run()).resolves.toBe("unsupported");
  });
  it("refuses zero-schema dependency of positive-schema source", async () => {
    execute(
      "drop table __drizzle_migrations_core; drop table nodes; drop table locations; drop table deployment;",
    );
    manifest = { ...manifest, modules: { core: 0, extra: 1 } };
    await expect(run()).resolves.toBe("unsupported");
  });
  it.each(["missing owner", "wrong semantics", "unclaimed classification", "duplicate ownership"])(
    "requires complete policies: %s",
    async (mode) => {
      if (mode === "missing owner") modules[1] = { ...modules[1]!, backup: undefined };
      if (mode === "wrong semantics")
        modules[1] = {
          ...modules[1]!,
          backup: { verification: { ...policy(["extras"]), version: 2 as 1 } },
        };
      if (mode === "unclaimed classification")
        modules[1] = { ...modules[1]!, backup: { verification: policy([]) } };
      if (mode === "duplicate ownership")
        modules[1] = {
          ...modules[1]!,
          backup: { verification: policy(["extras", "nodes"]) },
          classification: [...modules[1]!.classification!, modules[0]!.classification![1]!],
        };
      if (["unclaimed classification", "duplicate ownership"].includes(mode)) bindTarget();
      await expect(run()).resolves.toBe("unsupported");
    },
  );
  it.each(["digest", "descriptor", "schema"])(
    "binds actual target policies and assets: %s",
    async (mode) => {
      if (mode === "digest") target = { ...target, digest: "f".repeat(64) };
      if (mode === "descriptor") modules[1] = { ...modules[1]!, version: "1.1.0" };
      if (mode === "schema")
        target = {
          ...target,
          modules: target.modules.map((m) => (m.name === "extra" ? { ...m, schema: 2 } : m)),
        };
      await expect(run()).resolves.toBe("unsupported");
    },
  );
  it("checks positive-schema inactive owners", async () => {
    setEntry("secrets/modules.json", JSON.stringify({ modules: { extra: false } }));
    await expect(run()).resolves.toBe("passed");
    execute("update __drizzle_migrations_extra set hash='bad'");
    await expect(run()).resolves.toBe("unsupported");
  });
  it.each([
    "unknown",
    "target only",
    "wrong type",
    "mandatory",
    "malformed",
    "extra key",
    "missing map",
  ])("reconciles modules.json: %s", async (mode) => {
    const values: Record<string, unknown> = {
      unknown: { modules: { ghost: false } },
      "target only": { modules: { future: false } },
      "wrong type": { modules: { extra: 0 } },
      mandatory: { modules: { core: false } },
      malformed: null,
      "extra key": { modules: {}, extra: true },
      "missing map": {},
    };
    if (mode === "target only") {
      modules.push(module("future", ["future_data"]));
      bindTarget();
    }
    setEntry("secrets/modules.json", mode === "malformed" ? "{" : JSON.stringify(values[mode]));
    await expect(run()).resolves.toBe("unsupported");
  });
  it("accepts zero only with absent owner tables and material; shared host keys are not owner evidence", async () => {
    modules.push(module("future", ["future_data"]));
    modules[2] = {
      ...modules[2]!,
      backup: {
        verification: policy(["future_data"], {
          entries: [{ name: "secrets/secrets.env", presence: "required" }],
        }),
      },
    };
    manifest = { ...manifest, modules: { ...manifest.modules, future: 0 } };
    bindTarget();
    await expect(run()).resolves.toBe("passed");
  });
  it.each(["table", "entry"])("refuses unexplained zero-schema %s", async (mode) => {
    modules.push(module("future", ["future_data"]));
    modules[2] = {
      ...modules[2]!,
      backup: {
        verification: policy(["future_data"], {
          entries: [{ name: "secrets/future-state", presence: "optional" }],
        }),
      },
    };
    manifest = { ...manifest, modules: { ...manifest.modules, future: 0 } };
    bindTarget();
    if (mode === "table") execute("create table future_data (id text)");
    else entries.push(entry("secrets/future-state"));
    await expect(run()).resolves.toBe("unsupported");
  });
  it("accepts explicitly empty schema with an empty journal", async () => {
    modules.push({
      ...module("empty", []),
      backup: { verification: policy([], { zeroSchema: "empty_schema" }) },
    });
    manifest = { ...manifest, modules: { ...manifest.modules, empty: 0 } };
    bindTarget();
    await runMigrations(suite.db, {
      migrationsFolder: join(root!, "empty"),
      migrationsTable: "__drizzle_migrations_empty",
    });
    await expect(run()).resolves.toBe("passed");
  });
  it("accepts compatible target-only absent state for later empty-migration checking", async () => {
    modules.push(module("future", ["future_data"]));
    bindTarget();
    await expect(run()).resolves.toBe("passed");
  });
  it.each(["policy", "table", "journal", "entry"])(
    "refuses unsupported target-only %s",
    async (mode) => {
      const p = policy(["future_data"], {
        targetOnly: mode === "policy" ? "unsupported" : "empty_after_migration",
        entries: [{ name: "secrets/future-state", presence: "optional" }],
      });
      modules.push({ ...module("future", ["future_data"]), backup: { verification: p } });
      bindTarget();
      if (mode === "table") execute("create table future_data (id text)");
      if (mode === "journal")
        execute(
          "create table __drizzle_migrations_future (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
        );
      if (mode === "entry") entries.push(entry("secrets/future-state"));
      await expect(run()).resolves.toBe("unsupported");
    },
  );
  it.each(["unknown", "journal lookalike", "internal lookalike", "view"])(
    "refuses unclaimed schema objects: %s",
    async (mode) => {
      execute(
        mode === "view"
          ? "create view unknown_view as select id from nodes"
          : `create table "${mode === "unknown" ? "unclaimed" : mode === "journal lookalike" ? "__drizzle_migrations_hidden" : "_litestream_other"}" (id text)`,
      );
      await expect(run()).resolves.toBe("unsupported");
    },
  );
  it("accepts exact known SQLite and Litestream metadata shapes", async () => {
    execute(
      "create table _litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER); create table _litestream_lock (id INTEGER);",
    );
    await expect(run()).resolves.toBe("passed");
  });
  it.each(["_litestream_seq", "_litestream_lock", "__drizzle_migrations_extra"])(
    "refuses a known name hiding an extra column: %s",
    async (name) => {
      if (name.startsWith("_litestream"))
        execute(`create table "${name}" (id integer, hidden text)`);
      else execute("alter table __drizzle_migrations_extra add column hidden text");
      await expect(run()).resolves.toBe("unsupported");
    },
  );
  it.each(["unknown", "cloud", "absolute", "backslash", "traversal", "duplicate", "alias"])(
    "refuses archive entry %s",
    async (mode) => {
      const names: Record<string, string> = {
        unknown: "secrets/unknown",
        cloud: "secrets/cloud-connection.json",
        absolute: "/secrets/trading.env",
        backslash: "secrets\\trading.env",
        traversal: "secrets/../secrets/trading.env",
        duplicate: "secrets/trading.env",
        alias: "secrets/tls/../trading.env",
      };
      entries.push(entry(names[mode]!));
      await expect(run()).resolves.toBe(
        ["unknown", "cloud"].includes(mode) ? "unsupported" : "invalid",
      );
    },
  );
  it("accepts single normalized safe destinations and refuses colliding aliases", async () => {
    entries[0] = { ...entries[0]!, name: "secrets/./secrets.env" };
    await expect(run()).resolves.toBe("passed");
    entries.push(entry("secrets/secrets.env"));
    await expect(run()).resolves.toBe("invalid");
  });
  it("does not mutate input archive paths", async () => {
    entries[0] = { ...entries[0]!, name: "secrets/./secrets.env" };
    const snapshot = entries.map((e) => ({ name: e.name, bytes: [...e.bytes] }));
    await expect(run()).resolves.toBe("passed");
    expect(entries.map((e) => ({ name: e.name, bytes: [...e.bytes] }))).toEqual(snapshot);
  });
  it.each(RECOVERY_FILES)("requires host recovery entry %s", async (name) => {
    entries = entries.filter((e) => e.name !== "secrets/" + name);
    await expect(run()).resolves.toBe("invalid");
  });
  it("requires declared owner entries for positive schema", async () => {
    modules[1] = {
      ...modules[1]!,
      backup: {
        verification: policy(["extras"], {
          entries: [{ name: "secrets/extra-state", presence: "required" }],
        }),
      },
    };
    bindTarget();
    await expect(run()).resolves.toBe("invalid");
    entries.push(entry("secrets/extra-state"));
    await expect(run()).resolves.toBe("passed");
  });
  it.each(["node", "location", "wrong location", "empty identity"])(
    "checks the captured identity: %s",
    async (mode) => {
      if (mode === "node") execute("delete from nodes");
      if (mode === "location") execute("delete from locations");
      if (mode === "wrong location") execute("update nodes set location_id='elsewhere'");
      if (mode === "empty identity")
        setEntry(
          "secrets/trading.env",
          "WAITRON_TILL_NODE_ID=\nWAITRON_TILL_LOCATION_ID=10000000-0000-4000-8000-000000000001",
        );
      await expect(run()).resolves.toBe("invalid");
    },
  );
  it.each(["manifest", "trading", "stamp"])(
    "refuses environment disagreement: %s",
    async (mode) => {
      if (mode === "manifest") manifest = { ...manifest, environment: "production" };
      if (mode === "trading")
        setEntry(
          "secrets/trading.env",
          "WAITRON_TILL_NODE_ID=20000000-0000-4000-8000-000000000002\nWAITRON_TILL_LOCATION_ID=10000000-0000-4000-8000-000000000001\nWAITRON_ENV=production\n",
        );
      if (mode === "stamp") execute("update deployment set environment='production'");
      await expect(run()).resolves.toBe("unsupported");
    },
  );
  it("accepts a captured development environment as preproduction", async () => {
    setEntry(
      "secrets/trading.env",
      "WAITRON_TILL_NODE_ID=20000000-0000-4000-8000-000000000002\nWAITRON_TILL_LOCATION_ID=10000000-0000-4000-8000-000000000001\nWAITRON_ENV=dev\n",
    );
    await expect(run()).resolves.toBe("passed");
  });
  it("refuses metadata hidden inside a quoted column identifier", async () => {
    execute('create table _litestream_lock ("id INTEGER")');
    await expect(run()).resolves.toBe("unsupported");
  });
  it("refuses missing tables at the exact target schema", async () => {
    execute("drop table extras");
    await expect(run()).resolves.toBe("invalid");
  });
  it.each(["zero", "target-only"])(
    "refuses %s owner vault material even without owner tables",
    async (mode) => {
      execute(
        "create table tenant_credentials (purpose text); insert into tenant_credentials values ('future.secret');",
      );
      const core = modules[0]!;
      const tables = [...core.backup!.verification!.data.tables, "tenant_credentials"];
      modules[0] = {
        ...core,
        classification: [
          ...core.classification!,
          { table: "tenant_credentials", class: "state", reason: "Synthetic vault" },
        ],
        backup: { verification: policy(tables) },
      };
      modules.push({
        ...module("future", ["future_data"]),
        backup: { verification: policy(["future_data"], { secrets: ["vault:future.secret"] }) },
      });
      if (mode === "zero") manifest = { ...manifest, modules: { ...manifest.modules, future: 0 } };
      bindTarget();
      await expect(run()).resolves.toBe("unsupported");
    },
  );
  it.each([null, [], "wrong", { core: -1 }, { core: 0.5 }])(
    "refuses malformed module maps %j",
    async (value) => {
      manifest = { ...manifest, modules: value as unknown as Record<string, number> };
      await expect(run()).resolves.toBe("invalid");
    },
  );
  it.each(["version", "date", "environment"])("refuses malformed manifest %s", async (mode) => {
    manifest = {
      ...manifest,
      ...(mode === "version"
        ? { manifestVersion: 2 as 1 }
        : mode === "date"
          ? { createdAt: "not a date" }
          : { environment: "unknown" as "production" }),
    };
    await expect(run()).resolves.toBe(mode === "version" ? "unsupported" : "invalid");
  });
  it.each([
    "null",
    "[]",
    "true",
    '{"other":{}}',
    '{"modules":null}',
    '{"modules":[]}',
    '{"modules":true}',
    '{"modules":{"extra":false,"extra":true}}',
    '{"modules":{},"modules":{}}',
  ])("refuses ambiguous module configuration %s", async (raw) => {
    setEntry("secrets/modules.json", raw);
    await expect(run()).resolves.toBe("unsupported");
  });
  it("accepts optional host configuration and scoped optional owner evidence", async () => {
    const name = "secrets/module-evidence/extra/history.json";
    modules[1] = {
      ...modules[1]!,
      backup: {
        nonDbState: [{ kind: "preparation-history", source: "history", project: () => ({}) }],
        verification: policy(["extras"], { entries: [{ name, presence: "optional" }] }),
      },
    };
    bindTarget();
    setEntry("secrets/modules.json", '{"modules":{"extra":true}}');
    setEntry("secrets/backup.env", "");
    await expect(run()).resolves.toBe("passed");
    entries.push(entry(name, "{}"));
    await expect(run()).resolves.toBe("passed");
  });
  it.each(["undeclared history", "directory"])(
    "refuses unresolved non-database state: %s",
    async (mode) => {
      modules[1] = {
        ...modules[1]!,
        backup: {
          nonDbState:
            mode === "directory"
              ? [{ kind: "content-addressed-dir", source: "photos" }]
              : [{ kind: "preparation-history", source: "history", project: () => ({}) }],
          verification: policy(["extras"]),
        },
      };
      bindTarget();
      await expect(run()).resolves.toBe("unsupported");
    },
  );
  it("refuses an owner claiming a journal as data", async () => {
    const core = modules[0]!;
    const tables = [...core.backup!.verification!.data.tables, "__drizzle_migrations_extra"];
    modules[0] = {
      ...core,
      classification: [
        ...core.classification!,
        { table: "__drizzle_migrations_extra", class: "state", reason: "Invalid ownership" },
      ],
      backup: { verification: policy(tables) },
    };
    bindTarget();
    await expect(run()).resolves.toBe("unsupported");
  });
  it("accepts empty-schema dependency without treating its zero as absent semantics", async () => {
    modules.push({
      ...module("empty", []),
      classification: undefined,
      backup: { verification: policy([], { zeroSchema: "empty_schema" }) },
    });
    modules[1] = { ...modules[1]!, requires: { core: "*", modules: { empty: "*" } } };
    manifest = { ...manifest, modules: { ...manifest.modules, empty: 0 } };
    bindTarget();
    await expect(run()).resolves.toBe("passed");
  });
  it.each(["brackets", "backticks", "numeric default", "escaped quote"])(
    "checks metadata tokens with %s",
    async (mode) => {
      const column =
        mode === "brackets"
          ? "[id] INTEGER"
          : mode === "backticks"
            ? "`id` INTEGER"
            : mode === "numeric default"
              ? "id INTEGER default 1"
              : '"i""d" INTEGER';
      execute(`create table _litestream_lock (${column})`);
      await expect(run()).resolves.toBe(
        ["brackets", "backticks"].includes(mode) ? "passed" : "unsupported",
      );
    },
  );
  it("refuses invalid captured UUIDs", async () => {
    setEntry("secrets/trading.env", "WAITRON_TILL_NODE_ID=bad\nWAITRON_TILL_LOCATION_ID=bad\n");
    await expect(run()).resolves.toBe("invalid");
  });
  it("refuses non-text vault purpose without publishing it", async () => {
    execute(
      "create table tenant_credentials (purpose text); insert into tenant_credentials values (null);",
    );
    const core = modules[0]!;
    const tables = [...core.backup!.verification!.data.tables, "tenant_credentials"];
    modules[0] = {
      ...core,
      classification: [
        ...core.classification!,
        { table: "tenant_credentials", class: "state", reason: "Synthetic vault" },
      ],
      backup: { verification: policy(tables) },
    };
    bindTarget();
    await expect(run()).resolves.toBe("invalid");
  });
  it("keeps query failures inconclusive rather than returning corruption", async () => {
    const error = new Error("private query fault");
    await expect(
      run({
        async *rows(): AsyncIterable<never> {
          yield* [];
          throw error;
        },
      }),
    ).rejects.toBe(error);
  });
});

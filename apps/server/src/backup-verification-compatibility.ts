import { readMigrationFiles } from "drizzle-orm/migrator";
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { backupVerificationInventory } from "@waitron/composition";
import { migrationOptionsFor } from "@waitron/migrations";
import { deploymentEnvironmentFor } from "@waitron/db";
import {
  BackupVerificationUnsupported,
  parseModuleConfig,
  type WaitronModule,
} from "@waitron/module";
import { isAppError } from "@waitron/shared";
import type { BackupQuery, BackupRow } from "@waitron/store";
import type { ArchiveEntry } from "./backup-archive.js";
import type { BackupManifest } from "./backup-manifest.js";
import type { BackupVerificationTarget } from "./backup-verification-protocol.js";
import { buildBackupVerificationTarget } from "./backup-verification-target.js";
import { RECOVERY_FILES } from "./state-secrets.js";
import { OPTIONAL_BACKUP_STATE } from "./backup-optional-state.js";
import { parseEnvFile } from "./env-file.js";
import { readArtifactIdentity } from "./restore.js";

type Verdict = "passed" | "unsupported" | "invalid";
class Refusal extends Error {
  constructor(readonly status: Exclude<Verdict, "passed">) {
    super("Backup compatibility refused");
  }
}
function refuse(status: Exclude<Verdict, "passed">): never {
  throw new Refusal(status);
}
function ident(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"';
}
function normalized(name: string): string {
  if (
    name.includes("\\") ||
    posix.isAbsolute(name) ||
    name.split("/").includes("..") ||
    name.includes("\0")
  )
    refuse("invalid");
  return posix.normalize(name);
}
function shape(sql: string): string[] {
  const result: string[] = [];
  const token =
    /\s*(?:"((?:[^"]|"")*)"|`((?:[^`]|``)*)`|\[([^\]]*)\]|([a-z_][a-z0-9_]*)|([(),]))/iy;
  const text = sql.trim().replace(/;$/, "").trim();
  while (token.lastIndex < text.length) {
    const part = token.exec(text);
    if (part === null) refuse("unsupported");
    result.push(
      (
        part[1]?.replaceAll('""', '"') ??
        part[2]?.replaceAll("``", "`") ??
        part[3] ??
        part[4] ??
        part[5]!
      ).toLowerCase(),
    );
  }
  return result;
}
function tableShape(name: string, stored: BackupRow, columns: string): void {
  if (
    typeof stored.sql !== "string" ||
    !isDeepStrictEqual(shape(stored.sql), shape(`create table ${ident(name)} (${columns})`))
  )
    refuse("unsupported");
}
async function rows(query: BackupQuery, statement: string): Promise<BackupRow[]> {
  const result = [];
  for await (const row of query.rows(statement)) result.push(row);
  return result;
}
const HOST_ENTRIES = [...RECOVERY_FILES, ...OPTIONAL_BACKUP_STATE].map((name) => "secrets/" + name);
function moduleConfig(
  raw: Uint8Array,
  modules: readonly WaitronModule[],
  source: Record<string, number>,
): void {
  let config: unknown;
  const text = Buffer.from(raw).toString("utf8");
  try {
    config = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) refuse("unsupported");
    throw error;
  }
  if (
    config === null ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    Object.keys(config).length !== 1 ||
    !Object.hasOwn(config, "modules")
  )
    refuse("unsupported");
  const overrides = (config as { modules: unknown }).modules;
  if (overrides === null || typeof overrides !== "object" || Array.isArray(overrides))
    refuse("unsupported");
  // Only the envelope and a flat boolean map are admitted; duplicate raw keys must not disappear.
  const keyCount = [...text.matchAll(/"(?:[^"\\]|\\.)*"\s*:/g)].length;
  if (
    keyCount !== Object.keys(overrides).length + 1 ||
    Object.keys(overrides).some((name) => !Object.hasOwn(source, name))
  )
    refuse("unsupported");
  parseModuleConfig(config, modules);
}

export async function checkBackupVerificationCompatibility(input: {
  manifest: BackupManifest;
  target: BackupVerificationTarget;
  modules: readonly WaitronModule[];
  before: BackupQuery;
  entries: readonly ArchiveEntry[];
  migrationsRoot?: string | null;
}): Promise<Verdict> {
  try {
    return await reconcile(input);
  } catch (error) {
    if (error instanceof Refusal) return error.status;
    if (error instanceof BackupVerificationUnsupported) return "unsupported";
    if (isAppError(error)) {
      if (error.code.startsWith("module.")) return "unsupported";
      if (["restore.identity_incomplete", "shared.invalid_id"].includes(error.code))
        return "invalid";
    }
    throw error;
  }
}
async function reconcile(
  input: Parameters<typeof checkBackupVerificationCompatibility>[0],
): Promise<Verdict> {
  const { manifest, target, modules, before } = input;
  const inventory = backupVerificationInventory(modules);
  const actual = buildBackupVerificationTarget({
    modules,
    migrationsRoot: input.migrationsRoot ?? null,
    runtime: target.runtime,
  });
  if (!isDeepStrictEqual(actual, target)) refuse("unsupported");
  if (manifest.manifestVersion !== 1) refuse("unsupported");
  if (
    !["preproduction", "production"].includes(manifest.environment) ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  )
    refuse("invalid");
  const source = manifest.modules;
  if (source === null || typeof source !== "object" || Array.isArray(source)) refuse("invalid");
  const byName = new Map(inventory.map((owner) => [owner.module.name, owner]));
  for (const [name, version] of Object.entries(source)) {
    if (!byName.has(name)) refuse("unsupported");
    if (!Number.isSafeInteger(version) || version < 0) refuse("invalid");
    if (version > actual.modules.find((m) => m.name === name)!.schema) refuse("unsupported");
  }
  const owned = new Set<string>();
  const journals = new Set<string>();
  for (const { module, verification } of inventory) {
    const classified = (module.classification ?? []).map((c) => c.table).sort();
    if (!isDeepStrictEqual(classified, [...verification.data.tables].sort())) refuse("unsupported");
    for (const table of classified) {
      if (owned.has(table)) refuse("unsupported");
      owned.add(table);
    }
    journals.add(module.migrations.table);
    const descriptor = actual.modules.find((m) => m.name === module.name)!;
    if (source[module.name] !== undefined && source[module.name]! > 0) {
      for (const dependency of Object.keys(descriptor.requires)) {
        const owner = byName.get(dependency)!;
        if (
          !Object.hasOwn(source, dependency) ||
          (source[dependency] === 0 && owner.verification.zeroSchema !== "empty_schema")
        )
          refuse("unsupported");
      }
    }
    for (const state of module.backup?.nonDbState ?? []) {
      if (
        state.kind !== "preparation-history" ||
        !verification.entries.some(
          (entry) => entry.name === `secrets/module-evidence/${module.name}/${state.source}.json`,
        )
      )
        refuse("unsupported");
    }
  }
  if ([...journals].some((name) => owned.has(name))) refuse("unsupported");
  const allowed = new Set([
    "manifest.json",
    "db.dump",
    ...HOST_ENTRIES,
    ...inventory.flatMap(({ verification }) => verification.entries.map((e) => e.name)),
  ]);
  const entries = new Map<string, ArchiveEntry>();
  for (const entry of input.entries) {
    const name = normalized(entry.name);
    if (entries.has(name)) refuse("invalid");
    if (!allowed.has(name)) refuse("unsupported");
    entries.set(name, { name, bytes: entry.bytes });
  }
  for (const file of RECOVERY_FILES) if (!entries.has("secrets/" + file)) refuse("invalid");
  const config = entries.get("secrets/modules.json");
  if (config) moduleConfig(config.bytes, modules, source);
  const tables = new Map<string, BackupRow>();
  for await (const row of before.rows(
    "select name, type, sql from sqlite_schema where type in ('table', 'view')",
  )) {
    if (typeof row.name !== "string" || row.type !== "table") refuse("unsupported");
    tables.set(row.name, row);
    if (owned.has(row.name)) continue;
    if (journals.has(row.name))
      tableShape(row.name, row, "id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric");
    else {
      const internals: Readonly<Record<string, string>> = {
        sqlite_sequence: "name,seq",
        sqlite_stat1: "tbl,idx,stat",
        sqlite_stat4: "tbl,idx,neq,nlt,ndlt,sample",
        _litestream_seq: "id INTEGER PRIMARY KEY, seq INTEGER",
        _litestream_lock: "id INTEGER",
      };
      if (!Object.hasOwn(internals, row.name)) refuse("unsupported");
      tableShape(row.name, row, internals[row.name]!);
    }
  }
  const purposes = new Set<string>();
  if (tables.has("tenant_credentials")) {
    for await (const row of before.rows("select purpose from tenant_credentials")) {
      if (typeof row.purpose !== "string") refuse("invalid");
      purposes.add("vault:" + row.purpose);
    }
  }
  for (const { module, verification } of inventory) {
    const version = Object.hasOwn(source, module.name) ? source[module.name]! : null;
    const material = verification.entries.filter((e) => !HOST_ENTRIES.includes(e.name));
    const present =
      verification.data.tables.some((name) => tables.has(name)) ||
      material.some((e) => entries.has(e.name)) ||
      verification.secrets.some((name) => purposes.has(name));
    if (version === null) {
      if (
        verification.targetOnly === "unsupported" ||
        present ||
        tables.has(module.migrations.table)
      )
        refuse("unsupported");
      continue;
    }
    if (version === 0) {
      if (
        present ||
        (verification.zeroSchema === "empty_schema" && verification.data.tables.length !== 0)
      )
        refuse("unsupported");
    } else {
      if (
        version === actual.modules.find((m) => m.name === module.name)!.schema &&
        verification.data.tables.some((name) => !tables.has(name))
      )
        refuse("invalid");
      for (const entry of verification.entries)
        if (entry.presence === "required" && !entries.has(entry.name)) refuse("invalid");
    }
    const journal = tables.get(module.migrations.table);
    if (journal === undefined) {
      if (version !== 0) refuse("invalid");
      continue;
    }
    const applied = await rows(
      before,
      `select id, hash, created_at from ${ident(module.migrations.table)} order by created_at`,
    );
    if (applied.length !== version) refuse("invalid");
    const options = migrationOptionsFor(
      [{ ...module.migrations, appendOnlyTables: [] }],
      input.migrationsRoot ?? null,
    )[0]!;
    const expected = readMigrationFiles(options);
    for (let i = 0; i < applied.length; i++) {
      const row = applied[i]!;
      const migration = expected[i]!;
      if (
        row.hash !== migration.hash ||
        (typeof row.created_at !== "number" && typeof row.created_at !== "bigint") ||
        Number(row.created_at) !== migration.folderMillis ||
        !Number.isSafeInteger(migration.folderMillis) ||
        (i > 0 && migration.folderMillis <= expected[i - 1]!.folderMillis)
      )
        refuse("unsupported");
    }
  }
  const identity = readArtifactIdentity([...entries.values()]).node;
  if (!tables.has("nodes") || !tables.has("locations")) refuse("invalid");
  let found = false;
  for await (const row of before.rows(
    "select n.id from nodes n join locations l on l.id = n.location_id where n.id = ? and l.id = ?",
    [identity.nodeId, identity.locationId],
  )) {
    if (row.id === identity.nodeId) found = true;
  }
  if (!found) refuse("invalid");
  const trading = parseEnvFile(
    Buffer.from(entries.get("secrets/trading.env")!.bytes).toString("utf8"),
  );
  if (deploymentEnvironmentFor(trading.WAITRON_ENV) !== manifest.environment) refuse("unsupported");
  if (tables.has("deployment")) {
    const stamps = await rows(before, "select id, environment from deployment");
    if (
      stamps.length !== 1 ||
      Number(stamps[0]!.id) !== 1 ||
      stamps[0]!.environment !== manifest.environment
    )
      refuse("unsupported");
  }
  return "passed";
}

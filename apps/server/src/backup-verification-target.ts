import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { backupVerificationInventory } from "@waitron/composition";
import { migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import {
  BackupVerificationUnsupported,
  type BackupVerificationContribution,
  type WaitronModule,
} from "@waitron/module";
import {
  BackupVerificationProtocolError,
  backupVerificationTargetDigests,
  validateBackupVerificationTarget,
  type BackupVerificationTarget,
} from "./backup-verification-protocol.js";

function unsupported(): never {
  throw new BackupVerificationUnsupported("target_incompatible");
}
function sha(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}
function digest(value: unknown): string {
  return sha(JSON.stringify(value));
}
function pairs<T>(value: Readonly<Record<string, T>>): [string, T][] {
  return Object.keys(value)
    .sort()
    .map((key) => [key, value[key]!]);
}
function policyDigest(p: BackupVerificationContribution): string {
  return digest([
    p.version,
    p.publicEvidenceDigest,
    p.data.kind,
    [...p.data.tables].sort(),
    [...p.data.immutableTables].sort(),
    [...p.data.checks].sort(),
    [...p.secrets].sort(),
    p.entries
      .map((e) => [e.name, e.presence])
      .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)),
    p.effects
      .map((e) => [e.id, e.kind, e.check])
      .sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0)),
    p.zeroSchema,
    p.targetOnly,
  ]);
}
function migrationBytes(folder: string): { schema: number; digest: string } {
  const journal = readFileSync(join(folder, "meta/_journal.json"));
  let raw: unknown;
  try {
    raw = JSON.parse(journal.toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) unsupported();
    throw error;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) unsupported();
  const parsed = raw as {
    entries?: { idx?: unknown; tag?: unknown }[];
  };
  if (!Array.isArray(parsed.entries)) unsupported();
  const entries = parsed.entries;
  if (
    entries.some(
      (e, index) =>
        e === null ||
        typeof e !== "object" ||
        e.idx !== index ||
        typeof e.tag !== "string" ||
        !/^[a-zA-Z0-9_-]+$/.test(e.tag),
    )
  )
    unsupported();
  if (new Set(entries.map((e) => e.tag)).size !== entries.length) unsupported();
  const files: [string, string][] = [];
  function walk(relative: string) {
    for (const entry of readdirSync(join(folder, relative), { withFileTypes: true })) {
      const name = relative ? relative + "/" + entry.name : entry.name;
      if (entry.isSymbolicLink()) unsupported();
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && name.endsWith(".sql"))
        files.push([name, sha(readFileSync(join(folder, name)))]);
    }
  }
  if (lstatSync(join(folder, "meta/_journal.json")).isSymbolicLink()) unsupported();
  walk("");
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (entries.some((e) => !files.some(([name]) => name === e.tag + ".sql"))) unsupported();
  return { schema: entries.length, digest: digest([1, sha(journal), files]) };
}
export function buildBackupVerificationTarget(input: {
  modules: readonly WaitronModule[];
  migrationsRoot: string | null;
  runtime: { release: string; revision: string; fingerprint: string };
}): BackupVerificationTarget {
  const inventory = backupVerificationInventory(input.modules);
  try {
    const modules = inventory
      .map(({ module, verification }) => {
        if (module.name !== module.migrations.name) unsupported();
        const folder = migrationOptionsFor(
          [{ ...module.migrations, appendOnlyTables: [] }],
          input.migrationsRoot,
        )[0]!.migrationsFolder;
        const migrations = migrationBytes(folder);
        const requires: Record<string, string> = { ...module.requires?.modules };
        if (module.requires?.core !== undefined) {
          if (requires.core !== undefined && requires.core !== module.requires.core) unsupported();
          requires.core = module.requires.core;
        }
        return {
          name: module.name,
          packageVersion: module.version,
          requires: Object.fromEntries(pairs(requires)),
          schema: migrations.schema,
          migrationTable: module.migrations.table,
          migrationDigest: migrations.digest,
          semanticsVersion: verification.version,
          policyDigest: policyDigest(verification),
        };
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return validateBackupVerificationTarget({
      version: 1,
      runtime: { ...input.runtime },
      modules,
      ...backupVerificationTargetDigests({ runtime: input.runtime, modules }),
    });
  } catch (error) {
    if (
      error instanceof BackupVerificationProtocolError ||
      (error instanceof AppError && error.code === "migrations.set_missing") ||
      (error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ENOTDIR", "EISDIR", "ELOOP"].includes(String(error.code)))
    )
      unsupported();
    throw error;
  }
}

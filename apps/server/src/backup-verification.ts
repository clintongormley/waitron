import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { backupVerificationInventory } from "@waitron/composition";
import {
  BackupCheckUnavailable,
  BackupVerificationUnsupported,
  validateBackupModuleResult,
  type BackupVerificationContribution,
  type WaitronModule,
} from "@waitron/module";
import { isAppError } from "@waitron/shared";
import { openBackupQuery, type BackupQuery } from "@waitron/store";
import { placeBackupData } from "./backup-data-placement.js";
import {
  BackupVerificationArchiveError,
  validateBackupArtifactFile,
} from "./backup-verification-archive.js";
import { checkBackupVerificationCompatibility } from "./backup-verification-compatibility.js";
import {
  backupVerificationRequestDigest,
  readBackupVerificationRequest,
  readBackupVerificationResult,
  type BackupVerificationRequest,
  type BackupVerificationResult,
  type BackupVerificationReason,
} from "./backup-verification-protocol.js";
import {
  verifyBackupKeyPlacement,
  verifyBackupStateSecrets,
} from "./backup-verification-secrets.js";
import { buildBackupVerificationTarget } from "./backup-verification-target.js";
import { errnoOf } from "./errno.js";
import { readArtifactIdentity } from "./restore.js";

export interface BackupVerificationDeps {
  artifactPath: string;
  recoveryKey: { version: number; reference: string; secret: string };
  scratchRoot: string;
  modules: readonly WaitronModule[];
  migrationsRoot: string | null;
  runtime: { release: string; revision: string; fingerprint: string };
  signal: AbortSignal;
  now(): Date;
}

type Verdict = Pick<BackupVerificationResult, "status" | "reason">;
class Refusal extends Error {
  constructor(readonly verdict: Verdict) {
    super("Backup verification refused");
  }
}
function refuse(status: Verdict["status"], reason: BackupVerificationReason): never {
  throw new Refusal({ status, reason });
}
const SCRATCH_BYTES = 256 * 1024 * 1024;

async function scratchBytes(path: string): Promise<number> {
  let total = 0;
  for (const name of await readdir(path)) {
    const child = join(path, name);
    const info = await lstat(child);
    if (info.isSymbolicLink()) refuse("unavailable", "unexpected");
    total += info.isDirectory() ? await scratchBytes(child) : info.size;
    if (total > SCRATCH_BYTES) refuse("unavailable", "resource_limit");
  }
  return total;
}

function integrity(path: string): boolean {
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    db.exec("pragma query_only=on");
    const checks = db.prepare("pragma integrity_check").all();
    return (
      checks.length === 1 &&
      checks[0]!.integrity_check === "ok" &&
      db.prepare("pragma foreign_key_check").all().length === 0
    );
  } finally {
    db.close();
  }
}
function ident(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}
async function emptyOwner(
  query: BackupQuery,
  owner: BackupVerificationContribution,
): Promise<boolean> {
  for (const name of owner.data.tables) {
    let present = false;
    for await (const row of query.rows(
      "select name from sqlite_schema where type='table' and name=?",
      [name],
    ))
      present = row.name === name;
    if (!present) return false;
    for await (const _row of query.rows(`select 1 from ${ident(name)} limit 1`)) return false;
  }
  return true;
}
function classify(error: unknown): Verdict {
  if (error instanceof Refusal) return error.verdict;
  if (error instanceof BackupVerificationArchiveError)
    return { status: error.status, reason: error.reason };
  if (error instanceof BackupVerificationUnsupported)
    return { status: "unsupported", reason: error.reason };
  if (error instanceof BackupCheckUnavailable)
    return { status: "unavailable", reason: error.reason };
  if (["ENOSPC", "EDQUOT", "ENOMEM", "ERR_WORKER_OUT_OF_MEMORY"].includes(errnoOf(error) ?? ""))
    return { status: "unavailable", reason: "resource_limit" };
  if (isAppError(error)) {
    if (error.code === "recovery.passphrase_invalid")
      return { status: "unavailable", reason: "decryption_unavailable" };
    if (["restore.environment_mismatch", "restore.schema_too_new"].includes(error.code))
      return { status: "unsupported", reason: "target_incompatible" };
    if (
      [
        "backup.artifact_invalid",
        "backup.archive_invalid",
        "restore.archive_incomplete",
        "restore.unsafe_entry_path",
        "restore.unexpected_entry",
        "restore.identity_incomplete",
        "shared.invalid_id",
      ].includes(error.code)
    )
      return { status: "invalid", reason: "archive_invalid" };
  }
  if (error instanceof Error && "errcode" in error && [11, 26].includes(Number(error.errcode)))
    return { status: "invalid", reason: "sqlite_integrity" };
  return { status: "unavailable", reason: "unexpected" };
}

export async function verifyBackupArtifact(
  supplied: BackupVerificationRequest,
  deps: BackupVerificationDeps,
): Promise<BackupVerificationResult> {
  // The copy binds every awaited step to the admitted request, including mutable callers.
  const request = readBackupVerificationRequest(JSON.stringify(supplied));
  const started = performance.now();
  const deadline = Date.parse(request.attempt.deadline);
  const check = () => {
    if (deps.signal.aborted) refuse("unavailable", "cancelled");
    const now = deps.now().getTime();
    if (!Number.isFinite(now) || now >= deadline || performance.now() - started >= 30_000)
      refuse("unavailable", "deadline");
  };
  let scratch: string | undefined;
  let measurement: BackupVerificationResult["measuredArchive"] = null;
  let results: BackupVerificationResult["modules"] = [];
  let verdict: Verdict;
  const close: (() => Promise<void>)[] = [];
  let cleanupFailed = false;
  const boundary = async () => {
    check();
    if (scratch !== undefined) await scratchBytes(scratch);
    check();
  };
  try {
    check();
    const delivered = { ...deps.recoveryKey };
    if (
      delivered.version !== request.backupKey.version ||
      delivered.reference !== request.backupKey.reference ||
      !delivered.secret
    )
      refuse("unavailable", "secret_unavailable");
    const inventory = backupVerificationInventory(deps.modules);
    const target = buildBackupVerificationTarget(deps);
    if (!isDeepStrictEqual(target, request.target)) refuse("unsupported", "target_incompatible");
    if (request.archive.manifestVersion !== 1) refuse("unsupported", "archive_format_unsupported");
    scratch = await mkdtemp(join(deps.scratchRoot, "verification-"));
    const sealed = join(scratch, "sealed-input");
    const input = await open(deps.artifactPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    close.push(() => input.close());
    if (!(await input.stat()).isFile()) refuse("unavailable", "unexpected");
    const output = await open(sealed, "wx", 0o600);
    close.push(() => output.close());
    const hash = createHash("sha256");
    let bytes = 0;
    const buffer = Buffer.alloc(65536);
    for (;;) {
      check();
      const read = await input.read(buffer, 0, buffer.length, null);
      if (read.bytesRead === 0) break;
      bytes += read.bytesRead;
      if (bytes > SCRATCH_BYTES) refuse("unavailable", "resource_limit");
      const chunk = buffer.subarray(0, read.bytesRead);
      hash.update(chunk);
      for (let offset = 0; offset < chunk.length;) {
        const written = await output.write(chunk, offset, chunk.length - offset);
        if (written.bytesWritten === 0) refuse("unavailable", "unexpected");
        offset += written.bytesWritten;
      }
    }
    await output.close();
    close.pop();
    await input.close();
    close.pop();
    measurement = bytes === 0 ? null : { sha256: hash.digest("hex"), bytes };
    if (bytes !== request.archive.bytes) refuse("invalid", "archive_size_mismatch");
    if (measurement?.sha256 !== request.archive.sha256)
      refuse("invalid", "archive_digest_mismatch");
    await boundary();
    const stateDir = join(scratch, "state");
    const venueDir = join(scratch, "venue");
    const validated = await validateBackupArtifactFile({
      artifactPath: sealed,
      recoveryKey: delivered.secret,
      stagingDir: scratch,
      stateDir,
      migrationsRoot: deps.migrationsRoot,
      modules: deps.modules,
      environment: request.archive.environment,
      expected: request,
    });
    close.push(validated.discard);
    await boundary();
    if (!integrity(validated.databasePath)) refuse("invalid", "sqlite_integrity");
    const before = await openBackupQuery(validated.databasePath);
    close.push(before.close);
    const compatibility = await checkBackupVerificationCompatibility({
      manifest: validated.manifest,
      target,
      modules: deps.modules,
      before: before.query,
      entries: validated.secretEntries,
      migrationsRoot: deps.migrationsRoot,
    });
    if (compatibility !== "passed")
      refuse(
        compatibility,
        compatibility === "invalid" ? "archive_invalid" : "target_incompatible",
      );
    const { node } = readArtifactIdentity(validated.secretEntries);
    let sealedState: { sealed: Uint8Array; recoveryKey: string } | undefined;
    let hasSealedState = false;
    for await (const row of before.query.rows(
      "select name from sqlite_schema where type='table' and name='node_sealed_state'",
    ))
      hasSealedState = row.name === "node_sealed_state";
    if (hasSealedState) {
      for await (const row of before.query.rows(
        "select sealed from node_sealed_state where node_id=?",
        [node.nodeId],
      )) {
        if (!(row.sealed instanceof Uint8Array)) refuse("invalid", "secret_invalid");
        sealedState = { sealed: row.sealed, recoveryKey: delivered.secret };
      }
    }
    const secrets = await verifyBackupStateSecrets(
      validated.secretEntries,
      node,
      deps.now(),
      sealedState,
    );
    if (secrets.status !== "passed") refuse(secrets.status, secrets.reason);
    await boundary();
    const placementPath = join(scratch, "placement.db");
    // Placement moves its input; the query-only original must keep its own path and inode.
    await copyFile(validated.databasePath, placementPath, constants.COPYFILE_EXCL);
    await boundary();
    await placeBackupData(
      { ...validated, databasePath: placementPath },
      {
        venueDir,
        stateDir,
        modules: deps.modules,
        migrationsRoot: deps.migrationsRoot,
        log: () => {},
      },
    );
    await boundary();
    const placedPath = join(venueDir, "venue.db");
    if (!integrity(placedPath)) refuse("invalid", "sqlite_integrity");
    const placementKeys = await verifyBackupKeyPlacement(validated.secretEntries, stateDir);
    if (placementKeys !== "passed")
      refuse(
        placementKeys,
        placementKeys === "unsupported" ? "target_incompatible" : "secret_unavailable",
      );
    const after = await openBackupQuery(placedPath);
    close.push(after.close);
    const completed: BackupVerificationResult["modules"][number][] = [];
    for (const { module, verification } of inventory) {
      await boundary();
      const sourceSchema = Object.hasOwn(request.archive.modules, module.name)
        ? request.archive.modules[module.name]!
        : null;
      const notApplicable = sourceSchema === null || sourceSchema === 0;
      let raw;
      if (notApplicable) {
        if (!(await emptyOwner(after.query, verification)))
          refuse("unsupported", "target_incompatible");
        raw = { status: "passed", checks: [{ code: "not_applicable", status: "passed" }] };
      } else {
        const allowed = new Set(verification.entries.map((e) => e.name));
        raw = await verification.verifyRestoredData({
          before: before.query,
          after: after.query,
          entries: Object.freeze({
            read: async (name: string) => {
              if (!allowed.has(name)) throw new BackupVerificationUnsupported("semantics_missing");
              const entry = validated.secretEntries.find((e) => e.name === name);
              return entry === undefined ? null : new Uint8Array(entry.bytes);
            },
          }),
          source: Object.freeze({
            ...node,
            environment: request.archive.environment,
            createdAt: request.capturedAt,
          }),
          sourceSchema,
          targetSchema: target.modules.find((m) => m.name === module.name)!.schema,
          signal: deps.signal,
        });
      }
      const result = validateBackupModuleResult(raw, verification, notApplicable);
      completed.push({ name: module.name, semanticsVersion: verification.version, ...result });
    }
    await boundary();
    results = completed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const status =
      (["unsupported", "needs_authority", "invalid"] as const).find((s) =>
        results.some((m) => m.status === s),
      ) ?? "passed";
    verdict = {
      status,
      reason:
        status === "passed"
          ? "none"
          : status === "unsupported"
            ? "semantics_missing"
            : status === "needs_authority"
              ? "module_data_check_requires_authority"
              : "module_integrity",
    };
  } catch (error) {
    verdict = classify(error);
  } finally {
    for (const dispose of close.reverse()) {
      try {
        await dispose();
      } catch {
        cleanupFailed = true;
      }
    }
    if (scratch !== undefined) {
      try {
        await rm(scratch, { recursive: true, force: true });
      } catch {
        cleanupFailed = true;
      }
    }
  }
  try {
    check();
  } catch (error) {
    verdict = classify(error);
  }
  if (cleanupFailed) verdict = { status: "unavailable", reason: "cleanup_uncertain" };
  const result: BackupVerificationResult = {
    protocol: "backup-data-restore/v1",
    requestDigest: backupVerificationRequestDigest(request),
    attemptToken: request.attempt.childToken,
    measuredArchive: measurement,
    targetDigest: request.target.digest,
    policyDigest: request.target.policyDigest,
    modules: results,
    ...verdict,
    activation: "not_attempted",
  };
  return readBackupVerificationResult(JSON.stringify(result), request);
}

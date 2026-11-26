import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError, isAppError } from "@waitron/shared";
import { decryptArtifactFile } from "./artifact-cipher-file.js";
import { MAX_CLOUD_EXPANDED_BYTES } from "./cloud-backup-limits.js";
import { decodeArchiveFile } from "./backup-compression.js";
import { unpackArchiveFile } from "./backup-archive-file.js";
import { BackupManifestReadError, readBackupManifest } from "./backup-manifest-reader.js";
import {
  readArtifactIdentity,
  validateDatabaseEntries,
  type ValidationFileDeps,
  type ValidatedArtifact,
} from "./restore.js";
import type {
  BackupVerificationRequest,
  BackupVerificationReason,
} from "./backup-verification-protocol.js";
import "./errors.js";

export class BackupVerificationArchiveError extends Error {
  constructor(
    readonly status: "invalid" | "unsupported",
    readonly reason: BackupVerificationReason,
  ) {
    super("Backup verification archive refused");
    this.name = "BackupVerificationArchiveError";
  }
}
function unsupported(): never {
  throw new BackupVerificationArchiveError("unsupported", "archive_format_unsupported");
}
function binding(): never {
  throw new BackupVerificationArchiveError("invalid", "binding_mismatch");
}

function modulePairs(modules: Record<string, number>) {
  return Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : 1));
}

export async function validateBackupArtifactFile(
  input: Omit<ValidationFileDeps, "skipSecrets"> & {
    expected: Pick<BackupVerificationRequest, "archive" | "capturedAt" | "sourceNodeId">;
  },
): Promise<ValidatedArtifact> {
  await mkdir(input.stagingDir, { recursive: true, mode: 0o700 });
  const scratch = await mkdtemp(join(input.stagingDir, "backup-verification-archive-"));
  const discard = () => rm(scratch, { recursive: true, force: true });
  const plaintext = join(scratch, "plaintext");
  try {
    await decryptArtifactFile(input.artifactPath, plaintext, input.recoveryKey);
    const archive = await decodeArchiveFile(plaintext, join(scratch, "decoded"), {
      maxBytes: MAX_CLOUD_EXPANDED_BYTES,
    });
    const unpacked = await unpackArchiveFile(archive, scratch, { requireExactEnd: true });
    await rm(archive);
    const entries = unpacked.flatMap((entry) => (entry.kind === "bytes" ? [entry.entry] : []));
    const raw = entries.find((entry) => entry.name === "manifest.json");
    if (raw === undefined)
      throw new AppError("restore.archive_incomplete", { missing: "manifest.json" });
    const captured = readBackupManifest(raw.bytes);
    if (
      captured.manifestVersion !== input.expected.archive.manifestVersion ||
      captured.createdAt !== input.expected.capturedAt ||
      captured.environment !== input.expected.archive.environment ||
      !isDeepStrictEqual(modulePairs(captured.modules), modulePairs(input.expected.archive.modules))
    )
      binding();
    const database = unpacked.find((entry) => entry.kind === "file");
    if (database === undefined)
      throw new AppError("restore.archive_incomplete", { missing: "db.dump" });
    const validated = await validateDatabaseEntries(entries, database.path, {
      stateDir: input.stateDir,
      stagingDir: input.stagingDir,
      migrationsRoot: input.migrationsRoot,
      modules: input.modules,
      environment: input.environment,
    });
    if (readArtifactIdentity(validated.secretEntries).node.nodeId !== input.expected.sourceNodeId)
      binding();
    return {
      manifest: validated.manifest,
      secretEntries: validated.secretEntries,
      databasePath: validated.databasePath,
      nodeDump: validated.nodeDump,
      discard,
    };
  } catch (error) {
    await discard();
    if (error instanceof BackupManifestReadError)
      throw new BackupVerificationArchiveError(
        error.status,
        error.status === "invalid" ? "archive_invalid" : "archive_format_unsupported",
      );
    if (
      isAppError(error) &&
      ["backup.artifact_invalid", "backup.archive_invalid"].includes(error.code) &&
      "reason" in error.params &&
      error.params.reason === "bad_version"
    )
      unsupported();
    throw error;
  }
}

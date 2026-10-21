import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { AppError, isAppError } from "@waitron/shared";
import { decryptArtifactFile } from "./artifact-cipher-file.js";
import { unpackArchiveFile } from "./backup-archive-file.js";
import type { BackupManifest } from "./backup-manifest.js";
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
function invalid(): never {
  throw new BackupVerificationArchiveError("invalid", "archive_invalid");
}
function unsupported(): never {
  throw new BackupVerificationArchiveError("unsupported", "archive_format_unsupported");
}
function binding(): never {
  throw new BackupVerificationArchiveError("invalid", "binding_mismatch");
}

function rawJson(bytes: Uint8Array): unknown {
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) invalid();
    throw error;
  }
  let at = 0;
  function space() {
    while (at < raw.length && /[\x20\t\r\n]/.test(raw[at]!)) at++;
  }
  function string(): string {
    if (raw[at] !== '"') invalid();
    const start = at++;
    for (; at < raw.length; at++) {
      if (raw[at] === "\\") {
        at++;
        continue;
      }
      if (raw[at] === '"') {
        at++;
        try {
          return JSON.parse(raw.slice(start, at)) as string;
        } catch (error) {
          if (error instanceof SyntaxError) invalid();
          throw error;
        }
      }
    }
    invalid();
  }
  function value(depth: number): unknown {
    if (depth > 32) invalid();
    space();
    if (raw[at] === '"') return string();
    if (raw[at] === "{") {
      at++;
      space();
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      if (raw[at] === "}") {
        at++;
        return out;
      }
      for (;;) {
        space();
        const key = string();
        if (Object.hasOwn(out, key)) invalid();
        space();
        if (raw[at++] !== ":") invalid();
        out[key] = value(depth + 1);
        space();
        const next = raw[at++];
        if (next === "}") return out;
        if (next !== ",") invalid();
      }
    }
    if (raw[at] === "[") {
      at++;
      space();
      const out: unknown[] = [];
      if (raw[at] === "]") {
        at++;
        return out;
      }
      for (;;) {
        out.push(value(depth + 1));
        space();
        const next = raw[at++];
        if (next === "]") return out;
        if (next !== ",") invalid();
      }
    }
    for (const [token, parsed] of [
      ["null", null],
      ["true", true],
      ["false", false],
    ] as const) {
      if (raw.startsWith(token, at)) {
        at += token.length;
        return parsed;
      }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(raw.slice(at));
    if (!number) invalid();
    at += number[0].length;
    return Number(number[0]);
  }
  const out = value(0);
  space();
  if (at !== raw.length) invalid();
  return out;
}
function object(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) invalid();
  return raw as Record<string, unknown>;
}
function manifest(bytes: Uint8Array): BackupManifest {
  const value = object(rawJson(bytes));
  if (!Number.isSafeInteger(value.manifestVersion) || Number(value.manifestVersion) < 1) invalid();
  if (value.manifestVersion !== 1) unsupported();
  const keys = ["manifestVersion", "createdAt", "environment", "modules"];
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalid();
  if (
    typeof value.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(value.createdAt).toISOString() !== value.createdAt
  )
    invalid();
  if (value.environment !== "production" && value.environment !== "preproduction") invalid();
  const modules = object(value.modules);
  for (const [name, version] of Object.entries(modules))
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
      !Number.isSafeInteger(version) ||
      Number(version) < 0
    )
      invalid();
  return {
    manifestVersion: 1,
    createdAt: value.createdAt,
    environment: value.environment,
    modules: Object.fromEntries(Object.entries(modules)) as Record<string, number>,
  };
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
    const unpacked = await unpackArchiveFile(plaintext, scratch, { requireExactEnd: true });
    await rm(plaintext);
    const entries = unpacked.flatMap((entry) => (entry.kind === "bytes" ? [entry.entry] : []));
    const raw = entries.find((entry) => entry.name === "manifest.json");
    if (raw === undefined)
      throw new AppError("restore.archive_incomplete", { missing: "manifest.json" });
    const captured = manifest(raw.bytes);
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
      discard,
    };
  } catch (error) {
    await discard();
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

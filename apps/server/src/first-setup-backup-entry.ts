import { join } from "node:path";
import { lstat } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { ALL_MODULES } from "@waitron/composition";
import { deploymentEnvironmentFor, lockVenueDatabase } from "@waitron/db";
import {
  assertFirstSetupBackupBootTarget,
  createFirstSetupBackupWorkspace,
  resolveFirstSetupBackupWorkspace,
  type BackupRepairTarget,
} from "@waitron/provisioning";
import { createS3ObjectStore } from "@waitron/stream";
import { resolveLitestreamBin } from "@waitron/stream/litestream.js";
import { AppError } from "@waitron/shared";
import { boundObjectStore } from "./bounded-store.js";
import { loadCloudOrigin } from "./cloud-client.js";
import { DEFAULT_MIGRATIONS_ROOT } from "./boot.js";
import { isUnset } from "./env-value.js";
import { createFirstSetupBackupRecovery } from "./first-setup-backup-recovery.js";
import { RESTORE_STAGING_DIR } from "./restore.js";
import type { FirstFiscalHost } from "./setup-first-fiscal-api.js";
import type { FirstSetupRoots } from "./first-setup-resolution-inspection.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export function firstSetupBackupRecoveryFor(
  roots: FirstSetupRoots,
  environment: Readonly<Record<string, string | undefined>>,
  host: FirstFiscalHost,
  log: Logger,
) {
  roots = { venueDir: roots.venueDir, stateDir: roots.stateDir };
  const selectedEnvironment = deploymentEnvironmentFor(environment.WAITRON_ENV) ?? "preproduction";
  const cloudOrigin = loadCloudOrigin(environment);
  return createFirstSetupBackupRecovery({
    ...roots,
    host,
    environment: selectedEnvironment,
    modules: ALL_MODULES,
    workspace: createFirstSetupBackupWorkspace(roots),
    sources: {
      stateDir: roots.stateDir,
      stagingDir: join(roots.stateDir, RESTORE_STAGING_DIR),
      migrationsRoot: isUnset(environment.WAITRON_MIGRATIONS_DIR)
        ? DEFAULT_MIGRATIONS_ROOT
        : environment.WAITRON_MIGRATIONS_DIR!,
      modules: ALL_MODULES,
      bucket: {
        litestreamBin: resolveLitestreamBin(environment),
        now: () => new Date(),
        log,
        openStore: (bucket) => boundObjectStore(createS3ObjectStore(bucket)),
      },
    },
    ...(cloudOrigin === undefined || selectedEnvironment !== "preproduction"
      ? {}
      : {
          cloud: { origin: cloudOrigin, environment: selectedEnvironment },
        }),
    log,
  });
}

export async function resolveFirstSetupBackupEntry(roots: FirstSetupRoots) {
  roots = { venueDir: roots.venueDir, stateDir: roots.stateDir };
  let present = false;
  for (const root of Object.values(roots)) {
    try {
      await lstat(join(root, "first-setup-resolutions", "backup-recovery"));
      present = true;
    } catch (error) {
      if (!(
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        ["ENOENT", "ENOTDIR"].includes(String(error.code))
      ))
        present = true;
    }
  }
  if (!present) return { kind: "absent" as const };
  let selected: Awaited<ReturnType<typeof resolveFirstSetupBackupWorkspace>>;
  try {
    selected = await resolveFirstSetupBackupWorkspace(roots);
  } catch {
    return { kind: "repair" as const, roots };
  }
  if (selected.kind === "absent") return selected;
  if (selected.kind === "repair") return { kind: "repair" as const, roots: selected.target.anchor };
  const target: BackupRepairTarget = selected.target;
  return {
    kind: "selected" as const,
    roots: target.target,
    async run<T>(body: () => Promise<T>): Promise<T> {
      const locks: Awaited<ReturnType<typeof lockVenueDatabase>>[] = [];
      try {
        for (const root of new Set([
          target.anchor.venueDir,
          target.source.venueDir,
          target.target.venueDir,
        ]))
          locks.push(await lockVenueDatabase(root));
        const current = await resolveFirstSetupBackupWorkspace(target.anchor);
        if (current.kind !== "selected" || !isDeepStrictEqual(current.target, target))
          throw new AppError("setup.attempt_uncertain", {});
        await assertFirstSetupBackupBootTarget(target.target);
        return await body();
      } finally {
        for (const hold of locks.reverse()) hold.release();
      }
    },
  };
}

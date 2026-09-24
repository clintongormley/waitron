import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { buildManifest } from "./backup-manifest.js";
import { collectStateParts, assembleArchiveEntries } from "./archive-entries.js";
import { packArchive } from "./backup-archive.js";
import { encryptArtifactAsync } from "./artifact-cipher.js";
import type { DeploymentEnvironment } from "./config.js";
import "./errors.js";
export async function createCloudSnapshotArchive(
  deps: {
    db: Database;
    modules: readonly WaitronModule[];
    environment: DeploymentEnvironment;
    stateDir: string;
  },
  recoveryKey: string,
  at: Date,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; modules: Record<string, number> }> {
  signal.throwIfAborted();
  const staging = join(deps.stateDir, "cloud-snapshots", "staging"),
    path = join(staging, "venue.db");
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    const manifest = await buildManifest({ ...deps, now: at });
    const parts = await collectStateParts({ ...deps, resolvers: {} });
    signal.throwIfAborted();
    await deps.db.archiveTo(path);
    signal.throwIfAborted();
    if ((await stat(path)).size > 512 * 1024 * 1024) throw new AppError("cloud.unavailable", {});
    const packed = packArchive(assembleArchiveEntries(manifest, await readFile(path), parts));
    if (packed.length > 512 * 1024 * 1024) throw new AppError("cloud.unavailable", {});
    const bytes = await encryptArtifactAsync(packed, recoveryKey);
    signal.throwIfAborted();
    return { bytes, modules: manifest.modules };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

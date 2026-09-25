import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "@waitron/shared";
import { litestreamConfig, litestreamEnv, replicaUrl } from "./litestream.js";
import { spawnLitestream } from "./litestream-process.js";
import type { BucketConfig } from "./s3-store.js";
import { exitCategory } from "./supervisor.js";
import "./errors.js";

/**
 * A restore is abandoned when its output has not changed size for this long. The bound is activity,
 * not a fixed time: a large venue on a slow line can take far longer than any fixed bound would allow.
 */
export const RESTORE_STALL_MS = 2 * 60_000;

/** A backstop only, for a restore that keeps writing and never finishes. */
export const RESTORE_CEILING_MS = 6 * 60 * 60_000;

const RESTORE_POLL_MS = 5_000;

export interface RestoreGenerationArgs {
  litestreamBin: string;
  bucket: BucketConfig;
  venueId: string;
  generation: string;
  /** Must not exist, or exist empty, with no `-wal`, `-shm` or `-journal` beside it: Litestream
   * 0.5.17 refuses either (`cmd/litestream/restore.go:279-289`, `prepareOutputPath`). */
  outPath: string;
  /** Where the restore's configuration is written; `.litestream-restore` beside `outPath` when absent. */
  configDir?: string;
  stallMs?: number;
  ceilingMs?: number;
  pollMs?: number;
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/**
 * Restore the latest point of one generation into `outPath` with `litestream restore`.
 *
 * The configuration's database path is a name only and never exists: the bench rig measured on
 * 0.5.17 that restoring with the source absent returns every row (`bench/sqlite-failover/src/litestream.ts`).
 *
 * Progress is the size of `outPath` or `<outPath>.tmp`, whichever is larger: 0.5.17 writes into
 * `<outPath>.tmp` and renames it at the end. Measured 2026-09-23 on darwin/arm64 from a FILE replica,
 * a 420 MB restore showed 78 distinct sizes in 81 samples 20 ms apart; from an S3 bucket it is not
 * measured. Time is read from the monotonic clock, so a system clock set mid-restore moves neither
 * bound.
 */
export async function restoreGeneration(args: RestoreGenerationArgs): Promise<void> {
  const configDir = args.configDir ?? join(dirname(args.outPath), ".litestream-restore");
  const namedPath = join(configDir, "venue.db");
  const config = litestreamConfig({
    dbPath: namedPath,
    replicaUrl: replicaUrl(args.bucket, args.venueId, args.generation),
  });
  const env = litestreamEnv(args.bucket);
  const configPath = join(configDir, "restore.yml");
  try {
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    // Removed first so the write creates the file and `mode` applies.
    await rm(configPath, { force: true });
    await writeFile(configPath, config, { mode: 0o600 });
  } catch (error) {
    // The raw error names the folder; the code carries no path.
    throw new AppError("backup.stream_restore_failed", {
      exitCode: null,
      diskFull: (error as NodeJS.ErrnoException).code === "ENOSPC",
    });
  }
  const child = spawnLitestream(
    args.litestreamBin,
    ["restore", "-config", configPath, "-o", args.outPath, namedPath],
    env,
  );

  const stallMs = args.stallMs ?? RESTORE_STALL_MS;
  const ceilingMs = args.ceilingMs ?? RESTORE_CEILING_MS;
  const pollMs = args.pollMs ?? RESTORE_POLL_MS;
  const started = performance.now();
  let lastSize = -1;
  let changedAt = started;
  let finished = false;
  let abandoned = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exited = child.exited.then((code) => {
    finished = true;
    return code;
  });
  // Each check schedules the next only when it has finished, so two never overlap; one still
  // reading when the child exits sees `finished` and neither kills nor reschedules.
  const check = async (): Promise<void> => {
    const size = Math.max(await sizeOf(args.outPath), await sizeOf(`${args.outPath}.tmp`));
    if (finished) return;
    const now = performance.now();
    if (size !== lastSize) {
      lastSize = size;
      changedAt = now;
    }
    if (now - changedAt >= stallMs || now - started >= ceilingMs) {
      abandoned = true;
      child.kill();
      return;
    }
    timer = setTimeout(() => void check(), pollMs);
  };
  timer = setTimeout(() => void check(), pollMs);

  let exitCode: number | null;
  try {
    exitCode = await exited;
  } finally {
    clearTimeout(timer);
  }
  if (abandoned || exitCode !== 0) {
    throw new AppError("backup.stream_restore_failed", {
      exitCode: abandoned ? null : exitCode,
      diskFull: exitCategory(exitCode, child.output()) === "disk_full",
    });
  }
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { VENUE_FILE } from "@waitron/store";
import { generationPrefix } from "./generations.js";
import { litestreamConfig, litestreamEnv, replicaUrl } from "./litestream.js";
import { spawnLitestream, type SpawnFn } from "./litestream-process.js";
import { createS3ObjectStore, type BucketConfig } from "./s3-store.js";
import { verifyStreamKey } from "./sse-c.js";
import type { ObjectStore } from "./object-store.js";

export interface FollowProgress {
  generation: string;
  state: "rebuilding" | "following" | "unknown";
  appliedTXID: string | null;
  uploadedTXID: string | null;
  /** Elapsed monotonic time since an unapplied upload was first observed. */
  lagMs: number | null;
  lastAppliedAt: string | null;
}
export interface Follower {
  read(): Promise<FollowProgress>;
  stop(): Promise<void>;
}
export interface FollowArgs {
  litestreamBin: string;
  bucket: BucketConfig;
  streamKey: string;
  generation: string;
  /** Fresh, isolated scratch output. Never an open SQLite database. */
  outPath: string;
  now: () => Date;
  monotonic?: () => number;
  signal?: AbortSignal;
  store?: ObjectStore;
  spawn?: SpawnFn;
}

export async function followGeneration(args: FollowArgs): Promise<Follower> {
  await verifyStreamKey(
    args.bucket,
    args.generation,
    args.streamKey,
    args.signal === undefined ? undefined : { signal: args.signal },
  );
  args.signal?.throwIfAborted();
  const folder = `${args.outPath}.follow`;
  const namedPath = join(folder, VENUE_FILE);
  const configPath = join(folder, "follow.yml");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(
    configPath,
    litestreamConfig({ dbPath: namedPath, replicaUrl: replicaUrl(args.bucket, args.generation) }),
    { mode: 0o600 },
  );
  args.signal?.throwIfAborted();
  const child = (args.spawn ?? spawnLitestream)(
    args.litestreamBin,
    ["restore", "-f", "-config", configPath, "-o", args.outPath, namedPath],
    litestreamEnv(args.bucket, args.streamKey),
  );
  const store = args.store ?? createS3ObjectStore(args.bucket);
  const monotonic = args.monotonic ?? (() => performance.now());
  let pendingSince: number | null = null;
  let uploaded: string | null = null;
  let ended = false;
  let stopping = false;
  let applied: string | null = null;
  let lastAppliedAt: string | null = null;
  void child.exited.then(() => {
    ended = true;
  });
  const unknown = (state: FollowProgress["state"] = "unknown"): FollowProgress => ({
    generation: args.generation,
    state,
    appliedTXID: applied,
    uploadedTXID: uploaded,
    lagMs: null,
    lastAppliedAt,
  });
  return {
    async read() {
      if (ended || stopping) return unknown();
      try {
        const txid = (await readFile(`${args.outPath}-txid`, "utf8")).trim();
        if (!/^[0-9a-f]{16}$/.test(txid) || txid === "0000000000000000") return unknown();
        const prefix = generationPrefix(args.generation);
        const files = (await store.list(prefix)).flatMap((object) => {
          const match = /^[0-9a-f]{4}\/([0-9a-f]{16})-([0-9a-f]{16})\.ltx$/.exec(
            object.key.slice(prefix.length),
          );
          return match === null ? [] : [{ txid: match[2]!, at: object.lastModified.getTime() }];
        });
        if (ended || stopping || files.length === 0) return unknown();
        if (txid !== applied) {
          applied = txid;
          lastAppliedAt = args.now().toISOString();
        }
        const newest = files.reduce((a, b) => (a.txid > b.txid ? a : b)).txid;
        if (txid > newest) return unknown();
        uploaded = newest;
        pendingSince = txid === newest ? null : (pendingSince ?? monotonic());
        const lagMs = pendingSince === null ? 0 : Math.max(0, monotonic() - pendingSince);
        return {
          generation: args.generation,
          state: "following",
          appliedTXID: applied,
          uploadedTXID: uploaded,
          lagMs,
          lastAppliedAt,
        };
      } catch (error) {
        return unknown(
          (error as NodeJS.ErrnoException).code === "ENOENT" ? "rebuilding" : "unknown",
        );
      }
    },
    async stop() {
      stopping = true;
      if (!ended) child.kill();
      await child.exited;
    },
  };
}

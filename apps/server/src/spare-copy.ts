import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { nodeSigningPublicKey, readPairSecret, type KeyRing } from "@waitron/credentials";
import { nodes, type Database, type NodeDatabase } from "@waitron/db";
import { manifestSets, type MigrationFiles } from "@waitron/migrations";
import { readPairLink, readPinnedPrimaryKey, type PairLink } from "@waitron/node-db";
import { assertNotAhead, writeFileDurable } from "@waitron/provisioning";
import { codeOf } from "@waitron/server-kit";
import { hasCode, isAppError } from "@waitron/shared";
import { connectionPair, drizzleNodeSqlite, PAIR_COPY_DIR, VENUE_FILE } from "@waitron/store";
import {
  abortableSleep,
  createS3ObjectStore,
  readPointer,
  restoreGeneration,
  verifyPointer,
  type BucketConfig,
  type ObjectStore,
} from "@waitron/stream";
import { readHeldKey } from "./backup-config.js";
import type { Logger } from "./logger.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { checkIntegrity } from "./restore-stream.js";
import { spareStoreBucket, type SpareStore } from "./spare-store.js";
import { deriveStreamKey } from "./stream-key.js";
import { reachDisk } from "./sync-path.js";

const INTERVAL_MS = 5_000;
export const PAIR_COPY_READY_FILE = "ready.json";

export type FirstCopyStatus =
  { copy: "waiting" } | { copy: "restoring" } | { copy: "ready"; bytes: number; ms: number };

export interface FirstCopyDeps {
  stateDir: string;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  litestreamBin: string;
  store: SpareStore;
  /** From `copyNeededLink`. */
  link: PairLink;
  now: () => Date;
  log: Logger;
  signal: AbortSignal;
  /** Called on every attempt, so a key written to `backup.env` after the start is found. */
  readRecoveryKey: () => Promise<string | undefined>;
  migrationsRoot: string | null;
  restart: () => void;
  report: (status: FirstCopyStatus) => void;
  openStore?: (bucket: BucketConfig) => ObjectStore;
  restoreGeneration?: typeof restoreGeneration;
  checkIntegrity?: (databasePath: string) => Promise<boolean>;
  intervalMs?: number;
}

/** Why an attempt ended without a copy; the reason is what `spare.first_copy_waiting` logs. */
class NotYet extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * Every `intervalMs`, restores the generation the main box's signed pointer names from this box's
 * own store into `<state>/pair-copy/venue.db`, until a copy passes its checks; then writes
 * `ready.json` beside it and asks for a restart. A pointer the key pinned at the join
 * (`node_primary_key`) did not sign is ignored. Rejects with the signal's reason once it aborts.
 */
export async function takeFirstCopy(deps: FirstCopyDeps): Promise<"ready"> {
  const intervalMs = deps.intervalMs ?? INTERVAL_MS;
  const { link } = deps;
  const { venueId } = link;
  const pin = await readPinnedPrimaryKey(deps.node, deps.nodeId);
  // Adopt pins the main box's key in the transaction that writes the link.
  if (pin === null) throw new Error("a joining spare holds no pinned main-box key");
  const pinnedKey = pin.publicKey;
  const bucket = spareStoreBucket(
    deps.store.loopbackUrl,
    link.accessKeyId,
    await readPairSecret(deps.node, deps.ring, deps.nodeId),
  );
  const objectStore = (deps.openStore ?? createS3ObjectStore)(bucket);
  const ownPublicKey = nodeSigningPublicKey(
    await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId),
  );
  const folder = join(deps.stateDir, PAIR_COPY_DIR);
  const copyPath = join(folder, VENUE_FILE);
  let lastReason: string | undefined;
  deps.report({ copy: "waiting" });
  for (;;) {
    deps.signal.throwIfAborted();
    try {
      const ready = await attempt();
      deps.log("info", "spare.first_copy_ready", { ...ready });
      deps.report({ copy: "ready", ...ready });
      deps.restart();
      return "ready";
    } catch (error) {
      deps.signal.throwIfAborted();
      const reason = error instanceof NotYet ? error.reason : codeOf(error);
      deps.report({ copy: "waiting" });
      const status =
        isAppError(error) && hasCode(error, "backup.stream_request_failed")
          ? error.params.status
          : null;
      if (reason !== lastReason)
        deps.log("info", "spare.first_copy_waiting", {
          reason,
          ...(status === null ? {} : { status }),
        });
      lastReason = reason;
      await rm(folder, { recursive: true, force: true }).catch(() => {});
    }
    await abortableSleep(intervalMs, deps.signal);
  }

  async function attempt(): Promise<{ bytes: number; ms: number }> {
    const { held, key } = await readHeldKey(deps.readRecoveryKey);
    if (key === undefined) throw new NotYet(held ? "key_too_short" : "no_key");
    const read = await readPointer(objectStore, venueId);
    if (read === null) throw new NotYet("no_pointer");
    if (!verifyPointer(read.pointer, pinnedKey)) throw new NotYet("pointer_unverified");
    const { generation } = read.pointer.body;
    // Litestream refuses a non-empty output file.
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true, mode: 0o700 });
    deps.report({ copy: "restoring" });
    await (deps.restoreGeneration ?? restoreGeneration)({
      litestreamBin: deps.litestreamBin,
      bucket,
      streamKey: deriveStreamKey(key, venueId),
      venueId,
      generation,
      outPath: copyPath,
    });
    deps.signal.throwIfAborted();
    if (!(await (deps.checkIntegrity ?? checkIntegrity)(copyPath)))
      throw new NotYet("integrity_failed");
    // `copyNeededLink` relies on the placed copy holding this row; the main box writes it before it
    // streams, so a copy without it is only a late one.
    if (!(await checkCopy(copyPath, deps.nodeId, ownPublicKey, deps.migrationsRoot)))
      throw new NotYet("own_row_missing");
    const ms = deps.now().getTime() - link.createdAt.getTime();
    await reachDisk(copyPath);
    const bytes = (await stat(copyPath)).size;
    await writeFileDurable(join(folder, PAIR_COPY_READY_FILE), "{}", 0o600);
    return { bytes, ms };
  }
}

/**
 * Opened read-only, so the checks cannot change the copy. Refuses a schema ahead of this software;
 * true only when the copy's `nodes` row for this box holds this box's own key.
 */
async function checkCopy(
  path: string,
  nodeId: string,
  ownPublicKey: string,
  migrationsRoot: string | null,
): Promise<boolean> {
  const connection = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    const copy = drizzleNodeSqlite(connectionPair(connection, connection), { schema: {} });
    const files: MigrationFiles = { venue: copy, node: copy };
    // The copy is venue.db alone; node.db's sets are this box's own.
    const venueSets = manifestSets().filter((set) => set.database !== "node");
    await assertNotAhead(files, venueSets, migrationsRoot);
    const [row] = await copy
      .select({ publicKey: nodes.publicKey })
      .from(nodes)
      .where(eq(nodes.id, nodeId));
    return row?.publicKey === ownPublicKey;
  } finally {
    connection.close();
  }
}

/**
 * This box's pair link while it awaits its first copy and its `venue.db` holds no `nodes` row for
 * it: a placed copy always holds that row, so the start that finishes joining takes no second copy.
 */
export async function copyNeededLink(deps: {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
}): Promise<PairLink | undefined> {
  const link = await readPairLink(deps.node, deps.nodeId);
  if (link?.role !== "serves" || link.state !== "awaiting_copy") return undefined;
  const [row] = await deps.db.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, deps.nodeId));
  return row === undefined ? link : undefined;
}

/** The status a box still joining answers. */
export function mountLatchBoxStatus(app: Hono, read: () => FirstCopyStatus | undefined): void {
  app.get("/api/box/status", (c) => c.json({ adoption: "pending", ...read() }, 200));
}

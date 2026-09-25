import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { KeyRing } from "@waitron/credentials";
import { persistNodeMembershipIfNewer, readNodeMembership, type Database } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import { AppError, isAppError } from "@waitron/shared";
import {
  createS3ObjectStore,
  readPointer,
  type BucketConfig,
  type ObjectStore,
} from "@waitron/stream";
import { reissueBoxLeaf } from "./box-secrets.js";
import type { Logger } from "./logger.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import { readStreamSettings } from "./stream-host.js";

/** Left in the state folder by `writeValidated` (restore.ts) whenever a restore takes on the
 * archive's identity; holds `{ version: 1, source }`. */
export const REBUILD_MARKER = "rebuild-first-start.json";

/** Which restore wrote the marker. Both get the same first start (slice-2 spec §5.1 step 7). */
export type RebuildSource = "archive" | "stream";

export interface RebuildDeps {
  stateDir: string;
  db: Database;
  ring: KeyRing;
  nodeId: string;
  /** This machine's `advertisedOrigin`, what tills route on. */
  contactUrl: string;
  hostnames: string[];
  listIpv4: () => string[];
  now: () => Date;
  log: Logger;
  /** The term the bucket's pointer names, or null when no bucket is set up or it holds no pointer.
   * Rejects when a bucket is set up but its pointer cannot be read, which fails the first start.
   * Asked only when a marker is found. */
  pointerTerm?: () => Promise<number | null>;
}

/**
 * A restored box's first trading start: a certificate naming this machine's addresses, then the
 * membership document one term higher naming this machine's contact address. Does nothing, and
 * returns false, when no restore left its marker.
 *
 * The marker is removed last, so a failure or a crash part-way re-runs every step at the next
 * start. Each re-run issues another leaf and, once the term has been stored, moves the term up
 * again.
 */
export async function completeRebuild(deps: RebuildDeps): Promise<boolean> {
  const marker = join(deps.stateDir, REBUILD_MARKER);
  let body: string;
  try {
    body = await readFile(marker, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  // Started before the re-issue's key generation so the bucket wait overlaps it. The empty catch
  // only marks the promise handled for when the re-issue throws first; the await below still sees
  // a rejection.
  const pointerRead = deps.pointerTerm?.() ?? Promise.resolve(null);
  pointerRead.catch(() => {});
  await reissueBoxLeaf({
    stateDir: deps.stateDir,
    hostnames: deps.hostnames,
    now: deps.now,
    listIpv4: deps.listIpv4,
  });
  const held = await readNodeMembership(deps.db);
  const nodes =
    held === null
      ? [{ nodeId: deps.nodeId, contactUrl: deps.contactUrl, standing: "serving-primary" as const }]
      : held.body.nodes.map((n) =>
          n.nodeId === deps.nodeId ? { ...n, contactUrl: deps.contactUrl } : n,
        );
  // Never below the bucket's pointer: the stream supervisor refuses to replace a pointer naming a
  // higher term (slice-2 spec §5.1 step 7).
  const pointerTerm = await pointerRead;
  const next = await mintNextMembershipDocument(
    { db: deps.db, ring: deps.ring },
    {
      heldDocument: held,
      nodes,
      signerNodeId: deps.nodeId,
      ...(pointerTerm === null ? {} : { minTerm: pointerTerm + 1 }),
    },
  );
  await persistNodeMembershipIfNewer(deps.db, next);
  deps.log("info", "restore.first_start_done", { term: next.body.term, source: sourceOf(body) });
  await rm(marker, { force: true });
  return true;
}

/** Only a restore writes the marker, so a body that cannot be read still means one happened. */
function sourceOf(body: string): RebuildSource | "unknown" {
  try {
    const source = (JSON.parse(body) as { source?: unknown }).source;
    return source === "archive" || source === "stream" ? source : "unknown";
  } catch {
    return "unknown";
  }
}

/** What boot does after the first start: whether the bucket copy may start, and since when the
 * `restore.first_start_failed` alert is raised (null: not raised). */
export interface FirstStart {
  mayStream: boolean;
  failedSince: string | null;
}

/**
 * {@link completeRebuild}, for boot. A failure never keeps the box shut: it sells, does not stream
 * (its term may not have moved), and the marker stays so the next start tries again (slice-2
 * spec §5.3). The log carries the error's code only.
 */
export async function runFirstStart(deps: RebuildDeps): Promise<FirstStart> {
  try {
    await completeRebuild(deps);
    return { mayStream: true, failedSince: null };
  } catch (error) {
    deps.log("error", "restore.first_start_failed", { errorCode: codeOf(error) });
    return { mayStream: false, failedSince: deps.now().toISOString() };
  }
}

/**
 * For a box that must not finish a restore now: nothing is re-issued or signed, the marker stays,
 * and the bucket copy is held while it is there (or while its presence cannot be read).
 */
export async function deferFirstStart(stateDir: string, log: Logger): Promise<FirstStart> {
  try {
    await access(join(stateDir, REBUILD_MARKER));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { mayStream: true, failedSince: null };
    }
    return { mayStream: false, failedSince: null };
  }
  log("warn", "restore.first_start_deferred", {});
  return { mayStream: false, failedSince: null };
}

/** How long a first start waits for the bucket's pointer. */
export const POINTER_READ_TIMEOUT_MS = 15_000;

const TIMED_OUT = Symbol("timed out");

/**
 * The term the owner's bucket's pointer names, for {@link RebuildDeps.pointerTerm}. Null when the
 * box has no bucket settings or the bucket holds no pointer. Throws when settings are stored but
 * the term cannot be learnt — the settings cannot be read, the pointer is malformed, or the bucket
 * cannot be opened or read or does not answer within the bound — with the failure's own code, or
 * `restore.pointer_unreadable` for the bound and for a failure that has none. A request still
 * waiting at the bound is abandoned, not cancelled: the bucket interface takes no way to stop it.
 */
export async function readBucketPointerTerm(
  db: Database,
  ring: KeyRing,
  options: { openStore?: (bucket: BucketConfig) => ObjectStore; timeoutMs?: number } = {},
): Promise<number | null> {
  const settings = await readStreamSettings(db, ring);
  if (settings === null) return null;
  let read: Awaited<ReturnType<typeof readPointer>> | typeof TIMED_OUT;
  try {
    const store = (options.openStore ?? createS3ObjectStore)(settings.bucket);
    read = await Promise.race([
      readPointer(store, settings.venueId),
      delay(options.timeoutMs ?? POINTER_READ_TIMEOUT_MS, TIMED_OUT, { ref: false }),
    ]);
  } catch (error) {
    if (isAppError(error)) throw error;
    throw new AppError("restore.pointer_unreadable", {});
  }
  if (read === TIMED_OUT) throw new AppError("restore.pointer_unreadable", {});
  return read === null ? null : read.pointer.body.term;
}

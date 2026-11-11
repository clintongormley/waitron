import { TRADING_ENV_FILE, TRADING_ENV_REPLACED_SUFFIX } from "@waitron/store";
import { rm } from "node:fs/promises";
import { syncFolderHolding } from "./fs-atomic.js";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { KeyRing } from "@waitron/credentials";
import {
  persistNodeMembershipIfNewer,
  readMembershipTrustSet,
  readNodeMembership,
  readNodeMembershipRow,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { isMembershipDocument, verifyMembershipDocument } from "@waitron/membership";
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
import { ownContactUrl } from "./box-name.js";
import { endRestoreFlow, firstStartPending } from "./restore-flow.js";
import "./errors.js";

export type RebuildSource = "archive" | "stream";

export interface RebuildDeps {
  stateDir: string;
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  /** This machine's `advertisedOrigin`; its chart row carries `ownContactUrl` of it. */
  advertisedOrigin: string;
  hostnames: string[];
  listIpv4: () => string[];
  now: () => Date;
  log: Logger;
  /** The term the bucket's pointer names, or null when no bucket is set up or it holds no pointer.
   * Rejects when a bucket is set up but its pointer cannot be read, which fails the first start.
   */
  pointerTerm?: () => Promise<number | null>;
}

/**
 * Throws `restore.membership_invalid` when the held membership document fails its check against the
 * node keys in the same database; a database holding no document passes. The keys come from the
 * restored copy itself, so a copy whose `nodes` keys were rewritten along with its document passes.
 */
export async function assertRestoredMembershipValid(db: Database): Promise<void> {
  const held = await readNodeMembership(db);
  if (held === null) return;
  const verdict = verifyMembershipDocument(held, await readMembershipTrustSet(db));
  if (!verdict.valid) throw new AppError("restore.membership_invalid", { reason: verdict.reason });
}

/**
 * Throws `restore.membership_invalid` with the reason `malformed` when a restore's first start is pending
 * and the held membership row's stored text is not JSON, or is not shaped as a document (the JSON
 * value `null` included). Boot runs it before its first read of the document. Passes when the row or
 * the table is absent, and does nothing when no restore has a pending first start.
 */
export async function assertRestoredMembershipReadable(
  stateDir: string,
  db: Database,
): Promise<void> {
  if ((await firstStartPending(stateDir)) === null) return;
  let row: { document: unknown } | null;
  try {
    row = await readNodeMembershipRow(db);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AppError("restore.membership_invalid", { reason: "malformed" });
    }
    throw error;
  }
  if (row !== null && !isMembershipDocument(row.document)) {
    throw new AppError("restore.membership_invalid", { reason: "malformed" });
  }
}

/**
 * A restored box's first trading start: a check of the restored membership document, a certificate
 * naming this machine's addresses, then the membership document one term higher naming this
 * machine's contact address. Does nothing, and returns false, when no restore has a pending first start.
 *
 * The flow is ended last, so a failure or a crash part-way re-runs every step at the next
 * start. Each re-run issues another leaf and, once the term has been stored, moves the term up
 * again.
 */
export async function completeRebuild(deps: RebuildDeps): Promise<boolean> {
  const pending = await firstStartPending(deps.stateDir);
  if (pending === null) return false;
  await assertRestoredMembershipValid(deps.db);
  await reissueBoxLeaf({
    stateDir: deps.stateDir,
    hostnames: deps.hostnames,
    now: deps.now,
    listIpv4: deps.listIpv4,
  });
  const held = await readNodeMembership(deps.db);
  const contactUrl = ownContactUrl(deps.advertisedOrigin, deps.nodeId);
  const nodes =
    held === null
      ? [{ nodeId: deps.nodeId, contactUrl, standing: "serving-primary" as const }]
      : held.body.nodes.map((n) => (n.nodeId === deps.nodeId ? { ...n, contactUrl } : n));
  // Never below the bucket's pointer: the stream supervisor refuses to replace a pointer naming a
  // higher term.
  const pointerTerm = (await deps.pointerTerm?.()) ?? null;
  const next = await mintNextMembershipDocument(
    { db: deps.db, node: deps.node, ring: deps.ring },
    {
      heldDocument: held,
      nodes,
      signerNodeId: deps.nodeId,
      // `assertRestoredMembershipValid` above checked it against the keys venue.db names.
      verifyHeld: "none",
      ...(pointerTerm === null ? {} : { minTerm: pointerTerm + 1 }),
    },
  );
  await persistNodeMembershipIfNewer(deps.db, next);
  deps.log("info", "restore.first_start_done", { term: next.body.term, source: pending.source });
  const replaced = join(deps.stateDir, `${TRADING_ENV_FILE}${TRADING_ENV_REPLACED_SUFFIX}`);
  try {
    await rm(replaced);
    await syncFolderHolding(replaced);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await endRestoreFlow(deps.stateDir);
  return true;
}

/** What boot does after the first start: whether the bucket copy may start, and since when the
 * `restore.first_start_failed` alert is raised (null: not raised). */
export interface FirstStart {
  mayStream: boolean;
  failedSince: string | null;
}

/**
 * {@link completeRebuild}, for boot. A failure does not keep the box shut: it sells, does not
 * stream (its term may not have moved), and the first-start record stays so the next start tries again. The log
 * carries the error's code only. The exception is `restore.membership_invalid`, which is thrown on,
 * so the start fails, and once starts have failed repeatedly the recovery page shows it.
 */
export async function runFirstStart(deps: RebuildDeps): Promise<FirstStart> {
  try {
    await completeRebuild(deps);
    return { mayStream: true, failedSince: null };
  } catch (error) {
    if (isAppError(error) && error.code === "restore.membership_invalid") throw error;
    deps.log("error", "restore.first_start_failed", { errorCode: codeOf(error) });
    return { mayStream: false, failedSince: deps.now().toISOString() };
  }
}

/**
 * For a box that must not finish a restore now: nothing is re-issued or signed, the first-start record stays,
 * and the bucket copy is held while it is there (or while its presence cannot be read).
 */
export async function deferFirstStart(stateDir: string, log: Logger): Promise<FirstStart> {
  try {
    if ((await firstStartPending(stateDir)) === null) return { mayStream: true, failedSince: null };
  } catch {
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
 * `restore.pointer_unreadable` for the bound and for a failure that has none. A read still
 * waiting at the bound is cancelled.
 */
export async function readBucketPointerTerm(
  db: Database,
  ring: KeyRing,
  options: { openStore?: (bucket: BucketConfig) => ObjectStore; timeoutMs?: number } = {},
): Promise<number | null> {
  let read: Awaited<ReturnType<typeof readPointer>> | typeof TIMED_OUT;
  try {
    const settings = await readStreamSettings(db, ring);
    if (settings === null) return null;
    const store = (options.openStore ?? createS3ObjectStore)(settings.bucket);
    const reading = new AbortController();
    const bound = new AbortController();
    try {
      read = await Promise.race([
        readPointer(store, settings.venueId, { signal: reading.signal }),
        delay(options.timeoutMs ?? POINTER_READ_TIMEOUT_MS, TIMED_OUT, {
          ref: false,
          signal: bound.signal,
        }),
      ]);
    } finally {
      bound.abort();
    }
    if (read === TIMED_OUT) reading.abort();
  } catch (error) {
    if (isAppError(error)) throw error;
    throw new AppError("restore.pointer_unreadable", {});
  }
  if (read === TIMED_OUT) throw new AppError("restore.pointer_unreadable", {});
  return read === null ? null : read.pointer.body.term;
}

export { REBUILD_MARKER } from "@waitron/store";

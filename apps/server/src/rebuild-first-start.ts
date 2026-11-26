import { readRestoreFlowPhase } from "@waitron/provisioning";
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
  parseGenerationName,
  readPointer,
  type BucketConfig,
  type S3ObjectStore,
} from "@waitron/stream";
import { reissueBoxLeaf } from "./box-secrets.js";
import type { Logger } from "./logger.js";
import { mintNextMembershipDocument } from "./membership-mint.js";
import { readStreamSettings } from "./stream-host.js";
import { ownContactUrl } from "./box-name.js";
import {
  endRestoreFlow,
  firstStartPending,
  readRestoreFlow,
  updateRestoreFlow,
} from "./restore-flow.js";
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
  bucketTerm?: () => Promise<number | null>;
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
 * naming this machine's addresses, then a membership document naming this machine's contact
 * address above the restored chart and the observed bucket term. Does nothing, and returns false,
 * when no restore has a pending first start.
 *
 * The first-start indication is cleared last, so a failure or a crash part-way re-runs every step at the next
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
  const bucketTerm = (await deps.bucketTerm?.()) ?? null;
  // Leave room for the next membership change after this restore advances the term.
  if (bucketTerm !== null && bucketTerm >= Number.MAX_SAFE_INTEGER - 1) {
    throw new AppError("restore.bucket_term_invalid", {});
  }
  const next = await mintNextMembershipDocument(
    { db: deps.db, node: deps.node, ring: deps.ring },
    {
      heldDocument: held,
      nodes,
      signerNodeId: deps.nodeId,
      // `assertRestoredMembershipValid` above checked it against the keys venue.db names.
      verifyHeld: "none",
      ...(bucketTerm === null ? {} : { minTerm: bucketTerm + 1 }),
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
  const phase = await readRestoreFlowPhase(deps.stateDir);
  if (phase === "staged" || phase === "placing") {
    const record = await readRestoreFlow(deps.stateDir);
    await updateRestoreFlow(deps.stateDir, { ...record!, firstStart: undefined });
  } else await endRestoreFlow(deps.stateDir);
  return true;
}

/** What boot does after the first start: whether the bucket copy may start, and since when the
 * `restore.first_start_failed` alert is raised (null: not raised). */
export interface FirstStart {
  mayStream: boolean;
  failedSince: string | null;
}

/** {@link completeRebuild}, for boot. */
export async function runFirstStart(deps: RebuildDeps): Promise<FirstStart> {
  try {
    await completeRebuild(deps);
    return { mayStream: true, failedSince: null };
  } catch (error) {
    if (
      isAppError(error) &&
      ["restore.membership_invalid", "restore.flow_unreadable"].includes(error.code)
    )
      throw error;
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
  } catch (error) {
    if (isAppError(error) && error.code === "restore.flow_unreadable") throw error;
    return { mayStream: false, failedSince: null };
  }
  log("warn", "restore.first_start_deferred", {});
  return { mayStream: false, failedSince: null };
}

const BUCKET_READ_TIMEOUT_MS = 15_000;

const TIMED_OUT = Symbol("timed out");

async function highestBucketTerm(
  store: S3ObjectStore,
  streamId: string,
  signal: AbortSignal,
): Promise<number | null> {
  const pointer = await readPointer(store, streamId, { signal });
  let highest = pointer?.pointer.body.term ?? null;
  for (const name of await store.listFolders("gen-", { signal })) {
    const generation = parseGenerationName(name);
    if (generation !== null) highest = Math.max(highest ?? 0, generation.term);
  }
  return highest;
}

/**
 * An opened generation can be ahead of the published pointer. Both reads must answer within
 * one deadline before a restore can use the highest observed term.
 */
export async function readBucketTerm(
  db: Database,
  ring: KeyRing,
  options: { openStore?: (bucket: BucketConfig) => S3ObjectStore; timeoutMs?: number } = {},
): Promise<number | null> {
  try {
    const settings = await readStreamSettings(db, ring);
    if (settings === null) return null;
    const store = (options.openStore ?? createS3ObjectStore)(settings.bucket);
    const reading = new AbortController();
    const bound = new AbortController();
    try {
      const term = await Promise.race([
        highestBucketTerm(store, settings.streamId, reading.signal),
        delay(options.timeoutMs ?? BUCKET_READ_TIMEOUT_MS, TIMED_OUT, {
          ref: false,
          signal: bound.signal,
        }),
      ]);
      if (term === TIMED_OUT) {
        reading.abort();
        throw new AppError("restore.pointer_unreadable", {});
      }
      return term;
    } finally {
      bound.abort();
    }
  } catch (error) {
    if (isAppError(error)) throw error;
    throw new AppError("restore.pointer_unreadable", {});
  }
}

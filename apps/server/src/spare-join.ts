import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { readPairSecret, setPairLinkStateTx, type KeyRing } from "@waitron/credentials";
import {
  insertReservedNodeTx,
  nodes,
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { endorseKey } from "@waitron/membership";
import { readPairLink, type PairLink } from "@waitron/node-db";
import { codeOf } from "@waitron/server-kit";
import { AppError, hasCode, isAppError } from "@waitron/shared";
import { createS3ObjectStore, probeBucket } from "@waitron/stream";
import { TLS_CLIENT_CERT_FILE, TLS_CLIENT_KEY_FILE } from "@waitron/store";
import type { Turns } from "./backup-turns.js";
import type { BoxAddresses } from "./box-lookup.js";
import { caCertPath } from "./box-secrets.js";
import { createLoopWaker } from "./loop-wake.js";
import "./errors.js";
import type { Logger } from "./logger.js";
import { readNodeIdentityKey } from "./node-identity.js";
import { startStorePipe, type StorePipe } from "./spare-pipe.js";
import { spareStoreBucket } from "./spare-store.js";
import type { StreamHost } from "./stream-host.js";

const INTERVAL_MS = 5_000;

export interface SpareJoinDeps {
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  /** Holds the venue authority and this box's client certificate, for the default probe's pipe. */
  stateDir: string;
  stream: Pick<StreamHost, "reload">;
  /** The queue every reload of the stream takes: the host refuses a reload beside another. */
  turns: Turns;
  /** Whether the spare's store answers the pair's key; through a store pipe when absent. */
  probe?: Probe;
  /** The default probe's pipe's address lookup; the venue network's answer when absent. */
  storeLookup?: (hostname: string) => Promise<BoxAddresses>;
  intervalMs?: number;
  log: Logger;
}

export interface SpareJoin {
  /** Asks the pair link again now; the joining route calls it once its pending link is written. */
  wake(): void;
  stop(): Promise<void>;
}

/** On `setTimeout`, not `abortableSleep`: Vitest's fake timers do not reach `node:timers/promises`. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * While this box's pair link is `pending`, asks the spare's store every `intervalMs`; once it
 * answers, records the spare in venue.db's `nodes` (which makes it a counted peer at a later start)
 * and marks the link `streaming`, then reloads the stream so the copy goes to the spare. Asks
 * nothing while no pending link is left to ask, until `wake`.
 */
export function startSpareJoin(deps: SpareJoinDeps): SpareJoin {
  const intervalMs = deps.intervalMs ?? INTERVAL_MS;
  const probe = deps.probe ?? storeProbe(deps);
  const stopping = new AbortController();
  const { signal } = stopping;
  const waker = createLoopWaker({ minTickMs: 0, delay: sleep });
  // The link a key mismatch refused, so it is logged once and not asked again.
  let refused: PairLink | undefined;
  let running: Promise<void> | undefined;
  // A wake during a pass whose read may predate the link it announces keeps the loop going.
  let woken = false;

  /** Whether the link is still to be asked. */
  async function pass(): Promise<boolean> {
    try {
      const link = await readPairLink(deps.node, deps.nodeId);
      if (link?.role !== "streams" || link.state !== "pending" || sameLink(link, refused)) {
        await probe.close?.();
        return false;
      }
      if (!(await probe(link, signal)) || signal.aborted) return true;
      try {
        if (!(await recordSpare(deps, link))) return true;
        deps.log("info", "spare.joined", { peerNodeId: link.peerNodeId });
        await deps.turns(() => deps.stream.reload());
        return false;
      } catch (error) {
        if (!isAppError(error) || !hasCode(error, "spare.join_key_mismatch")) throw error;
        refused = link;
        deps.log("error", "spare.join_key_mismatch", { peerNodeId: link.peerNodeId });
        return false;
      }
    } catch (error) {
      if (!signal.aborted) deps.log("warn", "spare.join_failed", { errorCode: codeOf(error) });
      return true;
    }
  }

  async function run(): Promise<void> {
    while (!signal.aborted) {
      woken = false;
      const asking = await pass();
      // Cleared in the same turn as the check, so a later wake starts a new run.
      if (!asking && !woken && !signal.aborted) {
        running = undefined;
        return;
      }
      await waker.sleep(intervalMs, signal);
    }
    await probe.close?.();
  }

  running = run();
  return {
    wake() {
      if (signal.aborted) return;
      woken = true;
      if (running === undefined) running = run();
      else waker.wake();
    },
    async stop() {
      stopping.abort();
      await running;
    },
  };
}

function sameLink(link: PairLink, other: PairLink | undefined): boolean {
  return (
    other !== undefined &&
    other.peerNodeId === link.peerNodeId &&
    other.createdAt.getTime() === link.createdAt.getTime()
  );
}

/**
 * Whether the spare was recorded. Node.db's lock is held from the re-read to the link's write, so a
 * link replaced while the probe ran leaves no row, and the joining route cannot replace the link
 * once it is `streaming`. Venue.db commits first and node.db after: a crash between leaves the row
 * and a `pending` link, and the next run finds the row and only marks the link.
 */
async function recordSpare(deps: SpareJoinDeps, probed: PairLink): Promise<boolean> {
  const signingKey = await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId);
  return withNodeTransaction(deps.node, async (ntx) => {
    const link = await readPairLink(ntx, deps.nodeId);
    if (link?.role !== "streams" || link.state !== "pending" || !sameLink(link, probed))
      return false;
    await withTransaction(deps.db, async (tx) => {
      const [existing] = await tx
        .select({ publicKey: nodes.publicKey })
        .from(nodes)
        .where(eq(nodes.id, link.peerNodeId));
      if (existing !== undefined) {
        if (existing.publicKey !== link.peerPublicKey)
          throw new AppError("spare.join_key_mismatch", { peerNodeId: link.peerNodeId });
        return;
      }
      const [main] = await tx.select().from(nodes).where(eq(nodes.id, deps.nodeId));
      await insertReservedNodeTx(tx, {
        id: link.peerNodeId,
        name: `${main!.name} (standby)`,
        filingModule: main!.filingModule,
        taxModule: main!.taxModule,
        publicKey: link.peerPublicKey,
        endorsement: endorseKey(link.peerNodeId, link.peerPublicKey, deps.nodeId, signingKey),
      });
    });
    await setPairLinkStateTx(ntx, deps.nodeId, "streaming");
    return true;
  });
}

interface Probe {
  (link: PairLink, signal: AbortSignal): Promise<boolean>;
  close?(): Promise<void>;
}

/**
 * Writes, reads, lists and deletes one object in the spare's store under the pair's key. Probes of
 * the same link share one pipe and one read of the pair's secret until one succeeds, so the pipe's
 * once-per-reason warning is not repeated each pass.
 */
function storeProbe(deps: SpareJoinDeps): Probe {
  let lastReason: string | undefined;
  let open: { link: PairLink; secretAccessKey: string; pipe: StorePipe } | undefined;
  const close = async () => {
    const pipe = open?.pipe;
    open = undefined;
    await pipe?.close();
  };
  const probe: Probe = async (link, signal) => {
    if (open !== undefined && !sameLink(link, open.link)) await close();
    if (open === undefined) {
      // Read before the pipe starts, so a failed read leaves no pipe that nothing holds.
      const secretAccessKey = await readPairSecret(deps.node, deps.ring, deps.nodeId);
      open = {
        link,
        secretAccessKey,
        pipe: await startStorePipe({
          storeUrl: link.storeUrl,
          authorityPem: await readFile(caCertPath(deps.stateDir), "utf8"),
          clientCertFile: join(deps.stateDir, TLS_CLIENT_CERT_FILE),
          clientKeyFile: join(deps.stateDir, TLS_CLIENT_KEY_FILE),
          lookup: deps.storeLookup,
          log: deps.log,
        }),
      };
    }
    const store = createS3ObjectStore(
      spareStoreBucket(open.pipe.loopbackUrl, link.accessKeyId, open.secretAccessKey),
    );
    const result = await probeBucket(store, undefined, { signal }).catch(
      (error: unknown) => ({ ok: false, reason: codeOf(error) }) as const,
    );
    const reason = result.ok ? undefined : result.reason;
    if (reason !== undefined && reason !== lastReason)
      deps.log("info", "spare.store_probe_refused", { reason });
    lastReason = reason;
    if (result.ok) await close();
    return result.ok;
  };
  probe.close = close;
  return probe;
}

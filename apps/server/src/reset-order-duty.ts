import { randomUUID } from "node:crypto";
import { liveBackupQuery, readNodeMembership } from "@waitron/db";
import type { CanonicalValue } from "@waitron/membership";
import { readHandoverRestriction } from "@waitron/node-db";
import { probeEnvironmentMove } from "@waitron/provisioning";
import { codeOf } from "@waitron/server-kit";
import { AppError, firstCodeInCauseChain } from "@waitron/shared";
import { postToBox, readVenueAuthority } from "./boot-peer-check.js";
import { signAsThisBox } from "./handover-signing.js";
import type { Logger } from "./logger.js";
import { realSleep } from "./loop.js";
import { mainBoxToAsk } from "./main-box-answer.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import { replacedResetCheck, type ReplacedResetCheck } from "./replaced-reset-check.js";
import { writeReplacedResetMarker } from "./replaced-reset.js";
import type { ResetAcknowledgement } from "./reset-order-api.js";
import { returnVenue, type ReturnRecordsDeps } from "./return-records.js";
import { trimTrailingSlashes } from "./trim-trailing-slashes.js";

const ASK_EVERY_MS = 30_000;
// The main box logs a warning for every question it refuses.
export const ASK_AFTER_REFUSAL_MS = 5 * 60_000;
const ACK_EVERY_MS = 10_000;
const ACK_FOR_MS = 120_000;

/**
 * The main box's latest verified answer: what it lacks, and its order for this box once this box
 * has saved the order's marker, after which it restarts whatever the main box answers.
 */
export interface ResetOrderAnswer {
  order: { orderId: string; acceptLoss: boolean } | null;
  lacking: Record<string, CanonicalValue[]>;
}

export interface ResetOrderDutyDeps extends ReturnRecordsDeps {
  stateDir: string;
  venueDir: string;
  /** The return duty's `passNow()`: one pass, queued behind any in flight. */
  returnPass: () => Promise<unknown>;
  fetch?: typeof fetch;
  log: Logger;
  restart: () => void;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

type Asked =
  | ReplacedResetCheck
  | { outcome: "waiting" }
  | { outcome: "unreachable"; fields: Record<string, unknown> };

async function readHoldings(deps: ResetOrderDutyDeps): Promise<Record<string, CanonicalValue>> {
  const holdings: Record<string, CanonicalValue> = {};
  for (const module of deps.modules) {
    const seat = module.handover?.holdings;
    if (seat) holdings[module.name] = await seat(liveBackupQuery(deps.db));
  }
  return holdings;
}

async function ask(
  deps: ResetOrderDutyDeps,
  holdingsOf: () => Promise<Record<string, CanonicalValue>>,
  ack?: ResetAcknowledgement,
): Promise<Asked> {
  const chart = await readNodeMembership(deps.db);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  const { target } = mainBoxToAsk(deps.nodeId, chart, restriction);
  const venue = await returnVenue(deps);
  if (!target || !venue) return { outcome: "waiting" };
  const holdings = await holdingsOf();
  const nonce = randomUUID();
  const body = {
    venue,
    sourceNodeId: deps.nodeId,
    destinationNodeId: target.nodeId,
    nonce,
    holdings,
    ...(ack === undefined ? {} : { ack: ack as unknown as CanonicalValue }),
  };
  const signed = JSON.stringify(await signAsThisBox(deps, "reset-query", body));
  const authority = await readVenueAuthority(deps.stateDir);
  let answer: Awaited<ReturnType<typeof postToBox>>;
  try {
    answer = await postToBox(
      { fetch: deps.fetch, authorityOf: () => authority, lookup: deps.lookup, timeoutMs: 5_000 },
      target.nodeId,
      `${trimTrailingSlashes(target.contactUrl)}/api/node/reset-order`,
      signed,
    );
  } catch (error) {
    return {
      outcome: "unreachable",
      fields: {
        errorClass: error instanceof Error ? error.constructor.name : typeof error,
        errno: firstCodeInCauseChain(error, (code) => /^[A-Z][A-Z0-9_]*$/.test(code)),
      },
    };
  }
  return replacedResetCheck(deps, { targetNodeId: target.nodeId, nonce, answer });
}

/**
 * On a restricted box: asks the main box every 30 seconds whether it is ordered to reset. Once an
 * order passes `replacedResetCheck` it saves the `wiping` marker, then acknowledges (the wipe
 * destroys this box's key, so never later), retrying for up to 2 minutes, then restarts.
 */
export function startResetOrderDuty(deps: ResetOrderDutyDeps): {
  answer(): ResetOrderAnswer | null;
  stop(): Promise<void>;
} {
  const stopping = new AbortController();
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? (() => new Date());
  let answer: ResetOrderAnswer | null = null;
  // Each cause is logged once, and again only when it changes.
  let lastCause: string | null = null;
  let extraPassFor: string | null = null;
  const note = (event: string, fields: Record<string, unknown>) => {
    const cause = JSON.stringify([event, fields]);
    if (cause !== lastCause) deps.log("warn", event, fields);
    lastCause = cause;
  };
  // A restricted start writes no venue data (`restricted-start.ts`), so one reading lasts it.
  let holdings: Record<string, CanonicalValue> | undefined;
  const holdingsOf = async () => (holdings ??= await readHoldings(deps));
  const attempt = async (ack?: ResetAcknowledgement): Promise<Asked | null> => {
    try {
      return await ask(deps, holdingsOf, ack);
    } catch (error) {
      note("reset-order.failed", { errorCode: codeOf(error) });
      return null;
    }
  };

  /**
   * False when the set-aside's renames are refused or the marker could not be saved: nothing is
   * sent and the duty keeps asking.
   */
  async function acknowledgeAndRestart(
    order: Extract<ReplacedResetCheck, { outcome: "ordered" }>,
  ): Promise<boolean> {
    // A return that succeeds now loses nothing. Once per order: the duty may ask again for it.
    if (order.acceptLoss && extraPassFor !== order.orderId) {
      await deps.returnPass();
      extraPassFor = order.orderId;
    }
    if (stopping.signal.aborted) return true;
    if (order.setAside)
      try {
        await probeEnvironmentMove({ stateDir: deps.stateDir, venueDir: deps.venueDir });
      } catch (error) {
        if (codeOf(error) !== "setup.start_again_set_aside_unavailable") throw error;
        note("replaced-reset.set_aside_unavailable", {
          reason: error instanceof AppError ? error.reason : undefined,
        });
        return false;
      }
    if (stopping.signal.aborted) return true;
    try {
      await writeReplacedResetMarker(deps.stateDir, { phase: "wiping", setAside: order.setAside });
    } catch (error) {
      note("reset-order.save_failed", { errorCode: codeOf(error) });
      return false;
    }
    answer = {
      order: { orderId: order.orderId, acceptLoss: order.acceptLoss },
      lacking: order.lacking,
    };
    const ack: ResetAcknowledgement = {
      orderId: order.orderId,
      setAside: order.setAside,
      lacking: Object.fromEntries(
        Object.entries(order.lacking).filter(([, chains]) => chains.length > 0),
      ),
    };
    const startedAt = now().getTime();
    let acknowledged = false;
    while (!stopping.signal.aborted) {
      const asked = await attempt(ack);
      if (asked?.outcome === "ordered" || asked?.outcome === "no-order") {
        acknowledged = true;
        break;
      }
      // After an acknowledgement, a refusal means the main box has removed this box.
      if (asked?.outcome === "refused") break;
      await sleep(ACK_EVERY_MS, stopping.signal);
      if (now().getTime() - startedAt >= ACK_FOR_MS) break;
    }
    if (stopping.signal.aborted) return true;
    deps.log("info", "reset-order.restarting", { orderId: order.orderId, acknowledged });
    deps.restart();
    return true;
  }

  const task = (async () => {
    while (!stopping.signal.aborted) {
      const asked = await attempt();
      if (asked?.outcome === "ordered") {
        answer = { order: null, lacking: asked.lacking };
        if (stopping.signal.aborted) return;
        try {
          if (await acknowledgeAndRestart(asked)) return;
        } catch (error) {
          note("reset-order.failed", { errorCode: codeOf(error) });
        }
      } else if (asked?.outcome === "no-order") {
        answer = { order: null, lacking: asked.lacking };
        lastCause = null;
      } else if (asked?.outcome === "refused") {
        answer = null;
        note("reset-order.refused", { reason: asked.reason });
      } else if (asked?.outcome === "failed")
        note("reset-order.check_failed", { check: asked.check });
      else if (asked?.outcome === "unreachable") note("reset-order.unreachable", asked.fields);
      await sleep(
        asked?.outcome === "refused" ? ASK_AFTER_REFUSAL_MS : ASK_EVERY_MS,
        stopping.signal,
      );
    }
  })();
  return {
    answer: () => answer,
    stop: async () => {
      stopping.abort();
      await task;
    },
  };
}

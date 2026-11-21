import { trimTrailingSlashes } from "./trim-trailing-slashes.js";
import {
  appendHandoverEventTx,
  readHandoverEvents,
  readHandoverRestriction,
  readPinnedPrimaryKey,
} from "@waitron/node-db";
import { firstCodeInCauseChain, nodeId as asNodeId } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { realSleep } from "./loop.js";
import { randomUUID } from "node:crypto";
import {
  readDeploymentEnvironment,
  readNodeMembership,
  readTaxpayer,
  withNodeTransaction,
  type Transaction,
} from "@waitron/db";
import { sha256Hex, verifyEnvelope } from "@waitron/handover";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import { postToBox, readVenueAuthority } from "./boot-peer-check.js";
import type { BoxLookup } from "./mirror-bundle-fetch.js";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import type { PeerStatusApiDeps } from "./peer-status-api.js";

export interface ReturnRecordsDeps extends PeerStatusApiDeps {
  modules: readonly WaitronModule[];
  now?: () => Date;
  /** The venue authority is read from here on each pass. */
  stateDir?: string;
  lookup?: BoxLookup;
}
export type ReturnState =
  "waiting" | "sending" | "needs-attention" | "clock" | "clash" | "record-clash" | "confirmed";
export const returnDigest = (value: CanonicalValue) => sha256Hex(canonicalize(value));

export async function returnVenue(deps: Pick<ReturnRecordsDeps, "db">) {
  const taxpayer = await readTaxpayer(deps.db);
  const environment = await readDeploymentEnvironment(deps.db);
  return taxpayer === null || environment === null
    ? null
    : { country: taxpayer.country, taxId: taxpayer.taxId, environment };
}

type PassDeps = ReturnRecordsDeps & {
  fetch?: typeof fetch;
  log?: Logger;
  stopped(): boolean;
};

export async function runReturnRecordsPass(deps: PassDeps): Promise<ReturnState> {
  const chart = await readNodeMembership(deps.db);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  const operationId = restriction?.operationId ?? null;
  const batches: Batch[] = [];
  // The restricted box reads without draining change_log or running a venue write turn.
  for (const module of deps.modules) {
    const seat = module.handover?.returnRecords;
    if (seat)
      for (const payload of await seat.read(deps.db, deps.nodeId))
        batches.push({ module: module.name, payload });
  }
  if (batches.length === 0) return "waiting";
  const inventory = returnDigest(batches.map(returnDigest));
  const held = (
    await readHandoverEvents(deps.node, deps.nodeId, operationId, "return_confirmed")
  ).some((event) => event.detail.inventory === inventory);
  // Sent even when held: a main box restored from an earlier copy lacks these records.
  const sent = await sendBatches(deps, chart, restriction, batches, inventory);
  // An answer about the records themselves (clash, record-clash, clock) is never hidden by a held one.
  if (sent.state === "waiting" || sent.state === "needs-attention")
    return held ? "confirmed" : sent.state;
  if (sent.state !== "confirmed") return sent.state;
  if (!held)
    await withNodeTransaction(deps.node, (tx) =>
      appendHandoverEventTx(tx, {
        nodeId: deps.nodeId,
        operationId,
        kind: "return_confirmed",
        detail: { destinationNodeId: sent.destinationNodeId, inventory },
        envelope: sent.receipt,
      }),
    );
  return "confirmed";
}

type Batch = { module: string; payload: CanonicalValue };
type Sent =
  | { state: Exclude<ReturnState, "confirmed"> }
  | { state: "confirmed"; destinationNodeId: string; receipt: string };

async function sendBatches(
  deps: PassDeps,
  chart: Awaited<ReturnType<typeof readNodeMembership>>,
  restriction: Awaited<ReturnType<typeof readHandoverRestriction>>,
  batches: readonly Batch[],
  inventory: string,
): Promise<Sent> {
  const servingPrimary = chart?.body.nodes.find((row) => row.standing === "serving-primary");
  // A stepped-down box may hold a chart that still names it main: its restriction names the box
  // the return goes to until a newer chart arrives.
  const fromRestriction = !servingPrimary || servingPrimary.nodeId === deps.nodeId;
  const targetId = fromRestriction ? restriction?.successorNodeId : servingPrimary.nodeId;
  const target = chart?.body.nodes.find((row) => row.nodeId === targetId);
  const venue = await returnVenue(deps);
  if (!target || target.nodeId === deps.nodeId || !venue || !target.contactUrl)
    return { state: "waiting" };
  const keyOf = await peerKeyOf(deps, chart);
  const authority =
    deps.stateDir === undefined ? undefined : await readVenueAuthority(deps.stateDir);
  let lastReceipt = "";
  for (let index = 0; index < batches.length; index++) {
    if (deps.stopped()) return { state: "waiting" };
    const nonce = randomUUID();
    const batch = batches[index]!;
    const body = {
      venue,
      sourceNodeId: deps.nodeId,
      destinationNodeId: target.nodeId,
      inventory,
      count: batches.length,
      index,
      nonce,
      ...batch,
    };
    const signed = JSON.stringify(await signAsThisBox(deps, "return-batch", body));
    let answer: Awaited<ReturnType<typeof postToBox>>;
    try {
      answer = await postToBox(
        { fetch: deps.fetch, authorityOf: () => authority, lookup: deps.lookup, timeoutMs: 5_000 },
        target.nodeId,
        `${trimTrailingSlashes(target.contactUrl)}/api/node/return-records`,
        signed,
      );
    } catch (error) {
      deps.log?.("warn", "return-records.unreachable", {
        errorClass:
          error instanceof Error
            ? error.name !== "Error"
              ? error.name
              : error.constructor.name
            : typeof error,
        errno: firstCodeInCauseChain(error, (code) => /^[A-Z][A-Z0-9_]*$/.test(code)),
      });
      return { state: "waiting" };
    }
    if (answer.status !== 200) return { state: refusalState(answer.text, fromRestriction) };
    let verified;
    try {
      verified = verifyEnvelope<Record<string, unknown>>(
        JSON.parse(answer.text),
        "return-receipt",
        keyOf,
      );
    } catch {
      return { state: "needs-attention" };
    }
    if (!verified.valid || verified.signerNodeId !== target.nodeId)
      return { state: "needs-attention" };
    const receipt = verified.body;
    if (
      receipt.nonce !== nonce ||
      receipt.index !== index ||
      receipt.inventory !== inventory ||
      receipt.digest !== returnDigest(batch) ||
      receipt.sourceNodeId !== deps.nodeId ||
      receipt.destinationNodeId !== target.nodeId ||
      canonicalize(receipt.venue as CanonicalValue) !== canonicalize(venue) ||
      (receipt.accounted !== true && receipt.accounted !== false)
    )
      return { state: "needs-attention" };
    if (receipt.accounted === false) return { state: "clash" };
    lastReceipt = answer.text;
  }
  if (deps.stopped()) return { state: "waiting" };
  return { state: "confirmed", destinationNodeId: target.nodeId, receipt: lastReceipt };
}

function refusalState(text: string, fromRestriction: boolean): Exclude<ReturnState, "confirmed"> {
  let refusal: { error?: { code?: string; params?: { reason?: unknown } } } | null;
  try {
    refusal = JSON.parse(text) as typeof refusal;
  } catch {
    return "needs-attention";
  }
  const reason =
    refusal?.error?.code === "handover.return_refused" ? refusal.error.params?.reason : null;
  // A successor refuses the binding until its own chart names it main, and answers `activating`
  // until its own takeover is activated.
  if ((fromRestriction && reason === "binding") || reason === "activating") return "waiting";
  if (refusal?.error?.code === "fiscal.return_clock_ahead") return "clock";
  if (refusal?.error?.code === "fiscal.return_record_clash") return "record-clash";
  return "needs-attention";
}

export function startReturnRecordsDuty(
  deps: ReturnRecordsDeps & {
    stateDir: string;
    fetch?: typeof fetch;
    log: Logger;
  },
): { state(): ReturnState; stop(): Promise<void> } {
  const stopping = new AbortController();
  let state: ReturnState = "waiting";
  // A main box that stays out of reach is logged once, and again only when the cause changes.
  let lastUnreachable: string | null = null;
  const task = (async () => {
    while (!stopping.signal.aborted) {
      state = "sending";
      let unreachable: string | null = null;
      const log: Logger = (level, event, fields) => {
        if (event === "return-records.unreachable") {
          unreachable = JSON.stringify(fields);
          if (unreachable === lastUnreachable) return;
        }
        deps.log(level, event, fields);
      };
      try {
        state = await runReturnRecordsPass({
          ...deps,
          log,
          stopped: () => stopping.signal.aborted,
        });
      } catch (error) {
        state = "needs-attention";
        deps.log("warn", "return-records.failed", { errorCode: codeOf(error) });
      }
      lastUnreachable = unreachable;
      if (state === "confirmed" || state === "clash") return;
      await realSleep(30_000, stopping.signal);
    }
  })();
  return {
    state: () => state,
    stop: async () => {
      stopping.abort();
      await task;
    },
  };
}

export async function formerMainForReturn(deps: PeerStatusApiDeps, tx: Transaction = deps.db) {
  const chart = await readNodeMembership(tx);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const pinned = await readPinnedPrimaryKey(deps.node, deps.nodeId);
  if (
    !pinned ||
    pinned.primaryNodeId === deps.nodeId ||
    chart?.body.nodes.find((row) => row.standing === "serving-primary")?.nodeId !== deps.nodeId ||
    !chart.body.nodes.some(
      (row) => row.nodeId === pinned.primaryNodeId && row.standing !== "evicted",
    ) ||
    chart.body.revoked?.includes(pinned.primaryNodeId)
  )
    return null;
  return asNodeId(pinned.primaryNodeId);
}

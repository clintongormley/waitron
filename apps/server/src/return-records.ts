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
import { sha256Hex } from "@waitron/handover";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import type { WaitronModule } from "@waitron/module";
import { postToBox, readVenueAuthority } from "./boot-peer-check.js";
import type { BoxLookup } from "./mirror-bundle-fetch.js";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import type { PeerStatusApiDeps } from "./peer-status-api.js";
import { checkedPeerAnswer, mainBoxToAsk } from "./main-box-answer.js";
import type { HeardHoldings } from "./old-box-holdings.js";

export interface ReturnRecordsDeps extends PeerStatusApiDeps {
  modules: readonly WaitronModule[];
  now?: () => Date;
  /** The venue authority is read from here on each pass. */
  stateDir?: string;
  lookup?: BoxLookup;
}
export type ReturnState =
  | "waiting"
  | "sending"
  | "needs-attention"
  | "clock"
  | "clash"
  | "record-clash"
  | "hours-refused"
  | "confirmed";
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
  /** The main box's summary the wipe-order check last heard. */
  mainHoldings?: () => HeardHoldings | null;
};

export async function runReturnRecordsPass(deps: PassDeps): Promise<ReturnState> {
  const chart = await readNodeMembership(deps.db);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  const operationId = restriction?.operationId ?? null;
  const { batches, inventory } = await readReturnInventory(deps);
  if (batches.length === 0) return "waiting";
  const held = await returnConfirmed(deps, operationId, inventory);
  const main = mainBoxToAsk(deps.nodeId, chart, restriction);
  // Sent first: the box's own records may correct one of these.
  const others = await readOtherBoxesBatches(deps, main.target?.nodeId);
  const sentOthers =
    others === null || others.length === 0
      ? null
      : await sendBatches(deps, chart, main, others, returnDigest(others.map(returnDigest)), true);
  const othersState = othersPartState(others, sentOthers);
  // Confirmed own records go again only once nothing else is left to send: a main box restored from
  // an earlier copy lacks them, and each batch is a write on the selling main box.
  const sent: Sent =
    held && othersState !== "confirmed"
      ? { state: "waiting" }
      : await sendBatches(deps, chart, main, batches, inventory, false);
  if (sent.state === "confirmed" && !held)
    await withNodeTransaction(deps.node, (tx) =>
      appendHandoverEventTx(tx, {
        nodeId: deps.nodeId,
        operationId,
        kind: "return_confirmed",
        detail: { destinationNodeId: sent.destinationNodeId, inventory },
        envelope: sent.receipt,
      }),
    );
  // An answer about the records themselves is never hidden by a held one.
  const own =
    held && (sent.state === "waiting" || sent.state === "needs-attention")
      ? "confirmed"
      : sent.state;
  return own === "confirmed" ? othersState : own;
}

/**
 * The earlier boxes' part is done once each batch was accounted or refused as a record clash. A
 * batch the main box took but did not account for cannot be accepted as a clash can for this box's
 * own records, so it needs the person rather than reading as `clash`.
 */
function othersPartState(others: Batch[] | null, sent: Sent | null): ReturnState {
  if (others === null) return "waiting";
  if (sent === null || sent.state === "confirmed" || sent.state === "record-clash")
    return "confirmed";
  return sent.state === "clash" ? "needs-attention" : sent.state;
}

/** Other boxes' records the main box lacks; `null` when some are held but no summary was heard. */
async function readOtherBoxesBatches(
  deps: PassDeps,
  destinationNodeId: string | undefined,
): Promise<Batch[] | null> {
  const heard = destinationNodeId === undefined ? null : (deps.mainHoldings?.() ?? null);
  const batches: Batch[] = [];
  for (const module of deps.modules) {
    const seat = module.handover?.returnRecords;
    if (!seat?.readOthers) continue;
    const payloads = await seat.readOthers(
      deps.db,
      deps.nodeId,
      destinationNodeId ?? deps.nodeId,
      heard?.holdings[module.name],
    );
    if (payloads === null) return null;
    for (const payload of payloads) batches.push({ module: module.name, payload });
  }
  return batches;
}

type Batch = { module: string; payload: CanonicalValue };

/** The batches this box would return now, and their inventory. */
export async function readReturnInventory(
  deps: Pick<ReturnRecordsDeps, "db" | "nodeId" | "modules">,
): Promise<{ batches: Batch[]; inventory: string }> {
  const batches: Batch[] = [];
  // Invoice records go first, so a refusal of any other module's batch never holds them back.
  const ordered = [
    ...deps.modules.filter((module) => module.fiscal !== undefined),
    ...deps.modules.filter((module) => module.fiscal === undefined),
  ];
  // The restricted box reads without draining change_log or running a venue write turn.
  for (const module of ordered) {
    const seat = module.handover?.returnRecords;
    if (seat)
      for (const payload of await seat.read(deps.db, deps.nodeId))
        batches.push({ module: module.name, payload });
  }
  return { batches, inventory: returnDigest(batches.map(returnDigest)) };
}

/** Whether the main box confirmed `inventory` for the operation. */
export async function returnConfirmed(
  deps: Pick<ReturnRecordsDeps, "node" | "nodeId">,
  operationId: string | null,
  inventory: string,
): Promise<boolean> {
  return (await readHandoverEvents(deps.node, deps.nodeId, operationId, "return_confirmed")).some(
    (event) => event.detail.inventory === inventory,
  );
}

type Sent =
  | { state: Exclude<ReturnState, "confirmed"> }
  | { state: "confirmed"; destinationNodeId: string; receipt: string };

async function sendBatches(
  deps: PassDeps,
  chart: Awaited<ReturnType<typeof readNodeMembership>>,
  { target, fromRestriction }: ReturnType<typeof mainBoxToAsk>,
  batches: readonly Batch[],
  inventory: string,
  others: boolean,
): Promise<Sent> {
  const venue = await returnVenue(deps);
  if (!target || !venue) return { state: "waiting" };
  const keyOf = await peerKeyOf(deps, chart);
  const authority =
    deps.stateDir === undefined ? undefined : await readVenueAuthority(deps.stateDir);
  let lastReceipt = "";
  let recordClash = false;
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
      ...(others ? { part: "others" } : {}),
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
    if (answer.status !== 200) {
      const refused = refusalState(answer.text, fromRestriction);
      // The main box takes each earlier box's batch in a transaction of its own, so a clash in one
      // leaves the rest to send.
      if (others && refused === "record-clash") {
        recordClash = true;
        continue;
      }
      return { state: refused };
    }
    const checked = checkedPeerAnswer(answer.text, "return-receipt", keyOf, target.nodeId, nonce);
    if (!checked.ok) return { state: "needs-attention" };
    const receipt = checked.body;
    if (
      receipt.index !== index ||
      receipt.inventory !== inventory ||
      receipt.part !== (others ? "others" : undefined) ||
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
  if (recordClash) return { state: "record-clash" };
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
  if (
    refusal?.error?.code === "attendance.return_entry_clash" ||
    refusal?.error?.code === "attendance.return_entry_invalid"
  )
    return "hours-refused";
  return "needs-attention";
}

export function startReturnRecordsDuty(
  deps: ReturnRecordsDeps & {
    stateDir: string;
    fetch?: typeof fetch;
    log: Logger;
    mainHoldings?: () => HeardHoldings | null;
  },
): { state(): ReturnState; passNow(): Promise<ReturnState>; stop(): Promise<void> } {
  const stopping = new AbortController();
  let state: ReturnState = "waiting";
  // A main box that stays out of reach is logged once, and again only when the cause changes.
  let lastUnreachable: string | null = null;
  // Every pass waits for the one before it, so two passes never send batches at once.
  let latest: Promise<unknown> = Promise.resolve();
  const pass = (): Promise<ReturnState> => {
    const next = latest.then(async () => {
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
      return state;
    });
    latest = next;
    return next;
  };
  const task = (async () => {
    while (!stopping.signal.aborted) {
      const ended = await pass();
      if (ended === "confirmed" || ended === "clash" || ended === "hours-refused") return;
      await realSleep(30_000, stopping.signal);
    }
  })();
  return {
    state: () => state,
    /** One more pass, after any in flight; after `stop()` it runs none. */
    passNow: async () => (stopping.signal.aborted ? state : pass()),
    stop: async () => {
      stopping.abort();
      await task;
      await latest;
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

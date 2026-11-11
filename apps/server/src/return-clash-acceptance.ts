import type { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import {
  readNodeMembership,
  recordActivity,
  withNodeTransaction,
  withTransaction,
  type NodeTransaction,
  type Transaction,
} from "@waitron/db";
import { verifyEnvelope } from "@waitron/handover";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import { canonicalize, type CanonicalValue } from "@waitron/membership";
import type { ReturnDiscrepancy } from "@waitron/module";
import {
  appendHandoverEventTx,
  nodeHandoverEvents,
  readPinnedPrimaryKey,
  type HandoverEvent,
} from "@waitron/node-db";
import {
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
  type Logger,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { assertHeldDocumentReadable, assertHeldDocumentTrusted } from "./membership-trust.js";
import { returnDigest, returnVenue, type ReturnRecordsDeps } from "./return-records.js";
import "./errors.js";

type Deps = ReturnRecordsDeps & { requireWritable(): void };
export function refuseReturn(reason: string): never {
  throw new AppError("handover.return_refused", { reason });
}

export async function checkedReturn(
  deps: ReturnRecordsDeps,
  raw: unknown,
  tx: Transaction = deps.db,
) {
  const chart = await readNodeMembership(tx);
  await assertHeldDocumentTrusted(deps, chart);
  assertHeldDocumentReadable(chart);
  const verified = verifyEnvelope<Record<string, CanonicalValue>>(
    raw,
    "return-batch",
    await peerKeyOf(deps, chart),
  );
  if (!verified.valid) return refuseReturn("signature");
  const body = verified.body;
  const pinned = await readPinnedPrimaryKey(deps.node, deps.nodeId);
  if (
    pinned?.primaryNodeId !== verified.signerNodeId ||
    body.sourceNodeId !== verified.signerNodeId ||
    body.destinationNodeId !== deps.nodeId ||
    chart?.body.nodes.find((row) => row.standing === "serving-primary")?.nodeId !== deps.nodeId ||
    !chart.body.nodes.some(
      (row) => row.nodeId === verified.signerNodeId && row.standing !== "evicted",
    ) ||
    chart.body.revoked?.includes(verified.signerNodeId) ||
    canonicalize(body.venue!) !== canonicalize(await returnVenue(deps))
  )
    return refuseReturn("binding");
  if (
    body.payload === undefined ||
    typeof body.inventory !== "string" ||
    !/^[a-f0-9]{64}$/.test(body.inventory) ||
    typeof body.nonce !== "string" ||
    body.nonce.length > 64 ||
    typeof body.index !== "number" ||
    !Number.isSafeInteger(body.index) ||
    body.index < 0 ||
    typeof body.count !== "number" ||
    !Number.isSafeInteger(body.count) ||
    body.count <= body.index ||
    Buffer.byteLength(JSON.stringify(body.payload)) > 256 * 1024
  )
    return refuseReturn("batch");
  const seat = deps.modules.find((module) => module.name === body.module)?.handover?.returnRecords;
  if (!seat) return refuseReturn("module");
  return { body, seat, chart, source: verified.signerNodeId };
}

function binding(body: Record<string, CanonicalValue>) {
  return {
    venue: body.venue!,
    sourceNodeId: body.sourceNodeId!,
    destinationNodeId: body.destinationNodeId!,
    module: body.module!,
    inventory: body.inventory!,
    index: body.index!,
    count: body.count!,
    batchDigest: returnDigest({ module: body.module!, payload: body.payload! }),
  };
}
function evidenceId(body: Record<string, CanonicalValue>, clash: ReturnDiscrepancy) {
  return returnDigest({ ...binding(body), fingerprint: clash.fingerprint });
}
async function events(deps: ReturnRecordsDeps, kind: string, node = deps.node as NodeTransaction) {
  return node
    .select()
    .from(nodeHandoverEvents)
    .where(
      and(
        eq(nodeHandoverEvents.nodeId, deps.nodeId),
        isNull(nodeHandoverEvents.operationId),
        eq(nodeHandoverEvents.kind, kind),
      ),
    );
}

export async function retainReturnClashes(
  deps: ReturnRecordsDeps,
  node: NodeTransaction,
  raw: unknown,
  body: Record<string, CanonicalValue>,
  clashes: ReturnDiscrepancy[],
) {
  const held = await events(deps, "return-clash-evidence", node);
  for (const clash of clashes) {
    const clashId = evidenceId(body, clash);
    if (held.some((row) => row.detail.clashId === clashId)) continue;
    await appendHandoverEventTx(node, {
      nodeId: deps.nodeId,
      operationId: null,
      kind: "return-clash-evidence",
      detail: { clashId, ...binding(body), clash },
      envelope: JSON.stringify(raw),
    });
  }
}

async function readEvidence(deps: ReturnRecordsDeps, event: HandoverEvent, tx: Transaction) {
  const raw: unknown = JSON.parse(event.envelope!);
  const checked = await checkedReturn(deps, raw, tx);
  const clash = event.detail.clash as unknown as ReturnDiscrepancy;
  if (event.detail.clashId !== evidenceId(checked.body, clash)) refuseReturn("evidence");
  const current = (await checked.seat.inspect?.(tx, checked.source, checked.body.payload!))?.find(
    (row) => row.fingerprint === clash.fingerprint,
  );
  return { ...checked, clash, current, clashId: String(event.detail.clashId) };
}

async function decisionBody(deps: ReturnRecordsDeps, event: HandoverEvent) {
  const decision = JSON.parse(event.envelope!) as unknown;
  const verified = verifyEnvelope<Record<string, CanonicalValue>>(
    decision,
    "return-clash-acceptance",
    await peerKeyOf(deps),
  );
  if (
    !verified.valid ||
    verified.signerNodeId !== deps.nodeId ||
    verified.body.destinationNodeId !== deps.nodeId
  )
    return refuseReturn("acceptance signature");
  return { decision, body: verified.body };
}

export async function acceptedReturnFingerprints(
  deps: ReturnRecordsDeps,
  body: Record<string, CanonicalValue>,
  tx: Transaction,
) {
  const seat = deps.modules.find((module) => module.name === body.module)?.handover?.returnRecords;
  if (!seat?.inspect) return [];
  const clashes = await seat.inspect(tx, String(body.sourceNodeId), body.payload!);
  const accepted: string[] = [];
  for (const event of await events(deps, "return-clash-acceptance")) {
    const decision = await decisionBody(deps, event);
    const clash = clashes.find(
      (row) => row.eligible && row.fingerprint === decision.body.fingerprint,
    );
    if (!clash || decision.body.evidenceDigest !== evidenceId(body, clash)) continue;
    const evidence = (await events(deps, "return-clash-evidence")).find(
      (row) => row.detail.clashId === decision.body.evidenceDigest,
    );
    if (!evidence || !(await readEvidence(deps, evidence, tx)).current?.eligible) continue;
    if (
      canonicalize(binding(body)) !==
      canonicalize(
        Object.fromEntries(Object.keys(binding(body)).map((key) => [key, decision.body[key]!])),
      )
    )
      continue;
    accepted.push(clash.fingerprint);
  }
  return accepted;
}

export function mountReturnClashAcceptance(app: Hono, deps: Deps, log: Logger) {
  const run = createErrorBoundary(
    {
      "management_session.required": 401,
      "management_session.expired": 401,
      "management_session.proof_required": 401,
      "person.suspended": 403,
      "authorization.not_permitted": 403,
      "handover.return_refused": 409,
      "handover.return_clash_not_found": 404,
      "membership.held_untrusted": 409,
      "node.read_only": 409,
    },
    "return-clash.failed",
  );
  async function authorize(tx: Transaction, token: string) {
    const permissions = new Set(
      deps.modules.flatMap((module) => module.handover?.returnRecords?.acceptPermission ?? []),
    );
    if (!permissions.size) refuseReturn("no acceptance module");
    let personId = "";
    for (const permission of permissions)
      personId = (await authorizeManager(tx, { managementSessionId: token, permission }))
        .authorizedBy;
    return personId;
  }
  app.get("/management-api/return-clashes", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      const clashes = await withTransaction(deps.db, async (tx) => {
        await authorize(tx, token);
        const decisions = await events(deps, "return-clash-acceptance");
        const result = [];
        for (const event of await events(deps, "return-clash-evidence")) {
          const evidence = await readEvidence(deps, event, tx);
          let accepted = false;
          for (const decision of decisions)
            if ((await decisionBody(deps, decision)).body.evidenceDigest === evidence.clashId)
              accepted = true;
          result.push({
            clashId: evidence.clashId,
            ...binding(evidence.body),
            ...evidence.clash,
            eligible: evidence.current?.eligible === true,
            accepted,
            sourceEnvelope: JSON.parse(event.envelope!) as CanonicalValue,
          });
        }
        return result;
      });
      c.header("Cache-Control", "no-store");
      return c.json({ clashes });
    }),
  );
  app.post("/management-api/return-clashes/:clashId/accept", (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      const raw = await readJsonBody<unknown>(c);
      const result = await withNodeTransaction(deps.node, async (node) => {
        const decision = await withTransaction(deps.db, async (tx) => {
          const personId = await authorize(tx, token);
          await requireFreshManagementSignIn(tx, token);
          deps.requireWritable();
          if (
            !raw ||
            typeof raw !== "object" ||
            Array.isArray(raw) ||
            !("actionKey" in raw) ||
            typeof raw.actionKey !== "string" ||
            !raw.actionKey.trim() ||
            raw.actionKey.length > 128 ||
            !("reason" in raw) ||
            typeof raw.reason !== "string" ||
            !raw.reason.trim() ||
            raw.reason.length > 500
          )
            refuseReturn("decision");
          const clashId = c.req.param("clashId");
          const event = (await events(deps, "return-clash-evidence", node)).find(
            (row) => row.detail.clashId === clashId,
          );
          if (!event) throw new AppError("handover.return_clash_not_found", { clashId });
          const evidence = await readEvidence(deps, event, tx);
          if (!evidence.current?.eligible) refuseReturn("clash changed or ineligible");
          for (const event of await events(deps, "return-clash-acceptance", node)) {
            const prior = await decisionBody(deps, event);
            if (prior.body.actionKey === raw.actionKey || prior.body.evidenceDigest === clashId) {
              if (
                prior.body.actionKey !== raw.actionKey ||
                prior.body.evidenceDigest !== clashId ||
                prior.body.reason !== raw.reason ||
                prior.body.personId !== personId
              )
                refuseReturn("decision mismatch");
              return prior.decision;
            }
          }
          const at = deps.now?.() ?? new Date();
          const signed = await signAsThisBox(deps, "return-clash-acceptance", {
            ...binding(evidence.body),
            evidenceDigest: clashId,
            fingerprint: evidence.clash.fingerprint,
            personId,
            acceptedAt: at.toISOString(),
            reason: raw.reason,
            actionKey: raw.actionKey,
          });
          await recordActivity(tx, {
            kind: "handover.return_clash_accepted",
            subjectId: deps.nodeId,
            personId,
            data: { clashId, sourceNodeId: evidence.source, module: String(evidence.body.module) },
            at,
          });
          return signed;
        });
        // Venue history commits first; a failed local append leaves the caller able to accept again.
        const held = await events(deps, "return-clash-acceptance", node);
        if (!held.some((row) => row.detail.clashId === c.req.param("clashId")))
          await appendHandoverEventTx(node, {
            nodeId: deps.nodeId,
            operationId: null,
            kind: "return-clash-acceptance",
            detail: { clashId: c.req.param("clashId") },
            envelope: JSON.stringify(decision),
          });
        return decision;
      });
      c.header("Cache-Control", "no-store");
      return c.json({
        decision: result,
        next: "Restart the stopped box; repeat for any later clashing batch.",
      });
    }),
  );
}

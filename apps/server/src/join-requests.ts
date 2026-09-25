import "./errors.js";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { type Transaction, devices, joinRequests, printAgents } from "@waitron/db";
import { hashSecret, verifySecret } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import type { FormFactor } from "@waitron/layouts";
import { resolveDeviceBinding } from "./device.js";
import type { TillConfig } from "./till-config.js";

/** The predicate every statement here carries: a pending request belongs to the node that received
 * it (`join_requests.node_id`). */
const ownedBy = (cfg: Pick<TillConfig, "nodeId">) => eq(joinRequests.nodeId, cfg.nodeId);

/** Both surfaces' pending joins live in one table; this is which one a row is for. */
export type JoinRequestKind = "device" | "print_agent";

/** A request lapses after this long — the same fifteen minutes as the pairing window, so a knock
 * cannot outlive the window that admitted it by more than one window. */
export const JOIN_TTL_MS = 15 * 60 * 1000;

/** Pending rows per kind, across this node's requests. It also bounds the numbers the decoy rule
 * must avoid. */
export const PENDING_CAP = 10;

/** Delete every lapsed request this node holds. Called at the head of every verb that reads or
 * counts them, so a lapsed row never occupies the cap, never blocks a number, and never appears in
 * the pending list. */
async function sweepLapsed(tx: Transaction, cfg: TillConfig): Promise<void> {
  await tx
    .delete(joinRequests)
    .where(
      and(
        ownedBy(cfg),
        lt(joinRequests.createdAt, new Date(Date.now() - JOIN_TTL_MS).toISOString()),
      ),
    );
}

/** Every number currently spoken for among this node's requests, EITHER kind, split by role. The
 * cross-surface scope is the point (design §1.2 rule 3): an agent request and a device request must
 * never show the same number, or an admin comparing across two screens can be honestly misled. */
export async function pendingNumbers(
  tx: Transaction,
  cfg: TillConfig,
): Promise<{ reals: Set<string>; decoys: Set<string> }> {
  const rows = await tx
    .select({ n: joinRequests.verificationNumber, d: joinRequests.decoyNumbers })
    .from(joinRequests)
    .where(ownedBy(cfg));
  return {
    reals: new Set(rows.map((r) => r.n)),
    decoys: new Set(rows.flatMap((r) => r.d)),
  };
}

/** `00`–`99`. Two digits because the number is COMPARED across a room, never typed — its job is
 * legibility, and what defends a mix-up is the distinctness rule plus deny-on-wrong, not entropy. */
function twoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Mint a pending join request: one real number and two decoys, obeying the cross-surface exclusion
 * (design §1.2 rule 3) and the per-kind cap.
 *
 * INVARIANT: the whole sweep → count → pick → insert sequence is atomic against every other
 * creator, or two creators pick off a stale reserved set (colliding numbers) and both pass the cap.
 * What arranges it is the venue file's write queue, which `withTransaction`
 * (`packages/db/src/tenancy.ts`) runs its body inside, not a lock this function takes. Receipt:
 * `assertExtraListForWrite` (`packages/catalogue/src/extras.ts`).
 */
export async function createJoinRequest(
  tx: Transaction,
  cfg: TillConfig,
  input: {
    kind: JoinRequestKind;
    label: string;
    /** Injectable for tests, and used only for the REAL number; production uses `randomInt(0, 100)`,
     * as decoys always do. */
    numbers?: () => number;
  },
): Promise<{ joinId: string; verificationNumber: string; token: string }> {
  await sweepLapsed(tx, cfg);

  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)` })
    .from(joinRequests)
    .where(and(ownedBy(cfg), eq(joinRequests.kind, input.kind)));
  if (count >= PENDING_CAP) throw new AppError("device.join_full", {});

  // The REAL number avoids every existing real AND every issued decoy; the DECOYS avoid every real.
  // Both directions matter because the decoys live as long as the row: otherwise a decoy issued at
  // 10:01 becomes somebody's real number at 10:02. The cap keeps the reserved values to sixty of a
  // hundred.
  const { reals, decoys } = await pendingNumbers(tx, cfg);
  // `input.numbers` drives only the REAL pick: a constant test generator would starve the decoy
  // loop on its own picks.
  const pick = (source: () => number, forbidden: ReadonlySet<string>): string | undefined => {
    for (let attempt = 0; attempt < 400; attempt++) {
      const candidate = twoDigits(source() % 100);
      if (!forbidden.has(candidate)) return candidate;
    }
    /* v8 ignore start */
    return undefined;
    /* v8 ignore stop */
  };
  const spokenFor = new Set([...reals, ...decoys]);
  const nextReal = input.numbers ?? (() => randomInt(0, 100));
  const verificationNumber = pick(nextReal, spokenFor);
  /* v8 ignore start */
  if (verificationNumber === undefined) throw new AppError("device.join_full", {});
  /* v8 ignore stop */
  const decoyNumbers: string[] = [];
  const decoyForbidden = new Set([...reals, verificationNumber]);
  while (decoyNumbers.length < 2) {
    const d = pick(() => randomInt(0, 100), decoyForbidden);
    /* v8 ignore start */
    if (d === undefined) throw new AppError("device.join_full", {});
    /* v8 ignore stop */
    decoyNumbers.push(d);
    decoyForbidden.add(d);
  }

  const token = randomBytes(32).toString("base64url");
  const [row] = await tx
    .insert(joinRequests)
    .values({
      nodeId: cfg.nodeId,
      locationId: cfg.locationId,
      kind: input.kind,
      label: input.label,
      tokenHash: hashSecret(token),
      verificationNumber,
      decoyNumbers,
    })
    .returning({ id: joinRequests.id });
  return { joinId: row!.id, verificationNumber, token };
}

/** The pending list the dashboard renders. The return type deliberately has NO number field: the list
 * must never carry the answer beside the question (design §1.2 rule 1), and a type that cannot express
 * it is a stronger guarantee than a `select` that happens not to ask for it. */
export async function listPendingJoinRequests(
  tx: Transaction,
  cfg: TillConfig,
  kind: JoinRequestKind,
): Promise<{ id: string; kind: JoinRequestKind; label: string; createdAt: string }[]> {
  await sweepLapsed(tx, cfg);
  return tx
    .select({
      id: joinRequests.id,
      kind: joinRequests.kind,
      label: joinRequests.label,
      createdAt: joinRequests.createdAt,
    })
    .from(joinRequests)
    .where(and(ownedBy(cfg), eq(joinRequests.kind, kind)))
    .orderBy(joinRequests.createdAt);
}

/** Fetch one of this node's pending requests by id, or throw `join_request.not_found`. */
async function requirePending(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<{
  id: string;
  kind: JoinRequestKind;
  label: string;
  verificationNumber: string;
  decoyNumbers: string[];
  tokenHash: string;
  locationId: string;
}> {
  await sweepLapsed(tx, cfg);
  const [row] = await tx
    .select({
      id: joinRequests.id,
      kind: joinRequests.kind,
      label: joinRequests.label,
      verificationNumber: joinRequests.verificationNumber,
      decoyNumbers: joinRequests.decoyNumbers,
      tokenHash: joinRequests.tokenHash,
      locationId: joinRequests.locationId,
    })
    .from(joinRequests)
    .where(and(ownedBy(cfg), eq(joinRequests.id, id)));
  if (row === undefined) throw new AppError("join_request.not_found", {});
  return row;
}

/**
 * The KIND of one of this node's pending requests, or `undefined` when this node holds no such row.
 *
 * Deliberately not {@link requirePending}'s throw: the by-id routes (`join-api.ts`) read the kind
 * BEFORE they authorize, and must refuse a caller holding neither permission whether or not the id
 * is live, or the status code enumerates pending requests. So the miss is a VALUE held until after
 * the gate.
 */
export async function joinRequestKind(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<JoinRequestKind | undefined> {
  await sweepLapsed(tx, cfg);
  const [row] = await tx
    .select({ kind: joinRequests.kind })
    .from(joinRequests)
    .where(and(ownedBy(cfg), eq(joinRequests.id, id)));
  return row?.kind;
}

/**
 * The three numbers the admin picks from: this request's own, plus its two stored decoys.
 *
 * The server builds the set and does not say which is real — the dashboard receives three
 * indistinguishable strings and posts back the one the admin tapped, so the check is server-side and
 * the page cannot leak the answer. The person is what is being tested, not the browser.
 *
 * The membership is fixed at join time and READ here, never re-rolled: two independently-rolled calls
 * would intersect in exactly one value — the real one — which hands the answer to any client with a
 * management session (design §1.2 rule 2). Only the shuffle order varies per call.
 */
export async function challengeFor(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<{ choices: string[] }> {
  const row = await requirePending(tx, cfg, id);
  const choices = [row.verificationNumber, ...row.decoyNumbers];

  // Fisher-Yates over a cryptographic source: a predictable position would let a careless admin learn
  // "the real one is always first" and stop comparing, which is the whole failure this guards against.
  for (let i = choices.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [choices[i], choices[j]] = [choices[j]!, choices[i]!];
  }
  return { choices };
}

/**
 * What a joiner polling with `${joinId}.${token}` should be told.
 *
 * The id is carried THROUGH accept — an accepted request becomes a `devices` row with the same id and
 * the same token hash — so one selector answers both questions and the joiner's cookie is set once, at
 * join, and never re-issued. Denied, lapsed and never-existed all fold into `not_approved`: the
 * joiner's recovery is identical in every case.
 */
export async function readJoinStatus(
  tx: Transaction,
  cfg: TillConfig,
  joinId: string,
  token: string,
): Promise<"pending" | "approved" | "not_approved"> {
  await sweepLapsed(tx, cfg);
  const [pending] = await tx
    .select({ tokenHash: joinRequests.tokenHash })
    .from(joinRequests)
    .where(and(ownedBy(cfg), eq(joinRequests.id, joinId)));
  if (pending !== undefined) {
    return verifySecret(token, pending.tokenHash) ? "pending" : "not_approved";
  }
  const [accepted] = await tx
    .select({ tokenHash: devices.tokenHash })
    .from(devices)
    .where(and(eq(devices.id, joinId), eq(devices.active, true)));
  if (accepted !== undefined && verifySecret(token, accepted.tokenHash)) return "approved";
  return "not_approved";
}

/** What {@link acceptDeviceJoinRequest} hands back. A wrong choice is a RESULT, never a throw — see
 * that function's header for why. */
export type AcceptResult =
  | { ok: true; deviceId: string; name: string; formFactor: FormFactor }
  | { ok: false; reason: "mismatch" };

/**
 * Approve a device's ask-to-join.
 *
 * SINGLE-USE IS STRUCTURAL: the first thing this does is a `DELETE … RETURNING` — CONSUME before
 * deciding anything. The venue file's write queue (`packages/store/src/write-queue.ts`) admits one
 * write transaction at a time, so a second accept of the same request runs after the first commits,
 * matches zero rows, and throws `join_request.not_found` rather than colliding on the device
 * insert, which reuses the request's id. That queue is this process's; a second process on the file
 * is outside it. The kind predicate rides the SAME delete, so a device accept can never consume an
 * agent's request.
 *
 * ONE transaction: a later failure (an unknown profile, a missing station, the register insert)
 * rolls the consumption back too, so the request survives for a genuine retry.
 *
 * A WRONG CHOICE DENIES — AND THAT IS WHY THIS RETURNS RATHER THAN THROWS: an `AppError` thrown
 * here would roll the consumed row back into existence and make a wrong tap an unlimited retry
 * (design §1.2). The caller commits this result and throws `device.join_mismatch` AFTER the
 * transaction returns.
 */
export async function acceptDeviceJoinRequest(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  input: {
    choice: string;
    profileId: string;
    stationId?: string | null;
    registerId?: string | null;
  },
): Promise<AcceptResult> {
  await sweepLapsed(tx, cfg);

  const [row] = await tx
    .delete(joinRequests)
    .where(and(ownedBy(cfg), eq(joinRequests.id, id), eq(joinRequests.kind, "device")))
    .returning({
      id: joinRequests.id,
      label: joinRequests.label,
      verificationNumber: joinRequests.verificationNumber,
      tokenHash: joinRequests.tokenHash,
      locationId: joinRequests.locationId,
    });
  if (row === undefined) throw new AppError("join_request.not_found", {});

  if (input.choice !== row.verificationNumber) {
    // Already consumed by the delete above.
    return { ok: false, reason: "mismatch" };
  }

  const binding = await resolveDeviceBinding(tx, cfg, row.locationId, {
    profileId: input.profileId,
    name: row.label,
    stationId: input.stationId,
    registerId: input.registerId,
  });

  await tx.insert(devices).values({
    id: row.id,
    locationId: row.locationId,
    stationId: binding.stationId,
    tillId: binding.tillId,
    deviceProfileId: input.profileId,
    label: row.label,
    tokenHash: row.tokenHash,
    active: true,
  });

  return { ok: true, deviceId: row.id, name: row.label, formFactor: binding.formFactor };
}

/** What {@link acceptPrintAgentJoinRequest} hands back. A wrong choice is a RESULT, never a throw —
 * the same reason {@link acceptDeviceJoinRequest} returns: an AppError would roll the consuming delete
 * back into existence and turn a wrong tap into an unlimited retry (design §1.2). */
export type AgentAcceptResult =
  { ok: true; agentId: string; name: string } | { ok: false; reason: "mismatch" };

/**
 * Approve a print agent's ask-to-join. The mirror of {@link acceptDeviceJoinRequest}, minus the
 * device binding. The `print_agents` row takes the request's own id and token hash, so the bearer
 * the agent has held since join keeps working.
 */
export async function acceptPrintAgentJoinRequest(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  input: { choice: string },
): Promise<AgentAcceptResult> {
  await sweepLapsed(tx, cfg);
  const [row] = await tx
    .delete(joinRequests)
    .where(and(ownedBy(cfg), eq(joinRequests.id, id), eq(joinRequests.kind, "print_agent")))
    .returning({
      id: joinRequests.id,
      label: joinRequests.label,
      verificationNumber: joinRequests.verificationNumber,
      tokenHash: joinRequests.tokenHash,
      locationId: joinRequests.locationId,
    });
  if (row === undefined) throw new AppError("join_request.not_found", {});
  if (input.choice !== row.verificationNumber) {
    // Already consumed by the delete above — a wrong tap is single-use, same as a device accept.
    return { ok: false, reason: "mismatch" };
  }

  await tx.insert(printAgents).values({
    id: row.id,
    locationId: row.locationId,
    name: row.label,
    tokenHash: row.tokenHash,
    active: true,
  });
  return { ok: true, agentId: row.id, name: row.label };
}

/**
 * The mirror of {@link readJoinStatus} for a print agent, resolving the approved fallback against
 * `print_agents`. The pending read is filtered to this node's rows; the approved fallback reads
 * `print_agents` by id and `active`, with no node filter.
 */
export async function readAgentJoinStatus(
  tx: Transaction,
  cfg: TillConfig,
  joinId: string,
  token: string,
): Promise<"pending" | "approved" | "not_approved"> {
  await sweepLapsed(tx, cfg);
  const [pending] = await tx
    .select({ tokenHash: joinRequests.tokenHash })
    .from(joinRequests)
    .where(and(ownedBy(cfg), eq(joinRequests.id, joinId)));
  if (pending !== undefined) {
    return verifySecret(token, pending.tokenHash) ? "pending" : "not_approved";
  }
  const [accepted] = await tx
    .select({ tokenHash: printAgents.tokenHash })
    .from(printAgents)
    .where(and(eq(printAgents.id, joinId), eq(printAgents.active, true)));
  if (accepted !== undefined && verifySecret(token, accepted.tokenHash)) return "approved";
  return "not_approved";
}

/** Refuse a request. Deleting the row is the whole of it — there is no denied state to carry, because
 * both real tables now hold only approved rows and a joiner's recovery is to knock again. Returns the
 * kind it deleted rather than taking one: a deny route shared by both surfaces cannot know the kind
 * until the row is read, so a `kind` parameter would either be vacuous or force a second read. */
export async function denyJoinRequest(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<JoinRequestKind> {
  const row = await requirePending(tx, cfg, id);
  await tx.delete(joinRequests).where(and(ownedBy(cfg), eq(joinRequests.id, id)));
  return row.kind;
}

/**
 * Enrol THIS node's own print agent. Idempotent per node: a node that has lost its token re-asks,
 * and this refreshes the existing row's token, so the agent id is stable and its printer bindings
 * survive. A REVOKED row is refused with `device.join_revoked`, never reactivated, so a deliberate
 * revoke sticks. The token has the accept shape `${agentId}.${secret}`.
 */
export async function selfEnrolNodeAgent(
  tx: Transaction,
  cfg: TillConfig,
  input: { nodeId: string; name: string },
): Promise<{ agentId: string; token: string }> {
  const [existing] = await tx
    .select({ id: printAgents.id, active: printAgents.active })
    .from(printAgents)
    .where(eq(printAgents.nodeId, input.nodeId));

  // Checked BEFORE minting so a refused re-enrol does not spend a scrypt it will throw away.
  if (existing !== undefined && !existing.active) throw new AppError("device.join_revoked", {});

  const secret = randomBytes(32).toString("base64url");
  const tokenHash = hashSecret(secret);

  if (existing !== undefined) {
    await tx.update(printAgents).set({ tokenHash }).where(eq(printAgents.id, existing.id));
    return { agentId: existing.id, token: `${existing.id}.${secret}` };
  }

  // The `(node_id)` unique index refuses a second row for the same node.
  const agentId = randomUUID();
  await tx.insert(printAgents).values({
    id: agentId,
    locationId: cfg.locationId,
    nodeId: input.nodeId,
    name: input.name,
    tokenHash,
    active: true,
  });
  return { agentId, token: `${agentId}.${secret}` };
}

import "./errors.js";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { type Transaction, devices, joinRequests, printAgents } from "@waitron/db";
import { hashSecret, verifySecret } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import type { FormFactor } from "@waitron/layouts";
import { resolveDeviceBinding } from "./device.js";
import type { TillConfig } from "./till-config.js";

/** Both surfaces' pending joins live in one table; this is which one a row is for. */
export type JoinRequestKind = "device" | "print_agent";

/** A request lapses after this long — the same fifteen minutes as the pairing window, so a knock
 * cannot outlive the window that admitted it by more than one window. */
export const JOIN_TTL_MS = 15 * 60 * 1000;

/** Pending rows per kind, across the whole database. Ten is enough for the largest install anyone
 * runs at once, and it bounds both the admin's attention and the numbers the decoy rule must avoid. */
export const PENDING_CAP = 10;

/** Delete every lapsed request in the database. Called at the head of every verb that reads or counts
 * them, so a lapsed row never occupies the cap, never blocks a number, and never appears in the
 * pending list. Swept opportunistically at read, not by a background job. */
async function sweepLapsed(tx: Transaction, cfg: TillConfig): Promise<void> {
  void cfg;
  await tx
    .delete(joinRequests)
    .where(lt(joinRequests.createdAt, new Date(Date.now() - JOIN_TTL_MS).toISOString()));
}

/** Every number currently spoken for in this database, EITHER kind, split by role. The cross-surface
 * scope is the point (design §1.2 rule 3): an agent request and a device request must never show the
 * same number, or an admin comparing across two screens can be honestly misled. */
export async function pendingNumbers(
  tx: Transaction,
  cfg: TillConfig,
): Promise<{ reals: Set<string>; decoys: Set<string> }> {
  void cfg;
  const rows = await tx
    .select({ n: joinRequests.verificationNumber, d: joinRequests.decoyNumbers })
    .from(joinRequests);
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
 * INVARIANT: number allocation and the cap are serialised across the WHOLE DATABASE (both kinds,
 * every location), so the whole sweep → count → pendingNumbers → pick → insert sequence is atomic
 * against every other creator. WHY: two concurrent creators otherwise cannot see each other's
 * uncommitted rows, so both pick off a stale reserved-set — one's real can collide with the other's
 * (rule 3, the guarantee the one-in-three guess rate rests on), and both can pass a count of 9 and
 * insert to 11 (bypassing the cap and the decoy budget).
 *
 * WHAT ARRANGES IT is the venue file's write queue, not a lock this function takes. On PostgreSQL
 * this opened with a transaction-scoped advisory lock on a constant key, because two creators in
 * two transactions could interleave. `withTransaction` (`packages/db/src/tenancy.ts`) now runs its
 * body inside that queue, and the queue admits ONE write transaction on the file at a time — the
 * mechanism, and the receipt, are written out on `assertExtraListForWrite`
 * (`packages/catalogue/src/extras.ts`). The scope the constant key bought — the whole database,
 * never a location or a kind — is what the queue gives by construction, since it is per FILE.
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
    .where(eq(joinRequests.kind, input.kind));
  if (count >= PENDING_CAP) throw new AppError("device.join_full", {});

  // The REAL number avoids every existing real AND every issued decoy; the DECOYS avoid every real.
  // Both directions matter because the decoys are fixed here and live as long as the row: without the
  // first rule, a decoy issued at 10:01 becomes somebody's real number at 10:02, and the collision
  // §1.2 rule 3 forbids arrives by the back door. Worst case that reserves sixty of the hundred
  // values (twenty pending rows × three), which the cap is what keeps true.
  const { reals, decoys } = await pendingNumbers(tx, cfg);
  // `input.numbers` (when given) drives only the REAL pick — the one value tests assert on. Decoys
  // always draw from true randomness: reusing a rigged test double there would need to avoid
  // colliding with itself on every call, which no test needs to control, and a constant generator
  // would otherwise starve the decoy loop below on its own picks.
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

/**
 * What a joiner polling with `${joinId}.${token}` should be told.
 *
 * The id is carried THROUGH accept — an accepted request becomes a `devices` row with the same id and
 * the same token hash — so one selector answers both questions and the joiner's cookie is set once, at
 * join, and never re-issued. Denied, lapsed and never-existed all fold into `not_approved`: the
 * joiner's recovery is identical in every case.
 */
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
    .where(eq(joinRequests.kind, kind))
    .orderBy(joinRequests.createdAt);
}

/** Fetch one pending request by id, or throw. One tenant per database, so the id alone identifies
 * the row. */
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
    .where(eq(joinRequests.id, id));
  if (row === undefined) throw new AppError("join_request.not_found", {});
  return row;
}

/**
 * The KIND of one pending request, or `undefined` when this tenant holds no such row.
 *
 * Deliberately not {@link requirePending}'s throw. The shared by-id routes (`join-api.ts`) take their
 * permission from the row's kind, so they must read it BEFORE they authorize — and a caller holding
 * neither permission has to be refused 403 whether or not the id is live, or the status code itself
 * enumerates the venue's pending requests one guess at a time. That needs the miss as a VALUE the
 * route can hold until after the gate, not as a control-flow exit taken before it.
 *
 * It sweeps first, so a lapsed row reads
 * as absent exactly as it does to `requirePending` and the verbs that follow.
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
    .where(eq(joinRequests.id, id));
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
  // The set was fixed at join and is READ here, never re-rolled — see the column's comment and
  // design §1.2 rule 2. Only the ORDER varies per call.
  const choices = [row.verificationNumber, ...row.decoyNumbers];

  // Fisher-Yates over a cryptographic source: a predictable position would let a careless admin learn
  // "the real one is always first" and stop comparing, which is the whole failure this guards against.
  for (let i = choices.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [choices[i], choices[j]] = [choices[j]!, choices[i]!];
  }
  return { choices };
}

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
    .where(eq(joinRequests.id, joinId));
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
 * that function's header for why the difference is the whole point of this task. */
export type AcceptResult =
  | { ok: true; deviceId: string; name: string; formFactor: FormFactor }
  | { ok: false; reason: "mismatch" };

/**
 * Approve a device's ask-to-join.
 *
 * SINGLE-USE IS STRUCTURAL, NOT ACCIDENTAL: the very first thing this does is a
 * `DELETE … RETURNING`, the `consumeChallenge` shape (`passkey.ts`) — CONSUME before deciding anything.
 * Two concurrent accepts of the SAME request cannot interleave, and what arranges that is no longer a
 * lock this statement takes: `packages/store/src/write-queue.ts` admits one write transaction on the
 * venue file at a time, so the loser's DELETE runs after the winner has committed, matches zero rows,
 * and this throws `join_request.not_found` — which is also the semantically right answer, because by
 * the time the loser ran the request really had already been decided. That queue is this process's,
 * so a SECOND process on the same file is outside it; one node runs one server. Without the consume-first shape, two callers could both pass a plain SELECT and both
 * reach the device INSERT, which reuses the request's id as the device id — the loser would then
 * fail on a raw primary-key collision instead of a clean domain code (a Critical review finding: two
 * admins double-clicking Accept, or one admin with two tabs, must not reach a 500).
 *
 * The kind predicate rides the SAME delete, not a separate check: a `print_agent` row (or none, or
 * one already decided) all return zero rows and fold into the one
 * `join_request.not_found` — a device accept can never consume an agent's request.
 *
 * ONE transaction: the caller's `withTransaction` covers the consuming delete, the register
 * auto-creation and the device insert, so a LATER failure (an unknown profile, a station that does
 * not exist, the register insert) rolls the consumption back too — the request survives for a
 * genuine retry, only a wrong number or a successful accept ever makes the delete stick.
 *
 * A WRONG CHOICE DENIES — AND THAT IS WHY THIS RETURNS RATHER THAN THROWS. This function writes on
 * the `tx` it is handed and never opens its own; the caller's `withTransaction`
 * (`packages/db/src/tenancy.ts`) owns that transaction, so an `AppError`
 * thrown from here rolls the (already-consumed) row back into existence and a wrong tap becomes an
 * unlimited retry — the exact opposite of the property that makes one-in-three an acceptable guess
 * rate (design §1.2). The caller commits this result and throws `device.join_mismatch` AFTER the
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
    .where(and(eq(joinRequests.id, id), eq(joinRequests.kind, "device")))
    .returning({
      id: joinRequests.id,
      label: joinRequests.label,
      verificationNumber: joinRequests.verificationNumber,
      tokenHash: joinRequests.tokenHash,
      locationId: joinRequests.locationId,
    });
  if (row === undefined) throw new AppError("join_request.not_found", {});

  if (input.choice !== row.verificationNumber) {
    // Already consumed by the delete above — nothing further to do. Deleting again here would be
    // redundant, not a second denial: single-use means this row cannot be read or raced again.
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
 * Approve a print agent's ask-to-join. The mirror of {@link acceptDeviceJoinRequest}, minus the device
 * binding: consume the request with a locking `DELETE … RETURNING` whose `kind = "print_agent"`
 * predicate rides along (a device row, or an already-decided one, both fold into
 * `join_request.not_found`), then — only on a matching choice — insert the real `print_agents` row with
 * the request's own id and token hash, so the bearer the agent has held since join keeps working.
 * ONE transaction: the caller's `withTransaction` covers the delete and the insert together.
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
    .where(and(eq(joinRequests.id, id), eq(joinRequests.kind, "print_agent")))
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
 * What a print agent polling with `${joinId}.${secret}` should be told. The mirror of
 * {@link readJoinStatus}, resolving the approved fallback against `print_agents` rather than `devices`
 * — the id is carried through accept, so one selector answers both questions. Denied, lapsed and
 * never-existed all fold into `not_approved`; the agent's recovery (restart → re-join) is identical in
 * every case. One tenant per database, so both by-id reads need only the id.
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
    .where(eq(joinRequests.id, joinId));
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
  await tx.delete(joinRequests).where(eq(joinRequests.id, id));
  return row.kind;
}

/**
 * Enrol THIS node's own print agent (on-node auto-enrolment design §1.1, §3). Idempotent per node: a
 * node that has lost its token (a wiped volume, a reinstall) re-asks, and this refreshes the existing
 * row's token rather than inserting a second — so the agent id is stable and its printer bindings
 * survive. A row that has been REVOKED (`active = false`) is NOT silently reactivated: self-enrol
 * refuses with `device.join_revoked` so a deliberate revoke sticks (spec §4); an admin's "allow again"
 * is the only way back. The returned token is the accept-shape `${agentId}.${secret}` so it
 * authenticates through `authenticateAgent` exactly like a knock-and-accept token.
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

  // A revoked row (`active = false`) is refused, never silently reactivated (spec §4) — checked BEFORE
  // minting the token so a refused re-enrol does not spend a scrypt (`hashSecret`) it will throw away.
  if (existing !== undefined && !existing.active) throw new AppError("device.join_revoked", {});

  const secret = randomBytes(32).toString("base64url");
  const tokenHash = hashSecret(secret);

  if (existing !== undefined) {
    await tx.update(printAgents).set({ tokenHash }).where(eq(printAgents.id, existing.id));
    return { agentId: existing.id, token: `${existing.id}.${secret}` };
  }

  // First enrol for this node. No advisory lock (unlike createJoinRequest): exactly one agent process
  // runs per box, so two concurrent first-time enrols for the SAME node are not a real shape. If they
  // ever raced, the loser is refused by the `(node_id)` unique index and its agent simply
  // re-asks next tick, finding the row and refreshing — no wrong row, no duplicate. That backstop, not
  // a lock, is what keeps the invariant.
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

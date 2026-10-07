import "./errors.js";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  type Database,
  type Transaction,
  deviceProfiles,
  devices,
  joinRequests,
  nowIso,
  printAgents,
  withTransaction,
} from "@waitron/db";
import { endDeviceSessions, hashSecret, verifySecretAsync } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import type { FormFactor } from "@waitron/layouts";
import { insertDevice, resolveDeviceBinding, updateDeviceSettings } from "./device.js";
import { settleDevice } from "./device-equipment.js";
import type { PairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";

/** The predicate every statement here carries: a pending request belongs to the node that received
 * it (`join_requests.node_id`). */
const ownedBy = (cfg: Pick<TillConfig, "nodeId">) => eq(joinRequests.nodeId, cfg.nodeId);

/** Both surfaces' pending joins live in one table; this is which one a row is for. */
export type JoinRequestKind = "device" | "print_agent";

/** A request lapses after this long, even while the window stays open. A device request also ends
 * when the window shuts ({@link discardLapsedDeviceRequests}). */
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

export type DeviceRequestWindow = Pick<PairingMode, "openSince" | "orphanedClaims">;

/**
 * A device asks only while the window is open, so a device request made before the window last
 * shut, or one whose claim's hold has ended, is discarded. Print-agent requests are left alone: an
 * agent told `not_approved` stops for good (`packages/print-agent/src/agent.ts`), A269.
 *
 * Returns the ids of the claims whose hold has ended. The caller drops those claims only after its
 * transaction commits: dropped here, a rolled-back transaction would bring the row back unclaimed.
 */
export async function discardLapsedDeviceRequests(
  tx: Transaction,
  cfg: TillConfig,
  window: DeviceRequestWindow,
): Promise<string[]> {
  const since = window.openSince();
  const device = and(ownedBy(cfg), eq(joinRequests.kind, "device"));
  await tx
    .delete(joinRequests)
    .where(since === null ? device : and(device, lt(joinRequests.createdAt, since)));
  const orphaned = window.orphanedClaims();
  if (orphaned.length > 0)
    await tx.delete(joinRequests).where(and(device, inArray(joinRequests.id, orphaned)));
  return orphaned;
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
    /** A disabled device the knocking browser proved it is ({@link provenDisabledDevice}). */
    returning?: ReturningDevice | null;
  },
): Promise<{ joinId: string; verificationNumber: string; token: string; createdAt: string }> {
  await sweepLapsed(tx, cfg);
  let createdAt = nowIso();

  // The proof was checked before this transaction. A row changed since means another knock or Pair
  // got there first; a new-id request would take the browser's cookie and strand the device.
  let returningId: string | undefined;
  if (input.returning != null) {
    const [row] = await tx
      .select({ tokenHash: devices.tokenHash })
      .from(devices)
      .where(and(eq(devices.id, input.returning.deviceId), eq(devices.active, false)));
    if (row?.tokenHash !== input.returning.tokenHash) throw new AppError("device.join_stale", {});
    returningId = input.returning.deviceId;
    // The device's id is the request's primary key, so a second knock replaces the first.
    const [replaced] = await tx
      .delete(joinRequests)
      .where(and(ownedBy(cfg), eq(joinRequests.id, returningId), eq(joinRequests.kind, "device")))
      .returning({ createdAt: joinRequests.createdAt });
    // The manager's actions name an ask by its id and createdAt, so the ask replacing another under
    // the same id must not share its createdAt, even within one millisecond.
    if (replaced !== undefined && createdAt <= replaced.createdAt)
      createdAt = new Date(Date.parse(replaced.createdAt) + 1).toISOString();
  }

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
  const tokenHash = hashSecret(token);
  const [row] = await tx
    .insert(joinRequests)
    .values({
      ...(returningId === undefined ? {} : { id: returningId }),
      nodeId: cfg.nodeId,
      locationId: cfg.locationId,
      kind: input.kind,
      label: input.label,
      tokenHash,
      verificationNumber,
      decoyNumbers,
      createdAt,
    })
    .returning({ id: joinRequests.id });
  // The browser's cookie is replaced by one carrying this token, so the disabled row takes its hash:
  // the old token stops proving anything, and the new one still proves the device if this request is
  // denied or lapses.
  if (returningId !== undefined)
    await tx.update(devices).set({ tokenHash }).where(eq(devices.id, returningId));
  return { joinId: row!.id, verificationNumber, token, createdAt };
}

/** A disabled device a knocking browser has proved it is: the row's id and the hash its token
 * verified against. */
export interface ReturningDevice {
  deviceId: string;
  tokenHash: string;
}

/**
 * The disabled device a knock's parsed device cookie proves, or `null` — for no cookie (or a
 * malformed one, which parses to `null`), an id that names no device or an active one, or a token
 * that does not verify. Every `null` makes the knock an ordinary new request, answered as one from a
 * browser with no cookie.
 *
 * Called with no transaction open, so scrypt never holds the write lock; {@link createJoinRequest}
 * re-reads the row before relying on the result.
 */
export async function provenDisabledDevice(
  db: Database,
  parsed: { id: string; token: string } | null,
): Promise<ReturningDevice | null> {
  if (parsed === null) return null;
  const [row] = await db
    .select({ tokenHash: devices.tokenHash })
    .from(devices)
    .where(and(eq(devices.id, parsed.id), eq(devices.active, false)));
  if (row === undefined) return null;
  if (!(await verifySecretAsync(parsed.token, row.tokenHash))) return null;
  return { deviceId: parsed.id, tokenHash: row.tokenHash };
}

/**
 * What the Pair step offers for a returning device: the disabled row's own name and binding, and
 * whether its profile was retired.
 */
export interface ReturningDetails {
  name: string;
  profileId: string;
  stationId: string | null;
  watcherId: string | null;
  /** The profile was deleted while only disabled devices held it, so Pair cannot reuse it. */
  profileRetired: boolean;
}

/**
 * The pending device requests among `ids` that are a disabled device coming back, by id. A request
 * takes a device's id only after its knock proved the device's token ({@link createJoinRequest}).
 */
export async function returningDevicesOf(
  tx: Transaction,
  ids: readonly string[],
): Promise<Map<string, ReturningDetails>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: devices.id,
      name: devices.label,
      profileId: devices.deviceProfileId,
      stationId: devices.stationId,
      watcherId: devices.watcherId,
      retiredAt: deviceProfiles.retiredAt,
    })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(and(inArray(devices.id, [...ids]), eq(devices.active, false)));
  return new Map(
    rows.map(({ id, retiredAt, ...details }) => [
      id,
      { ...details, profileRetired: retiredAt !== null },
    ]),
  );
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
 * The kind and createdAt of one of this node's pending requests, or `undefined` when this node holds
 * no such row. A device request's id and createdAt together name one ask: a returning device's next
 * ask replaces it under the same id with a later createdAt ({@link createJoinRequest}).
 *
 * Deliberately not {@link requirePending}'s throw: the by-id routes (`join-api.ts`) read the kind
 * BEFORE they authorize, and must refuse a caller holding neither permission whether or not the id
 * is live, or the status code enumerates pending requests. So the miss is a VALUE held until after
 * the gate.
 */
export async function findJoinRequest(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<{ kind: JoinRequestKind; createdAt: string } | undefined> {
  await sweepLapsed(tx, cfg);
  const [row] = await tx
    .select({ kind: joinRequests.kind, createdAt: joinRequests.createdAt })
    .from(joinRequests)
    .where(and(ownedBy(cfg), eq(joinRequests.id, id)));
  return row;
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

type JoinStatus = "pending" | "approved" | "not_approved";

/** The token hash a poller's selector names: its pending request's, or, only when there is none, its
 * accepted row's. */
type StoredJoinHash = { pending: string } | { accepted: string } | null;

/** Called once the transaction that read `stored` has closed, so the write lock is not held while
 * scrypt runs. A pending request whose token does not verify is `not_approved`; it never falls
 * through to an accepted row. */
async function statusFor(token: string, stored: StoredJoinHash): Promise<JoinStatus> {
  if (stored === null) return "not_approved";
  if ("pending" in stored) {
    return (await verifySecretAsync(token, stored.pending)) ? "pending" : "not_approved";
  }
  return (await verifySecretAsync(token, stored.accepted)) ? "approved" : "not_approved";
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
  db: Database,
  cfg: TillConfig,
  joinId: string,
  token: string,
  window: DeviceRequestWindow & Pick<PairingMode, "dropClaim">,
): Promise<JoinStatus> {
  let dropped: string[] = [];
  const stored = await withTransaction(db, async (tx): Promise<StoredJoinHash> => {
    await sweepLapsed(tx, cfg);
    dropped = await discardLapsedDeviceRequests(tx, cfg, window);
    const [pending] = await tx
      .select({ tokenHash: joinRequests.tokenHash })
      .from(joinRequests)
      .where(and(ownedBy(cfg), eq(joinRequests.id, joinId)));
    if (pending !== undefined) return { pending: pending.tokenHash };
    const [accepted] = await tx
      .select({ tokenHash: devices.tokenHash })
      .from(devices)
      .where(and(eq(devices.id, joinId), eq(devices.active, true)));
    return accepted === undefined ? null : { accepted: accepted.tokenHash };
  });
  for (const id of dropped) window.dropClaim(id);
  return statusFor(token, stored);
}

/**
 * Compare the tapped number with a device request's own. A mismatch DELETES the request and is
 * returned, not thrown, so the deletion commits and a wrong tap cannot be retried.
 *
 * `ask` names the ask the manager was shown ({@link findJoinRequest}); one another ask has replaced
 * is `join_request.not_found`, and the request now under its id is neither deleted nor matched.
 */
export async function checkDeviceJoinNumber(
  tx: Transaction,
  cfg: TillConfig,
  ask: { id: string; createdAt: string },
  choice: string,
): Promise<{ ok: boolean }> {
  await sweepLapsed(tx, cfg);
  const where = and(
    ownedBy(cfg),
    eq(joinRequests.id, ask.id),
    eq(joinRequests.createdAt, ask.createdAt),
    eq(joinRequests.kind, "device"),
  );
  const [row] = await tx
    .select({ n: joinRequests.verificationNumber })
    .from(joinRequests)
    .where(where);
  if (row === undefined) throw new AppError("join_request.not_found", {});
  if (choice === row.n) return { ok: true };
  await tx.delete(joinRequests).where(where);
  return { ok: false };
}

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
 * ONE transaction: a later failure (an unknown profile, a missing station, a taken device name)
 * rolls the consumption back too, so the request survives for a genuine retry.
 *
 * The number is not compared here: {@link checkDeviceJoinNumber} compared it earlier, and the
 * accept route refuses a login that holds no live claim from that check. The device is named
 * `input.label`, not the label the request was made with.
 *
 * A request holding a disabled device's id (a returning knock, {@link createJoinRequest}) enables
 * that row, under the request's token, rather than inserting one.
 */
export async function acceptDeviceJoinRequest(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
  input: {
    label: string;
    profileId: string;
    stationId?: string | null;
    watcherId?: string | null;
  },
): Promise<{ deviceId: string; name: string; formFactor: FormFactor }> {
  await sweepLapsed(tx, cfg);

  const [row] = await tx
    .delete(joinRequests)
    .where(and(ownedBy(cfg), eq(joinRequests.id, id), eq(joinRequests.kind, "device")))
    .returning({
      id: joinRequests.id,
      tokenHash: joinRequests.tokenHash,
      locationId: joinRequests.locationId,
    });
  if (row === undefined) throw new AppError("join_request.not_found", {});

  const binding = await resolveDeviceBinding(tx, cfg, {
    profileId: input.profileId,
    stationId: input.stationId,
    watcherId: input.watcherId,
  });

  const [disabled] = await tx
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.id, row.id), eq(devices.active, false)));
  if (disabled !== undefined) {
    // An ACTIVE row with this id is left to the insert below, which refuses it.
    await updateDeviceSettings(
      tx,
      disabled,
      {
        label: input.label,
        profileId: input.profileId,
        stationId: binding.stationId,
        watcherId: binding.watcherId,
      },
      { active: true, tokenHash: row.tokenHash },
    );
    // The Disable route ends them itself; this catches a device turned off outside it.
    await endDeviceSessions(tx, row.id);
    return { deviceId: row.id, name: input.label, formFactor: binding.formFactor };
  }

  await insertDevice(tx, {
    id: row.id,
    locationId: row.locationId,
    stationId: binding.stationId,
    watcherId: binding.watcherId,
    deviceProfileId: input.profileId,
    label: input.label,
    tokenHash: row.tokenHash,
    active: true,
  });
  await settleDevice(tx, row.id, { acquire: true });

  return { deviceId: row.id, name: input.label, formFactor: binding.formFactor };
}

/** What {@link acceptPrintAgentJoinRequest} hands back. A wrong choice is a RESULT, never a throw:
 * an AppError would roll the consuming delete back into existence and turn a wrong tap into an
 * unlimited retry (design §1.2). */
export type AgentAcceptResult =
  { ok: true; agentId: string; name: string } | { ok: false; reason: "mismatch" };

/**
 * Approve a print agent's ask-to-join. Unlike {@link acceptDeviceJoinRequest}, it compares the
 * number itself, after the consuming delete, and binds nothing. The `print_agents` row takes the
 * request's own id and token hash, so the bearer the agent has held since join keeps working.
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
    // Already consumed by the delete above — a wrong tap is single-use, same as `checkDeviceJoinNumber`.
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
  db: Database,
  cfg: TillConfig,
  joinId: string,
  token: string,
): Promise<JoinStatus> {
  const stored = await withTransaction(db, async (tx): Promise<StoredJoinHash> => {
    await sweepLapsed(tx, cfg);
    const [pending] = await tx
      .select({ tokenHash: joinRequests.tokenHash })
      .from(joinRequests)
      .where(and(ownedBy(cfg), eq(joinRequests.id, joinId)));
    if (pending !== undefined) return { pending: pending.tokenHash };
    const [accepted] = await tx
      .select({ tokenHash: printAgents.tokenHash })
      .from(printAgents)
      .where(and(eq(printAgents.id, joinId), eq(printAgents.active, true)));
    return accepted === undefined ? null : { accepted: accepted.tokenHash };
  });
  return statusFor(token, stored);
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

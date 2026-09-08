import "./errors.js";
import { randomBytes, randomInt } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { type Transaction, devices, joinRequests } from "@waitron/db";
import { hashSecret, verifySecret } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";

/** Both surfaces' pending joins live in one table; this is which one a row is for. */
export type JoinRequestKind = "device" | "print_agent";

/** A request lapses after this long — the same fifteen minutes the pairing code had, and the same as
 * the pairing window, so a knock cannot outlive the window that admitted it by more than one window. */
export const JOIN_TTL_MS = 15 * 60 * 1000;

/** Pending rows per (tenant, kind). Ten is enough for the largest install anyone runs at once, and it
 * bounds both the admin's attention and the numbers the decoy rule must avoid. */
export const PENDING_CAP = 10;

/** Delete this tenant's lapsed requests. Called at the head of every verb that reads or counts them, so
 * a lapsed row never occupies the cap, never blocks a number, and never appears in the pending list —
 * the same opportunistic sweep the pairing code's TTL used, rather than a background job. */
async function sweepLapsed(tx: Transaction, cfg: TillConfig): Promise<void> {
  await tx
    .delete(joinRequests)
    .where(
      and(
        eq(joinRequests.tenantId, cfg.tenantId),
        lt(joinRequests.createdAt, new Date(Date.now() - JOIN_TTL_MS).toISOString()),
      ),
    );
}

/** Every number currently spoken for in this tenant, EITHER kind, split by role. The cross-surface
 * scope is the point (design §1.2 rule 3): an agent request and a device request must never show the
 * same number, or an admin comparing across two screens can be honestly misled. */
export async function pendingNumbers(
  tx: Transaction,
  cfg: TillConfig,
): Promise<{ reals: Set<string>; decoys: Set<string> }> {
  const rows = await tx
    .select({ n: joinRequests.verificationNumber, d: joinRequests.decoyNumbers })
    .from(joinRequests)
    .where(eq(joinRequests.tenantId, cfg.tenantId));
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
    .select({ count: sql<number>`count(*)::int` })
    .from(joinRequests)
    .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.kind, input.kind)));
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
    /* v8 ignore next */
    return undefined;
  };
  const spokenFor = new Set([...reals, ...decoys]);
  const nextReal = input.numbers ?? (() => randomInt(0, 100));
  const verificationNumber = pick(nextReal, spokenFor);
  /* v8 ignore next */
  if (verificationNumber === undefined) throw new AppError("device.join_full", {});
  const decoyNumbers: string[] = [];
  const decoyForbidden = new Set([...reals, verificationNumber]);
  while (decoyNumbers.length < 2) {
    const d = pick(() => randomInt(0, 100), decoyForbidden);
    /* v8 ignore next */
    if (d === undefined) throw new AppError("device.join_full", {});
    decoyNumbers.push(d);
    decoyForbidden.add(d);
  }

  const token = randomBytes(32).toString("base64url");
  const [row] = await tx
    .insert(joinRequests)
    .values({
      tenantId: cfg.tenantId,
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
    .where(and(eq(joinRequests.tenantId, cfg.tenantId), eq(joinRequests.id, joinId)));
  if (pending !== undefined) {
    return verifySecret(token, pending.tokenHash) ? "pending" : "not_approved";
  }
  const [accepted] = await tx
    .select({ tokenHash: devices.tokenHash })
    .from(devices)
    .where(
      and(eq(devices.tenantId, cfg.tenantId), eq(devices.id, joinId), eq(devices.active, true)),
    );
  if (accepted !== undefined && verifySecret(token, accepted.tokenHash)) return "approved";
  return "not_approved";
}

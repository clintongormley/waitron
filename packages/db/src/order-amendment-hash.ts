import { createHash } from "node:crypto";

/**
 * The per-order tamper-evidence chain over `order_amendments` (design §4). Pure and DB-free on
 * purpose — hashing and verification are LOGIC, so they are unit-tested directly, never against a
 * real-role Postgres (CLAUDE.md §4). The DB side — the parent-row lock, the sequence read, the
 * insert — lives in ./append-order-amendment.ts.
 *
 * A faithful, lighter port of `packages/workforce/src/chain-hash.ts` (itself the fiscal `huella.ts`
 * precedent): an ORDERED array of name/value pairs joined into a canonical string, SHA-256,
 * uppercase hex. English field names throughout — this log is generic (`entry_hash`/
 * `prev_entry_hash`/`sequence_no`); the legal term (art. 29.2.j LGT) lives only in the schema
 * comment, not in the hashed vocabulary.
 *
 * The chain is keyed per `(tenant, working_order)`, not per location: an order's amendments form
 * their own short chain, opened by the `order_placed` genesis entry. There is no chain-head table
 * (Decision 2) — the parent `working_orders` row IS the lock, so this module never sees head state.
 */

/** The content of one amendment that the chain hash commits to, plus the predecessor's hash. */
export interface AmendmentHashInput {
  /** The entry's 1-based position within THIS order's amendment chain; ours and contiguous. */
  sequenceNo: number;
  workingOrderId: string;
  /** `order_placed` (the genesis, written when the order is placed) or `order_cancelled`. */
  kind: "order_placed" | "order_cancelled";
  /** The accountable actor (the operator uuid from the open session) — hashed so it cannot be
   * silently re-pointed past the immutability floor (#52; the chain-hash.ts correctionActorId
   * precedent). */
  actorId: string;
  /** The contestable reason (art. 29.2.j) — null on the genesis `order_placed`, required by the app
   * for `order_cancelled`. Hashed as the empty string when null, exactly as chain-hash.ts hashes a
   * null correctionReason: the legal content, not our metadata. */
  reason: string | null;
  /** Capture provenance — the capturing till and node, both hashed so neither can be re-pointed at a
   * different device undetected (the chain-hash.ts capturedByTillId precedent, #52). */
  capturedByTillId: string;
  capturedByNodeId: string;
  /** The trusted event instant, an ISO-8601 string ALREADY TRUNCATED to whole seconds by
   * append-order-amendment.ts before it reaches here. Hashed as the INSTANT (epoch ms), not the
   * wall-clock string, so a change of offset representation that preserves the instant does not move
   * the digest. The stored column, the CHECK `date_trunc('second', event_at) = event_at` and the
   * read-back all agree only at whole-second granularity, which is why the truncation happens at the
   * single write choke point (the time_entries precedent). */
  eventAt: string;
  /** The venue's trusted-clock wall offset (minutes), travelling separately from the instant so the
   * amendment reprints in venue time (#52). Hashed in its own right. */
  eventOffsetMinutes: number;
  /** The predecessor's `entry_hash` — null (hashed as empty) for the genesis entry, exactly as the
   * fiscal huella hashes an empty predecessor for `PrimerRegistro`. */
  prevEntryHash: string | null;
}

/** A read-back chain row: its content, its genesis flag, and its stored hash — enough to re-verify. */
export interface VerifiableAmendment extends AmendmentHashInput {
  isFirstEntry: boolean;
  entryHash: string;
}

/** Why a chain failed verification, and where. `sequenceNo` is the offending row's stored position
 * (or the position the walk expected, for a gap). */
export type AmendmentVerification =
  | { ok: true }
  | {
      ok: false;
      reason: "sequence" | "genesis" | "broken_link" | "hash_mismatch";
      sequenceNo: number;
    };

/**
 * Joins ordered name/value pairs into the canonical hash input — `name=value` pairs `&`-joined, no
 * trailing separator (the `joinCampos` shape from `huella.ts`). The key is never omitted; an absent
 * value contributes `Name=` and still consumes its separator, so the separator count is fixed.
 */
function joinFields(fields: ReadonlyArray<readonly [string, string]>): string {
  return fields.map(([name, value]) => `${name}=${value}`).join("&");
}

/**
 * The canonical string for one amendment — the exact bytes SHA-256 digests. The field ORDER is
 * FIXED and documented: identity (`SequenceNo`, `WorkingOrderId`, `Kind`), then the content the
 * amendment is accountable for (`ActorId`, `Reason`), then capture provenance (`CapturedByTillId`,
 * `CapturedByNodeId`), then the event, and `PrevEntryHash` last so the chain link reads at the end.
 * Changing this order changes every digest, so it must not move once real chains exist.
 */
function canonicalString(input: AmendmentHashInput): string {
  return joinFields([
    ["SequenceNo", String(input.sequenceNo)],
    ["WorkingOrderId", input.workingOrderId],
    ["Kind", input.kind],
    // Who is accountable, and why — the accountable actor and the contestable reason (empty when null).
    ["ActorId", input.actorId],
    ["Reason", input.reason ?? ""],
    // Capture provenance — the capturing till and node, hashed so neither can be re-pointed undetected.
    ["CapturedByTillId", input.capturedByTillId],
    ["CapturedByNodeId", input.capturedByNodeId],
    // The event as an absolute instant (epoch ms), never its wall-clock string — see `eventAt`. The
    // offset travels separately so the amendment can reprint in venue time.
    ["EventAtMs", String(Date.parse(input.eventAt))],
    ["EventOffsetMinutes", String(input.eventOffsetMinutes)],
    // The PREVIOUS entry's hash — empty for the genesis entry — never this entry's own hash.
    ["PrevEntryHash", input.prevEntryHash ?? ""],
  ]);
}

/** SHA-256 over the UTF-8 canonical string, uppercase hex — the `computeHuella` shape from huella.ts;
 * the uppercase-hex form the `order_amendments_entry_hash_ck` CHECK requires. */
export function computeAmendmentHash(input: AmendmentHashInput): string {
  return createHash("sha256").update(canonicalString(input), "utf8").digest("hex").toUpperCase();
}

/**
 * Verifies a whole per-order chain end to end: `hash_n = H(content_n ‖ hash_{n-1})` recomputed and
 * compared, plus the structural invariants a hash chain rests on. Any inserted, removed, or
 * reordered entry breaks at least one of them. Returns a structured result rather than throwing — a
 * caller (an inspector's report, a scheduled audit) wants the FIRST break's position, not a
 * control-flow exception.
 *
 * The entries are sorted by `sequenceNo` first, so the read-back row order is irrelevant; the chain
 * is defined by the HASHED sequence (#52's tie-break-on-hashed-sequence lesson), not by however the
 * rows happened to arrive.
 */
export function verifyAmendmentChain(
  entries: readonly VerifiableAmendment[],
): AmendmentVerification {
  const ordered = [...entries].sort((a, b) => a.sequenceNo - b.sequenceNo);
  let expectedPrev: string | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i]!;
    // Positions are ours and contiguous from 1 (append-order-amendment.ts assigns max + 1). A gap or
    // a duplicate — what a removal or an insertion leaves behind — fails here.
    if (entry.sequenceNo !== i + 1) {
      return { ok: false, reason: "sequence", sequenceNo: i + 1 };
    }
    // The genesis flag must agree with the position: exactly the first entry is the first entry.
    if (entry.isFirstEntry !== (i === 0)) {
      return { ok: false, reason: "genesis", sequenceNo: entry.sequenceNo };
    }
    // The predecessor pointer must equal the previous entry's stored hash (null before the genesis).
    // A reorder or a splice leaves a pointer aimed at the wrong neighbour, caught here.
    if ((entry.prevEntryHash ?? null) !== expectedPrev) {
      return { ok: false, reason: "broken_link", sequenceNo: entry.sequenceNo };
    }
    // The stored hash must reproduce from the entry's own content — content tampering after the
    // fact, or a fabricated row whose hash was never computed correctly, fails here.
    if (computeAmendmentHash(entry) !== entry.entryHash) {
      return { ok: false, reason: "hash_mismatch", sequenceNo: entry.sequenceNo };
    }
    expectedPrev = entry.entryHash;
  }
  return { ok: true };
}

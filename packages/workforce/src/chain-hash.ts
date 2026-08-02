import { createHash } from "node:crypto";

/**
 * The generic, regime-neutral tamper-evidence chain over `time_entries` (design §5, Slice 4). Pure
 * and DB-free on purpose — hashing and verification are LOGIC, so they are unit-tested directly (and
 * on PGlite through the append path), never against a real-role Postgres (CLAUDE.md §4). The DB side
 * — the row-locked head, the retry — lives in ./chain.ts.
 *
 * Mirrors `packages/verifactu/src/huella.ts` (the proven fiscal precedent): an ORDERED array of
 * name/value pairs joined into a canonical string, SHA-256, uppercase hex. English field names
 * throughout — this chain is generic (`entry_hash`/`prev_entry_hash`/`sequence_no`), unlike the
 * fiscal chain whose vocabulary is a regime concept.
 */

/** The content of one time entry that the chain hash commits to, plus the predecessor's hash. */
export interface EntryHashInput {
  /** The entry's 1-based position within its (tenant, location) chain. */
  sequenceNo: number;
  personId: string;
  locationId: string;
  entryKind: string;
  /** The trusted event instant, an ISO-8601 timestamptz string, ALREADY TRUNCATED to whole seconds
   * by chain.ts's `attemptAppend` before it reaches here. Hashed as the INSTANT (epoch ms), not the
   * string, so a change of offset representation that preserves the instant does not change the
   * digest. The read-back projects `event_at` at SECOND precision (`to_char(… 'HH24:MI:SS')` in
   * clocking.ts and the chain-test read-backs), so the recompute matches the stored hash ONLY at
   * whole-second granularity: a sub-second component would be hashed here but dropped on read-back,
   * recomputing a different digest — a false `hash_mismatch`. The whole-second truncation at the
   * single write choke point, backstopped by the `time_entries_event_at_second_ck` CHECK, is what
   * keeps the stored column, the committed hash and the read-back one identical representation. */
  eventAt: string;
  eventOffsetMinutes: number;
  recordedByPersonId: string;
  /** The till that captured the event, when one did — null for a manually recorded entry. Capture
   * attribution the record itself carries (art. 34.9), so it is hashed: a party past the immutability
   * floor must not be able to re-point a captured event at a different till undetected. */
  capturedByTillId: string | null;
  /** On a correction, the entry it supersedes; null on a base event. */
  correctsEntryId: string | null;
  /** On a correction, why it was made (art. 34.9's attributable-and-contestable field); null on a
   * base event. Hashed because the reason is the contestable legal content, not our metadata. */
  correctionReason: string | null;
  /** On a correction, `requested`/`approved`; null on a base event. */
  correctionStatus: string | null;
  /** On a correction, the accountable actor who requested or approved it; null on a base event.
   * Distinct from `recordedByPersonId` (the device operator) and hashed in its own right — hashing
   * `recordedByPersonId` alone protected the actor only by the coincidence that `appendCorrection`
   * sets both to the same person. */
  correctionActorId: string | null;
  /** The predecessor's `entry_hash` — null (hashed as empty) for the genesis entry, exactly as the
   * fiscal huella hashes an empty predecessor for `PrimerRegistro`. */
  prevEntryHash: string | null;
}

/** A read-back chain row: its content, its genesis flag, and its stored hash — enough to re-verify. */
export interface VerifiableEntry extends EntryHashInput {
  isFirstEntry: boolean;
  entryHash: string;
}

/** Why a chain failed verification, and where. `sequenceNo` is the stored position of the offending
 * row (or the position the walk expected, for a gap). */
export type ChainVerification =
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
 * The canonical string for one entry — the exact bytes SHA-256 digests. The field ORDER is free (no
 * chain data exists yet, so nothing is bound to a prior layout) but FIXED and documented: capture
 * attribution (`RecordedByPersonId`, `CapturedByTillId`) together, then the correction group
 * (`CorrectsEntryId`, `CorrectionReason`, `CorrectionStatus`, `CorrectionActorId`) together, and
 * `PrevEntryHash` last so the chain link reads at the end. Changing this order changes every digest,
 * so it must not move once real chains exist.
 */
function canonicalString(input: EntryHashInput): string {
  return joinFields([
    ["SequenceNo", String(input.sequenceNo)],
    ["PersonId", input.personId],
    ["LocationId", input.locationId],
    ["EntryKind", input.entryKind],
    // The event as an absolute instant (epoch ms), never its wall-clock string — see `eventAt`.
    ["EventAtMs", String(Date.parse(input.eventAt))],
    ["EventOffsetMinutes", String(input.eventOffsetMinutes)],
    // Capture attribution: who recorded the event and which till captured it (both art. 34.9).
    ["RecordedByPersonId", input.recordedByPersonId],
    ["CapturedByTillId", input.capturedByTillId ?? ""],
    // The correction group — what it supersedes, why, its lifecycle state, and the accountable actor.
    ["CorrectsEntryId", input.correctsEntryId ?? ""],
    ["CorrectionReason", input.correctionReason ?? ""],
    ["CorrectionStatus", input.correctionStatus ?? ""],
    ["CorrectionActorId", input.correctionActorId ?? ""],
    // The PREVIOUS entry's hash — empty for the genesis entry — never this entry's own hash.
    ["PrevEntryHash", input.prevEntryHash ?? ""],
  ]);
}

/** SHA-256 over the UTF-8 canonical string, uppercase hex — the `computeHuella` shape from huella.ts. */
export function computeEntryHash(input: EntryHashInput): string {
  return createHash("sha256").update(canonicalString(input), "utf8").digest("hex").toUpperCase();
}

/**
 * Verifies a whole chain end to end: `hash_n = H(hash_{n-1} ‖ entry_n)` recomputed and compared,
 * plus the structural invariants a hash chain rests on. Any inserted, removed, or reordered entry
 * breaks at least one of them (design §5 / §7's teeth-tests). Returns a structured result rather than
 * throwing — a caller (an inspector's report, a scheduled audit) wants the FIRST break's position,
 * not a control-flow exception.
 *
 * The entries are sorted by `sequenceNo` first, so the read-back row order is irrelevant; the chain
 * is defined by the sequence, not by however the rows happened to arrive.
 */
export function verifyChain(entries: readonly VerifiableEntry[]): ChainVerification {
  const ordered = [...entries].sort((a, b) => a.sequenceNo - b.sequenceNo);
  let expectedPrev: string | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i]!;
    // Positions are ours and contiguous from 1 (chain.ts assigns head.sequenceNo + 1). A gap or a
    // duplicate — what a removal or an insertion leaves behind — fails here.
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
    if (computeEntryHash(entry) !== entry.entryHash) {
      return { ok: false, reason: "hash_mismatch", sequenceNo: entry.sequenceNo };
    }
    expectedPrev = entry.entryHash;
  }
  return { ok: true };
}

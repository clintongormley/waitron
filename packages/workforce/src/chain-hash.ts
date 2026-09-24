import { createHash } from "node:crypto";

/** The content of one time entry that the chain hash commits to, plus the predecessor's hash. */
export interface EntryHashInput {
  /** The entry's 1-based position within its (node, location) chain. */
  sequenceNo: number;
  personId: string;
  locationId: string;
  /** Hashed so a row cannot be re-pointed at another node's chain undetected. This digest is ours to
   * define; CLAUDE.md §5's rule against hashing our own metadata is about the FISCAL digest. */
  nodeId: string;
  entryKind: string;
  /** Already truncated to whole seconds by chain.ts's `attemptAppend`, so the stored text and the
   * hashed value agree (`time_entries_event_at_second_ck` backstops it). Hashed as the instant
   * (epoch ms), not the string, so re-spelling the same instant does not change the digest. */
  eventAt: string;
  /** Already truncated to whole seconds, like `eventAt`. Hashed because it is the cross-node
   * correction tie-break, which must not be reordered undetected. */
  recordedAt: string;
  eventOffsetMinutes: number;
  recordedByPersonId: string;
  /** Null for a manually recorded entry. Hashed so a captured event cannot be re-pointed at a
   * different till undetected. */
  capturedByTillId: string | null;
  /** The four correction fields are null on a base event. */
  correctsEntryId: string | null;
  correctionReason: string | null;
  correctionStatus: string | null;
  /** The accountable actor, hashed in its own right: it is not always `recordedByPersonId`. */
  correctionActorId: string | null;
  /** Null (hashed as empty) for the genesis entry. */
  prevEntryHash: string | null;
}

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

/** An absent value still contributes `Name=`, so the separator count is fixed. */
function joinFields(fields: ReadonlyArray<readonly [string, string]>): string {
  return fields.map(([name, value]) => `${name}=${value}`).join("&");
}

/**
 * The exact bytes SHA-256 digests. Changing the field order or any field's encoding changes every
 * digest, so neither may move once real chains exist.
 */
function canonicalString(input: EntryHashInput): string {
  return joinFields([
    ["SequenceNo", String(input.sequenceNo)],
    ["PersonId", input.personId],
    ["LocationId", input.locationId],
    ["NodeId", input.nodeId],
    ["EntryKind", input.entryKind],
    ["EventAtMs", String(Date.parse(input.eventAt))],
    ["RecordedAtMs", String(Date.parse(input.recordedAt))],
    ["EventOffsetMinutes", String(input.eventOffsetMinutes)],
    ["RecordedByPersonId", input.recordedByPersonId],
    ["CapturedByTillId", input.capturedByTillId ?? ""],
    ["CorrectsEntryId", input.correctsEntryId ?? ""],
    ["CorrectionReason", input.correctionReason ?? ""],
    ["CorrectionStatus", input.correctionStatus ?? ""],
    ["CorrectionActorId", input.correctionActorId ?? ""],
    ["PrevEntryHash", input.prevEntryHash ?? ""],
  ]);
}

/** SHA-256 over the UTF-8 canonical string, uppercase hex. */
export function computeEntryHash(input: EntryHashInput): string {
  return createHash("sha256").update(canonicalString(input), "utf8").digest("hex").toUpperCase();
}

/** Reports the first break's position rather than throwing. Input order does not matter. */
export function verifyChain(entries: readonly VerifiableEntry[]): ChainVerification {
  const ordered = [...entries].sort((a, b) => a.sequenceNo - b.sequenceNo);
  let expectedPrev: string | null = null;
  for (let i = 0; i < ordered.length; i++) {
    const entry = ordered[i]!;
    if (entry.sequenceNo !== i + 1) {
      return { ok: false, reason: "sequence", sequenceNo: i + 1 };
    }
    if (entry.isFirstEntry !== (i === 0)) {
      return { ok: false, reason: "genesis", sequenceNo: entry.sequenceNo };
    }
    if ((entry.prevEntryHash ?? null) !== expectedPrev) {
      return { ok: false, reason: "broken_link", sequenceNo: entry.sequenceNo };
    }
    if (computeEntryHash(entry) !== entry.entryHash) {
      return { ok: false, reason: "hash_mismatch", sequenceNo: entry.sequenceNo };
    }
    expectedPrev = entry.entryHash;
  }
  return { ok: true };
}

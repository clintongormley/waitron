import { describe, expect, it } from "vitest";
import {
  computeEntryHash,
  verifyChain,
  type EntryHashInput,
  type VerifiableEntry,
} from "./chain-hash.js";

/** A base clock event's content, minus the chain fields (`sequenceNo`, `prevEntryHash`). */
function content(over: Partial<EntryHashInput> = {}): EntryHashInput {
  return {
    sequenceNo: 1,
    personId: "11111111-1111-4111-8111-111111111111",
    locationId: "22222222-2222-4222-8222-222222222222",
    entryKind: "in",
    eventAt: "2026-01-05T09:00:00Z",
    eventOffsetMinutes: 0,
    recordedByPersonId: "11111111-1111-4111-8111-111111111111",
    capturedByTillId: null,
    correctsEntryId: null,
    correctionReason: null,
    correctionStatus: null,
    correctionActorId: null,
    prevEntryHash: null,
    ...over,
  };
}

/** Builds one chained, verifiable entry from content — the shape a read-back row projects to. */
function link(input: EntryHashInput, isFirstEntry: boolean): VerifiableEntry {
  return { ...input, isFirstEntry, entryHash: computeEntryHash(input) };
}

/** A valid three-entry chain: genesis + two linked successors. */
function validChain(): VerifiableEntry[] {
  const e1input = content({ sequenceNo: 1, entryKind: "in", prevEntryHash: null });
  const e1 = link(e1input, true);
  const e2input = content({
    sequenceNo: 2,
    entryKind: "break_start",
    eventAt: "2026-01-05T13:00:00Z",
    prevEntryHash: e1.entryHash,
  });
  const e2 = link(e2input, false);
  const e3input = content({
    sequenceNo: 3,
    entryKind: "out",
    eventAt: "2026-01-05T17:00:00Z",
    prevEntryHash: e2.entryHash,
  });
  const e3 = link(e3input, false);
  return [e1, e2, e3];
}

describe("computeEntryHash", () => {
  it("produces a 64-character uppercase hex digest", () => {
    expect(computeEntryHash(content())).toMatch(/^[0-9A-F]{64}$/);
  });

  it("is deterministic for identical content", () => {
    expect(computeEntryHash(content())).toBe(computeEntryHash(content()));
  });

  it("commits to the predecessor hash — a different prev changes the digest", () => {
    const genesis = computeEntryHash(content({ prevEntryHash: null }));
    const linked = computeEntryHash(content({ prevEntryHash: "A".repeat(64) }));
    expect(linked).not.toBe(genesis);
  });

  it.each([
    ["sequenceNo", { sequenceNo: 2 }],
    ["personId", { personId: "33333333-3333-4333-8333-333333333333" }],
    ["locationId", { locationId: "44444444-4444-4444-8444-444444444444" }],
    ["entryKind", { entryKind: "out" }],
    ["eventAt", { eventAt: "2026-01-05T09:00:01Z" }],
    ["eventOffsetMinutes", { eventOffsetMinutes: 60 }],
    ["recordedByPersonId", { recordedByPersonId: "55555555-5555-4555-8555-555555555555" }],
    ["capturedByTillId", { capturedByTillId: "77777777-7777-4777-8777-777777777777" }],
    ["correctsEntryId", { correctsEntryId: "66666666-6666-4666-8666-666666666666" }],
    ["correctionReason", { correctionReason: "forgot to clock out" }],
    ["correctionStatus", { correctionStatus: "approved" }],
    ["correctionActorId", { correctionActorId: "88888888-8888-4888-8888-888888888888" }],
  ] satisfies [string, Partial<EntryHashInput>][])(
    "changes the digest when %s changes",
    (_field, over) => {
      expect(computeEntryHash(content(over))).not.toBe(computeEntryHash(content()));
    },
  );

  it("commits to the event instant, not its string form — the same instant hashes identically", () => {
    // `09:00Z` and `10:00+01:00` are the same instant; the hash is over the instant (epoch ms), so a
    // change of offset representation that preserves the instant must not change the digest.
    const asZulu = computeEntryHash(content({ eventAt: "2026-01-05T09:00:00Z" }));
    const asOffset = computeEntryHash(content({ eventAt: "2026-01-05T10:00:00+01:00" }));
    expect(asOffset).toBe(asZulu);
  });
});

describe("verifyChain", () => {
  it("accepts an untampered chain (the negative control)", () => {
    expect(verifyChain(validChain())).toEqual({ ok: true });
  });

  it("detects an INSERTED entry (teeth-test)", () => {
    const chain = validChain();
    // An attacker splices in a fabricated event, renumbering the tail to make room — but without
    // recomputing the tail's stored hashes/links (a full downstream rewrite is out of an unsigned
    // chain's threat model). The inserted row's own hash is valid; the break shows downstream.
    const injectedInput = content({
      sequenceNo: 2,
      entryKind: "out",
      eventAt: "2026-01-05T12:00:00Z",
      prevEntryHash: chain[0]!.entryHash,
    });
    const injected = link(injectedInput, false);
    const tampered: VerifiableEntry[] = [
      chain[0]!,
      injected,
      { ...chain[1]!, sequenceNo: 3 },
      { ...chain[2]!, sequenceNo: 4 },
    ];
    expect(verifyChain(tampered).ok).toBe(false);
  });

  it("detects a REMOVED entry (teeth-test)", () => {
    const chain = validChain();
    // The middle entry is deleted from the record — the tail's predecessor pointer now dangles.
    const tampered = [chain[0]!, chain[2]!];
    expect(verifyChain(tampered).ok).toBe(false);
  });

  it("detects a REORDERED pair (teeth-test)", () => {
    const chain = validChain();
    // Two entries swap chain positions (their sequence numbers), leaving their stored links pointing
    // at the wrong neighbours.
    const tampered: VerifiableEntry[] = [
      chain[0]!,
      { ...chain[1]!, sequenceNo: 3 },
      { ...chain[2]!, sequenceNo: 2 },
    ];
    expect(verifyChain(tampered).ok).toBe(false);
  });

  it("detects in-place content tampering that leaves the stored hash stale", () => {
    const chain = validChain();
    // The employer rewrites a clock-out time but cannot recompute the stored hash without the whole
    // downstream chain — the recompute no longer matches.
    const tampered: VerifiableEntry[] = [
      chain[0]!,
      chain[1]!,
      { ...chain[2]!, eventAt: "2026-01-05T16:00:00Z" },
    ];
    const result = verifyChain(tampered);
    expect(result).toEqual({ ok: false, reason: "hash_mismatch", sequenceNo: 3 });
  });

  it("detects a genesis flag that disagrees with the chain position", () => {
    const chain = validChain();
    const tampered: VerifiableEntry[] = [
      { ...chain[0]!, isFirstEntry: false },
      chain[1]!,
      chain[2]!,
    ];
    expect(verifyChain(tampered)).toEqual({ ok: false, reason: "genesis", sequenceNo: 1 });
  });

  it("sorts by sequence before verifying, so read-back order does not matter", () => {
    const [e1, e2, e3] = validChain();
    expect(verifyChain([e3!, e1!, e2!])).toEqual({ ok: true });
  });
});

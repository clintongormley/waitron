import { describe, expect, it } from "vitest";
import { computeAmendmentHash, verifyAmendmentChain } from "./order-amendment-hash.js";
import type { AmendmentHashInput, VerifiableAmendment } from "./order-amendment-hash.js";

const base: AmendmentHashInput = {
  sequenceNo: 1,
  workingOrderId: "11111111-1111-4111-8111-111111111111",
  kind: "order_placed",
  actorId: "22222222-2222-4222-8222-222222222222",
  reason: null,
  capturedByTillId: "33333333-3333-4333-8333-333333333333",
  capturedByNodeId: "44444444-4444-4444-8444-444444444444",
  eventAt: "2026-08-06T10:00:00.000Z",
  eventOffsetMinutes: 120,
  prevEntryHash: null,
};

describe("computeAmendmentHash", () => {
  it("is a 64-char uppercase-hex SHA-256, stable across calls", () => {
    const h = computeAmendmentHash(base);
    expect(h).toMatch(/^[0-9A-F]{64}$/);
    expect(computeAmendmentHash(base)).toBe(h);
  });

  it("commits the reason, actor and capturing node — changing any changes the hash", () => {
    const h = computeAmendmentHash(base);
    expect(computeAmendmentHash({ ...base, reason: "cancelled by customer" })).not.toBe(h);
    expect(
      computeAmendmentHash({ ...base, actorId: "55555555-5555-4555-8555-555555555555" }),
    ).not.toBe(h);
    expect(
      computeAmendmentHash({ ...base, capturedByNodeId: "66666666-6666-4666-8666-666666666666" }),
    ).not.toBe(h);
    expect(
      computeAmendmentHash({ ...base, capturedByTillId: "77777777-7777-4777-8777-777777777777" }),
    ).not.toBe(h);
  });

  it("commits the sequence, kind, order, offset and predecessor — each changes the hash", () => {
    // The remaining canonical fields, so no field is silently outside the digest (the vocabulary the
    // #52 lesson was about is only part of the content; a chain field left unhashed would be just as
    // rewritable). One assertion per field, none of them the ones above.
    const h = computeAmendmentHash(base);
    expect(computeAmendmentHash({ ...base, sequenceNo: 2 })).not.toBe(h);
    expect(
      computeAmendmentHash({ ...base, workingOrderId: "88888888-8888-4888-8888-888888888888" }),
    ).not.toBe(h);
    expect(computeAmendmentHash({ ...base, kind: "order_cancelled" })).not.toBe(h);
    expect(computeAmendmentHash({ ...base, eventOffsetMinutes: 60 })).not.toBe(h);
    expect(computeAmendmentHash({ ...base, prevEntryHash: "A".repeat(64) })).not.toBe(h);
  });

  it("hashes event_at as the instant, so an offset-only representation change is inert", () => {
    // Same instant, different string form: the hash must not move (the EventAtMs precedent). A null
    // reason is hashed as the empty string, so a null-vs-null pair is genuinely the same content.
    const a = computeAmendmentHash(base);
    const b = computeAmendmentHash({ ...base, eventAt: "2026-08-06T11:00:00.000+01:00" });
    expect(b).toBe(a);
  });
});

describe("the canonical string the amendment hash digests", () => {
  // The two digests below are RECORDED from this implementation on 2026-09-20, not published by
  // anyone. They cannot tell you the format is right; they can only tell you it has changed — which
  // is the property that matters here, because a stored chain is verified by recomputing these
  // digests and an amendment chain that no longer recomputes cannot be repaired.
  //
  // Everything the canonical string is made of is inside them: each field's NAME, the order the
  // fields are written in, the `=` between a name and its value, the `&` between pairs, the empty
  // string a null reason or a genesis predecessor contributes, and the uppercase hex. Before these
  // two assertions existed, every one of those could be changed and the whole suite stayed green —
  // the other tests here compare one hash with another, so they agree with each other whatever the
  // format is.
  //
  // If one of them fails, the format moved. Restoring it is the fix; editing the expected digest is
  // only correct alongside a decision to re-hash every chain that exists.
  it("digests the genesis shape to a recorded value", () => {
    expect(computeAmendmentHash(base)).toBe(
      "C0718201CE76EEBE28FA2EB5AE0D474CEEDB55E496F709F4AB621177CF65D447",
    );
  });

  it("digests a linked entry with a reason to a recorded value", () => {
    // The other half of the pair: a reason and a predecessor that are both present, so the two
    // fallbacks in the canonical string are pinned in both directions.
    expect(
      computeAmendmentHash({
        ...base,
        sequenceNo: 2,
        reason: "cancelled by customer",
        prevEntryHash: "A".repeat(64),
      }),
    ).toBe("C39A5B233D3CD70E6DE4EDF87D54CFE1913DA497A271DB4CDF5374E81A1E9783");
  });
});

describe("verifyAmendmentChain", () => {
  it("accepts a genuine 2-entry chain and rejects content tampering", () => {
    const e1: VerifiableAmendment = {
      ...base,
      isFirstEntry: true,
      entryHash: computeAmendmentHash(base),
    };
    const c2: AmendmentHashInput = {
      ...base,
      sequenceNo: 2,
      kind: "order_cancelled",
      reason: "voided",
      prevEntryHash: e1.entryHash,
    };
    const e2: VerifiableAmendment = {
      ...c2,
      isFirstEntry: false,
      entryHash: computeAmendmentHash(c2),
    };
    expect(verifyAmendmentChain([e1, e2])).toEqual({ ok: true });
    // Tamper entry 1's reason without recomputing → hash_mismatch at seq 1.
    expect(verifyAmendmentChain([{ ...e1, reason: "tampered" }, e2])).toEqual({
      ok: false,
      reason: "hash_mismatch",
      sequenceNo: 1,
    });
    // Read-back row order is irrelevant: verify sorts by sequenceNo first, so [e2, e1] still verifies.
    // This is the tie-break-on-HASHED-sequence lesson (#52): the walk is defined by the hashed
    // sequence_no, never by ingest order — proven by deletion below (deleting the .sort makes THIS
    // case fail).
    expect(verifyAmendmentChain([e2, e1]).ok).toBe(true);
    // A predecessor pointer aimed at the wrong hash — a splice or a reorder attempt — is a broken link.
    expect(verifyAmendmentChain([e1, { ...e2, prevEntryHash: "DEADBEEF" }])).toEqual({
      ok: false,
      reason: "broken_link",
      sequenceNo: 2,
    });
  });

  it("rejects a bare sequence_no reorder (a gap left by a removal or a duplicate)", () => {
    // Renumbering entry 2 to seq 3 without a seq-2 entry leaves a gap the position walk catches. The
    // genesis flag and the link still look locally fine, so `sequence` is the reason that must fire.
    const e1: VerifiableAmendment = {
      ...base,
      isFirstEntry: true,
      entryHash: computeAmendmentHash(base),
    };
    const c2: AmendmentHashInput = { ...base, sequenceNo: 3, prevEntryHash: e1.entryHash };
    const e2: VerifiableAmendment = {
      ...c2,
      isFirstEntry: false,
      entryHash: computeAmendmentHash(c2),
    };
    expect(verifyAmendmentChain([e1, e2])).toEqual({
      ok: false,
      reason: "sequence",
      sequenceNo: 2,
    });
  });

  it("rejects a genesis-flag lie (a non-first entry claiming to be first)", () => {
    // isFirstEntry must agree with position: exactly the first entry is first. A second entry
    // flagged first (and carrying no predecessor to keep the chaining CHECK happy) fails on genesis,
    // before the link or hash checks.
    const e1: VerifiableAmendment = {
      ...base,
      isFirstEntry: true,
      entryHash: computeAmendmentHash(base),
    };
    const c2: AmendmentHashInput = { ...base, sequenceNo: 2, prevEntryHash: null };
    const e2: VerifiableAmendment = {
      ...c2,
      isFirstEntry: true,
      entryHash: computeAmendmentHash(c2),
    };
    expect(verifyAmendmentChain([e1, e2])).toEqual({ ok: false, reason: "genesis", sequenceNo: 2 });
  });

  it("accepts the empty chain and a lone genesis entry", () => {
    expect(verifyAmendmentChain([])).toEqual({ ok: true });
    const only: VerifiableAmendment = {
      ...base,
      isFirstEntry: true,
      entryHash: computeAmendmentHash(base),
    };
    expect(verifyAmendmentChain([only])).toEqual({ ok: true });
  });
});

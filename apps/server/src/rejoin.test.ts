import { describe, expect, it, vi } from "vitest";
import { AppError, isAppError } from "@waitron/shared";
import { captureError } from "@waitron/db";
import type { MembershipNode, NodeStanding, SignedMembershipDocument } from "@waitron/membership";
import type { DrainProgress } from "@waitron/sync";
import type { ValidatedArtifact } from "./restore.js";
import { rejoinAsSecondary, type RejoinDeps } from "./rejoin.js";

const noopLog: RejoinDeps["log"] = () => {};

const NODE_ID = "node-self-1";
const CARRIER_ID = "carrier-1";

const drained: DrainProgress = { drained: true, ownTailSeq: 5n, carrierAppliedSeq: 5n };

// A fake validated artifact. rejoinAsSecondary threads this opaque value from `validate` to `write`
// without inspecting it, so a bare cast is sufficient for the orchestration tests (the real gate/guard
// that produces one is exercised in restore.test.ts).
const VALIDATED = {} as ValidatedArtifact;

// A held chart naming this node with `selfStanding`, plus (optionally) a serving-primary carrier.
// rejoin reads only node standings; the held signature is never verified here (a placeholder is fine).
function heldDoc(
  nodeId: string,
  selfStanding: NodeStanding,
  {
    carrier = true,
    term = 3,
    carrierId = CARRIER_ID,
  }: { carrier?: boolean; term?: number; carrierId?: string } = {},
): SignedMembershipDocument {
  const nodes: MembershipNode[] = [{ nodeId, contactUrl: "", standing: selfStanding }];
  if (carrier) {
    nodes.push({ nodeId: carrierId, contactUrl: "https://carrier", standing: "serving-primary" });
  }
  return {
    body: { term, nodes },
    signerNodeId: carrier ? carrierId : nodeId,
    signature: "held-placeholder-sig",
    endorsements: [],
  };
}

// The held document is now THREADED IN (read once by the CLI), not read from a db inside
// `rejoinAsSecondary` — so these tests need no PGlite/Postgres at all (CLAUDE.md §4: pick the lighter
// target when the heavier one's justification does not apply). Every seam — `readDrainProgress`,
// `closePreWipe`, `wipeDatabase`, `validate`, `write` — is injected.
function makeDeps(
  held: SignedMembershipDocument | null,
  over: Partial<RejoinDeps> = {},
): RejoinDeps {
  return {
    held,
    nodeId: NODE_ID,
    readDrainProgress: vi.fn(async () => drained),
    closePreWipe: vi.fn(async () => {}),
    wipeDatabase: vi.fn(async () => {}),
    validate: vi.fn(async () => VALIDATED),
    write: vi.fn(async () => {}),
    log: noopLog,
    ...over,
  };
}

describe("rejoinAsSecondary", () => {
  it("refuses when the node is not fenced (serving), and touches nothing irreversible", async () => {
    const d = makeDeps(heldDoc(NODE_ID, "serving-secondary"));

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_fenced");
    expect(d.validate).not.toHaveBeenCalled();
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
  });

  it("refuses when no held chart exists (absent node is not fenced)", async () => {
    const d = makeDeps(null); // no held document

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_fenced");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("refuses when the held chart names no carrier (undefined drain reader)", async () => {
    // `undefined` readDrainProgress is how the caller signals "held document names no carrier".
    const d = makeDeps(heldDoc(NODE_ID, "sell-only", { carrier: false }), {
      readDrainProgress: undefined,
    });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.no_carrier");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("refuses with rejoin.no_carrier when a carrier IS present but the drain reader is undefined", async () => {
    // Boundary hardening: the no_carrier guard is `carrier === undefined || readDrainProgress ===
    // undefined`. The test above pins the first leg (no carrier in the chart). This pins the SECOND leg
    // independently — the held chart DOES name a serving-primary, but the caller passed no drain reader,
    // which must still be refused fail-safe as no_carrier (mirrors retire.test.ts's analogous boundary
    // test). Without this, a regression dropping the reader half of the OR would pass at 100% coverage.
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), { readDrainProgress: undefined });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.no_carrier");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("refuses when the tail has not fully drained onto the carrier", async () => {
    const undrained: DrainProgress = { drained: false, ownTailSeq: 9n, carrierAppliedSeq: 4n };
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), {
      readDrainProgress: vi.fn(async () => undrained),
    });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_drained");
    expect(d.validate).not.toHaveBeenCalled();
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("validates the artifact BEFORE the wipe: a bad artifact refuses with nothing wiped", async () => {
    // Gap #1: `validate` runs BEFORE `closePreWipe`/`wipeDatabase`, so a wrong recovery key (or a
    // rejected manifest/entry) throws with the database still intact. Proven by deletion: move the
    // pre-wipe `await deps.validate()` to AFTER the wipe in rejoin.ts and `wipeDatabase` is called
    // before this throw, failing the `not.toHaveBeenCalled()` assertions below.
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), {
      validate: vi.fn(async () => {
        throw new AppError("recovery.passphrase_invalid", {});
      }),
    });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("recovery.passphrase_invalid");
    expect(d.validate).toHaveBeenCalledOnce();
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
  });

  it("orders the destructive phase validate → close → wipe → write (returns the carrier)", async () => {
    const calls: string[] = [];
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), {
      validate: vi.fn(async () => {
        calls.push("validate");
        return VALIDATED;
      }),
      closePreWipe: vi.fn(async () => {
        calls.push("close");
      }),
      wipeDatabase: vi.fn(async () => {
        calls.push("wipe");
      }),
      write: vi.fn(async (v) => {
        expect(v).toBe(VALIDATED); // the same validated pieces are threaded across the wipe
        calls.push("write");
      }),
    });

    await expect(rejoinAsSecondary(d)).resolves.toEqual({
      restored: true,
      carrierNodeId: CARRIER_ID,
    });
    // never wipe before validating and closing our own conns; never write before the wipe.
    expect(calls).toEqual(["validate", "close", "wipe", "write"]);
  });

  it("drives the guard ladder off the threaded `held` document (read-once), not a db read", async () => {
    // Gap #4: the held document is passed in, and the standing guard reads THAT — a `serving-primary`
    // self standing in the threaded chart refuses `not_fenced` with no db access whatsoever.
    const d = makeDeps(heldDoc(NODE_ID, "serving-primary"));
    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_fenced");

    // And a fenced self standing in the SAME threaded document passes the ladder through to the wipe.
    const ok = makeDeps(heldDoc(NODE_ID, "sell-only"));
    await expect(rejoinAsSecondary(ok)).resolves.toEqual({
      restored: true,
      carrierNodeId: CARRIER_ID,
    });
    expect(ok.wipeDatabase).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import { captureError } from "@waitron/db";
import type { MembershipNode, NodeStanding, SignedMembershipDocument } from "@waitron/membership";
import { rejoinAsSecondary, type RejoinDeps } from "./rejoin.js";

const noopLog: RejoinDeps["log"] = () => {};

const NODE_ID = "node-self-1";
const CARRIER_ID = "carrier-1";

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

// The held document is THREADED IN (read once by the CLI), so these tests need no PGlite/Postgres at
// all (CLAUDE.md §4). Both seams — `closePreWipe` and `wipeDatabase` — are injected. `wipeDatabase` is
// the whole wipe (drop + recreate + re-migrate + clear trading.env); there is no artifact
// validate/write phase (Ruling I3).
function makeDeps(
  held: SignedMembershipDocument | null,
  over: Partial<RejoinDeps> = {},
): RejoinDeps {
  return {
    held,
    nodeId: NODE_ID,
    acceptLoss: false,
    closePreWipe: vi.fn(async () => {}),
    wipeDatabase: vi.fn(async () => {}),
    log: noopLog,
    ...over,
  };
}

describe("rejoinAsSecondary", () => {
  it("refuses when the node is not fenced (serving), and touches nothing irreversible", async () => {
    const d = makeDeps(heldDoc(NODE_ID, "serving-secondary"));

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_fenced");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("refuses when no held chart exists (absent node is not fenced)", async () => {
    const d = makeDeps(null); // no held document

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_fenced");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("refuses when the held chart names no serving primary", async () => {
    const d = makeDeps(heldDoc(NODE_ID, "sell-only", { carrier: false }));

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.no_carrier");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("orders close → wipe and returns the carrier on the happy path", async () => {
    const calls: string[] = [];
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), {
      closePreWipe: vi.fn(async () => {
        calls.push("close");
      }),
      wipeDatabase: vi.fn(async () => {
        calls.push("wipe");
      }),
    });

    await expect(rejoinAsSecondary(d)).resolves.toEqual({ wiped: true, carrierNodeId: CARRIER_ID });
    // never wipe before closing our own connections (the FORCE drop would terminate them).
    expect(calls).toEqual(["close", "wipe"]);
  });

  it("--accept-loss proceeds to the wipe on a FENCED box with a carrier", async () => {
    // The operator's acknowledgement path. It waives no guard today (the drain confirmation it used to
    // waive is gone), so what this pins is that it does not BLOCK a rejoin either: close, then wipe,
    // then return the carrier.
    const calls: string[] = [];
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), {
      acceptLoss: true,
      closePreWipe: vi.fn(async () => {
        calls.push("close");
      }),
      wipeDatabase: vi.fn(async () => {
        calls.push("wipe");
      }),
    });

    await expect(rejoinAsSecondary(d)).resolves.toEqual({ wiped: true, carrierNodeId: CARRIER_ID });
    expect(calls).toEqual(["close", "wipe"]);
  });

  it("--accept-loss still REFUSES an unfenced serving-primary (never wipes a live primary)", async () => {
    // The irreversible-wipe guard `--accept-loss` must NOT waive (CLAUDE.md §5): a live serving primary
    // could hold un-shipped fiscal rows. Proven by contrast with the fenced accept-loss test above.
    const d = makeDeps(heldDoc(NODE_ID, "serving-primary"), { acceptLoss: true });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_fenced");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("--accept-loss still REFUSES a fenced box whose chart names no carrier (rejoin.no_carrier)", async () => {
    // The `no_carrier` guard `--accept-loss` must NOT waive: a box with no survivor to re-adopt from can
    // never legitimately rejoin, and (per the header) can't have reached the cloud to be fenced anyway.
    const d = makeDeps(heldDoc(NODE_ID, "sell-only", { carrier: false }), { acceptLoss: true });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.no_carrier");
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("drives the guard ladder off the threaded `held` document (read-once), not a db read", async () => {
    const d = makeDeps(heldDoc(NODE_ID, "serving-primary"));
    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_fenced");

    const ok = makeDeps(heldDoc(NODE_ID, "sell-only"));
    await expect(rejoinAsSecondary(ok)).resolves.toEqual({
      wiped: true,
      carrierNodeId: CARRIER_ID,
    });
    expect(ok.wipeDatabase).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from "vitest";
import { isAppError } from "@waitron/shared";
import { captureError } from "@waitron/db";
import type { MembershipNode, NodeStanding, SignedMembershipDocument } from "@waitron/membership";
import type { SlotDrain } from "@waitron/sync";
import { rejoinAsSecondary, type RejoinDeps } from "./rejoin.js";

const noopLog: RejoinDeps["log"] = () => {};

const NODE_ID = "node-self-1";
const CARRIER_ID = "carrier-1";

// The fence LSN this node recorded when it fenced, and the SlotDrain fixtures the carrier's slot on
// this node reports. Drained = the slot is INACTIVE (carrier detached, `!active`) AND its
// confirmed_flush has passed the fence LSN (Ruling C2).
const FENCE_LSN = "0/1500000";
const drained: SlotDrain = {
  exists: true,
  active: false,
  walStatus: "reserved",
  confirmedFlushLsn: "0/1500000",
  currentWalLsn: "0/1600000",
  retainedBytes: 0n,
};
const carrierAttached: SlotDrain = { ...drained, active: true };
const notFlushed: SlotDrain = { ...drained, confirmedFlushLsn: "0/1400000", retainedBytes: 4096n };

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

// The held document is THREADED IN (read once by the CLI), and the drain is read off the native slot,
// so these tests need no PGlite/Postgres at all (CLAUDE.md §4). Every seam — `readSlotDrain`,
// `closePreWipe`, `wipeDatabase` — is injected. `wipeDatabase` is the whole wipe now (drop + recreate
// + re-migrate + clear trading.env); there is no artifact validate/write phase (Ruling I3).
function makeDeps(
  held: SignedMembershipDocument | null,
  over: Partial<RejoinDeps> = {},
): RejoinDeps {
  return {
    held,
    nodeId: NODE_ID,
    readSlotDrain: vi.fn(async () => drained),
    fenceLsn: FENCE_LSN,
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

  it("refuses when the held chart names no carrier (undefined slot reader)", async () => {
    const d = makeDeps(heldDoc(NODE_ID, "sell-only", { carrier: false }), {
      readSlotDrain: undefined,
    });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.no_carrier");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("refuses with rejoin.no_carrier when a carrier IS present but the slot reader is undefined", async () => {
    // Boundary hardening: the no_carrier guard is `carrier === undefined || readSlotDrain ===
    // undefined`. This pins the SECOND leg independently — the chart names a serving-primary but no
    // reader was passed, refused fail-safe (mirrors retire.test.ts's analogous boundary test).
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), { readSlotDrain: undefined });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.no_carrier");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("refuses when the carrier slot is still active (rejoin.carrier_attached) — nothing wiped", async () => {
    // The `!active` half (Ruling C2 / spec §4.2 step 4). Proven by deletion: drop the `d.active` guard
    // and this box wipes while the carrier is still applying.
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), {
      readSlotDrain: vi.fn(async () => carrierAttached),
    });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.carrier_attached");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("refuses when confirmed_flush has not passed the fence LSN (rejoin.not_drained) — nothing wiped", async () => {
    // The IRREVERSIBLE-wipe guard: the slot is detached but its tail is not fully applied. Proven by
    // deletion: drop the `isDrained` guard and this box wipes an un-shipped tail (CLAUDE.md §5).
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), {
      readSlotDrain: vi.fn(async () => notFlushed),
    });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_drained");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("refuses a dead/never-fenced box (fenceLsn null) with rejoin.not_drained unless --accept-loss", async () => {
    // A null fence LSN cannot be compared — without the operator's explicit override it refuses the
    // irreversible wipe rather than guess the tail is drained.
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), { fenceLsn: null });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_drained");
    expect(d.wipeDatabase).not.toHaveBeenCalled();
  });

  it("orders close → wipe and returns the carrier on the drained happy path", async () => {
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

  it("--accept-loss waives the drain confirmation on a FENCED box and proceeds to the wipe", async () => {
    // The dead-box path (spec §4.2 step 2): a fenced box that cannot prove its drain (fence LSN unset,
    // and the slot would refuse `not_drained`) is wiped anyway — the operator accepts the loss. The drain
    // guards are waived (the slot reader is never consulted), but the box is fenced with a carrier, so the
    // wipe proceeds. Still closes our own connections before the FORCE drop, and returns the carrier.
    const calls: string[] = [];
    const d = makeDeps(heldDoc(NODE_ID, "sell-only"), {
      acceptLoss: true,
      fenceLsn: null,
      readSlotDrain: vi.fn(async () => {
        throw new Error("the slot reader must not be consulted on the accept-loss path");
      }),
      closePreWipe: vi.fn(async () => {
        calls.push("close");
      }),
      wipeDatabase: vi.fn(async () => {
        calls.push("wipe");
      }),
    });

    await expect(rejoinAsSecondary(d)).resolves.toEqual({ wiped: true, carrierNodeId: CARRIER_ID });
    expect(calls).toEqual(["close", "wipe"]);
    expect(d.readSlotDrain).not.toHaveBeenCalled();
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
    const d = makeDeps(heldDoc(NODE_ID, "sell-only", { carrier: false }), {
      acceptLoss: true,
      readSlotDrain: undefined,
    });

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

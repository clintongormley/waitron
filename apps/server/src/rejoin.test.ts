import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { isAppError, locationId as brandLocationId } from "@waitron/shared";
import {
  captureError,
  CORE_MIGRATIONS,
  createPgliteDb,
  runMigrations,
  stampDeployment,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import type { MembershipNode, NodeStanding, SignedMembershipDocument } from "@waitron/membership";
import type { DrainProgress } from "@waitron/sync";
import { rejoinAsSecondary, type RejoinDeps } from "./rejoin.js";

const noopLog: RejoinDeps["log"] = () => {};

const CARRIER_ID = "carrier-1";

const drained: DrainProgress = { drained: true, ownTailSeq: 5n, carrierAppliedSeq: 5n };

// A held chart at `term` naming this node with `selfStanding`, plus (optionally) a serving-primary
// carrier. rejoin reads only node standings; the held signature is never verified here, so a
// placeholder signature is fine (retire.test.ts's fixtures use the same shape).
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

// PGlite is sufficient for the rejoin ORCHESTRATION logic (the standing/carrier/drain guards and the
// close→wipe→restore composition): none has an RLS / privilege / concurrency dependency, and the
// held-membership read succeeds as the PGlite superuser (CLAUDE.md §4 — pick the lighter target when
// the heavier one's justification does not apply). `readDrainProgress`, `closePreWipe`,
// `wipeDatabase` and `restore` are all injected, so the real sync/maintenance-conn/restore paths (the
// only privilege-sensitive parts) are never exercised here — they are Task 4 (the CLI)'s concern.
async function setup(): Promise<{
  db: Database;
  nodeId: string;
  deps: (over?: Partial<RejoinDeps>) => RejoinDeps;
}> {
  const db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await stampDeployment(db, "preproduction");
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(loc.rows[0]!.id));
  return {
    db,
    nodeId,
    deps: (over = {}) => ({
      appDb: db,
      nodeId,
      readDrainProgress: vi.fn(async () => drained),
      closePreWipe: vi.fn(async () => {}),
      wipeDatabase: vi.fn(async () => {}),
      restore: vi.fn(async () => {}),
      log: noopLog,
      ...over,
    }),
  };
}

describe("rejoinAsSecondary", () => {
  it("refuses when the node is not fenced (serving), and closes/wipes nothing", async () => {
    const { db, nodeId, deps } = await setup();
    await writeNodeMembership(db, heldDoc(nodeId, "serving-secondary"));
    const d = deps();

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_fenced");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
    await db.close();
  });

  it("refuses when no held chart exists (absent node is not fenced)", async () => {
    const { db, deps } = await setup(); // no writeNodeMembership seed → readNodeMembership null
    const d = deps();

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_fenced");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
    await db.close();
  });

  it("refuses when the held chart names no carrier (undefined drain reader)", async () => {
    const { db, nodeId, deps } = await setup();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only", { carrier: false }));
    // `undefined` readDrainProgress is how the caller signals "held document names no carrier".
    const d = deps({ readDrainProgress: undefined });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.no_carrier");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
    await db.close();
  });

  it("refuses when the tail has not fully drained onto the carrier", async () => {
    const { db, nodeId, deps } = await setup();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only"));
    const undrained: DrainProgress = { drained: false, ownTailSeq: 9n, carrierAppliedSeq: 4n };
    const d = deps({ readDrainProgress: vi.fn(async () => undrained) });

    const err = await captureError(() => rejoinAsSecondary(d));
    expect(isAppError(err) && err.code).toBe("rejoin.not_drained");
    expect(d.closePreWipe).not.toHaveBeenCalled();
    expect(d.wipeDatabase).not.toHaveBeenCalled();
    await db.close();
  });

  it("closes pre-wipe pools, then wipes, then restores, in that order (returns the carrier)", async () => {
    const { db, nodeId, deps } = await setup();
    await writeNodeMembership(db, heldDoc(nodeId, "sell-only"));
    const calls: string[] = [];
    const d = deps({
      closePreWipe: vi.fn(async () => {
        calls.push("close");
      }),
      wipeDatabase: vi.fn(async () => {
        calls.push("wipe");
      }),
      restore: vi.fn(async () => {
        calls.push("restore");
      }),
    });

    await expect(rejoinAsSecondary(d)).resolves.toEqual({
      restored: true,
      carrierNodeId: CARRIER_ID,
    });
    // never wipe before closing our own conns, never restore before wipe.
    expect(calls).toEqual(["close", "wipe", "restore"]);
    await db.close();
  });
});

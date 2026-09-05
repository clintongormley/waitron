import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { CORE_ENROLMENT } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { readDrainProgress } from "./disposal.js";
import { tablesForLane, type EnrolledTable } from "@waitron/sync-enrolment";

// Real Postgres, not PGlite (CLAUDE.md §4 — say WHY the heavier target when its usual justification
// doesn't apply): this suite exercises no RLS, privilege, or concurrency — only the drain arithmetic —
// so it seeds and reads as the OWNER (superuser `postgres.admin`), which needs no tenant policy. Real
// PG is used purely to match this package's harness convention: every `@waitron/sync` gate suite runs on
// `useTemplateDb` and there is no PGlite harness wired here. The production path `readDrainProgress`
// takes — a `sync_tailer` member under `withTenant` with `sync_log_tenant_isolation` scoping the
// own-origin max — is proven separately by `apps/server/src/boot.fence.test.ts` Case E, not here.
const postgres = useTemplateDb({ template: "manifest" });

const SELF = "11111111-1111-4111-8111-111111111111"; // the returned/fenced node's own origin
const CARRIER = "carrier-node"; // the current serving-primary (subscriber_id is text)
const TENANT = "22222222-2222-4222-8222-222222222222";
// A minimal injected enrolment set (SP-2a inversion): the disposal guard reads each lane's tables from
// the composition root's set via `tablesForLane`, so this suite supplies one real ordered- and one real
// fast-lane table. `readDrainProgress` only needs their names + lanes (sync_log.table_name is text, not
// an FK), so the other EnrolledTable fields are representative.
const ENROLMENTS: readonly EnrolledTable[] = [
  {
    table: "products",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 2,
    lane: "ordered",
    columns: ["id", "updated_at"],
  },
  {
    table: "payments",
    mode: "watermark-upsert",
    conflictKey: ["id"],
    watermarkColumn: "updated_at",
    captureOps: ["insert", "update"],
    fkRank: 3,
    lane: "fast",
    columns: ["id", "updated_at"],
  },
];
const ORDERED_TABLE = tablesForLane(ENROLMENTS, "ordered")[0]; // a real ordered-lane table (products)
const FAST_TABLE = tablesForLane(ENROLMENTS, "fast")[0]; // a real fast-lane table (payments)

// Each test seeds a fresh slice of sync_log/sync_cursor and clears it after, so the shared container
// stays order-independent (CLAUDE.md §4 — clean up in a finally / afterEach).
afterEach(async () => {
  await postgres.admin.execute(sql`delete from sync_log where origin_id = ${SELF}::uuid`);
  await postgres.admin.execute(sql`delete from sync_cursor where origin_id = ${SELF}::uuid`);
});

async function seedOwnRow(seq: number, table: string): Promise<void> {
  await postgres.admin.execute(
    sql`insert into sync_log (seq, origin_id, table_name, op, tenant_id, row_image)
        overriding system value
        values (${seq}, ${SELF}::uuid, ${table}, 'insert', ${TENANT}::uuid, '{}'::jsonb)`,
  );
}
async function seedCarrierCursor(lane: string, seq: number): Promise<void> {
  await postgres.admin.execute(
    sql`insert into sync_cursor (subscriber_id, origin_id, lane, last_applied_seq, alive)
        values (${CARRIER}, ${SELF}::uuid, ${lane}, ${seq}, true)`,
  );
}

describe("readDrainProgress", () => {
  it("is drained with a null tail when this node has produced no own-origin rows", async () => {
    const p = await readDrainProgress(postgres.admin, {
      selfNodeId: SELF,
      carrierNodeId: CARRIER,
      enrolments: ENROLMENTS,
    });
    expect(p).toEqual({ drained: true, ownTailSeq: null, carrierAppliedSeq: null });
  });

  it("is NOT drained when the carrier has never reported a cursor for a lane that has own rows", async () => {
    await seedOwnRow(100, ORDERED_TABLE);
    const p = await readDrainProgress(postgres.admin, {
      selfNodeId: SELF,
      carrierNodeId: CARRIER,
      enrolments: ENROLMENTS,
    });
    expect(p.drained).toBe(false);
    expect(p.ownTailSeq).toBe(100n);
    expect(p.carrierAppliedSeq).toBe(0n); // no cursor row → treated as applied-nothing
  });

  it("is NOT drained when the carrier's cursor lags this node's own tail on a lane", async () => {
    await seedOwnRow(100, ORDERED_TABLE);
    await seedCarrierCursor("ordered", 50);
    const p = await readDrainProgress(postgres.admin, {
      selfNodeId: SELF,
      carrierNodeId: CARRIER,
      enrolments: ENROLMENTS,
    });
    expect(p.drained).toBe(false);
    expect(p.ownTailSeq).toBe(100n);
  });

  it("is drained when the carrier has caught up to the own tail on every lane", async () => {
    await seedOwnRow(50, ORDERED_TABLE);
    await seedOwnRow(120, FAST_TABLE);
    await seedCarrierCursor("ordered", 50);
    await seedCarrierCursor("fast", 120);
    const p = await readDrainProgress(postgres.admin, {
      selfNodeId: SELF,
      carrierNodeId: CARRIER,
      enrolments: ENROLMENTS,
    });
    expect(p.drained).toBe(true);
    expect(p.ownTailSeq).toBe(120n);
    expect(p.carrierAppliedSeq).toBe(50n); // the binding (min) constraint across own-carrying lanes
  });

  it("reports the GLOBAL own-tail max even when the earlier lane carries the higher seq", async () => {
    // ordered is iterated first and carries the higher seq (200) here; fast (50) comes second and must
    // NOT lower ownTailSeq. Pins that ownTailSeq is the max ACROSS lanes, independent of iteration
    // order, and that carrierAppliedSeq is the MIN of the caught-up cursors.
    await seedOwnRow(200, ORDERED_TABLE);
    await seedOwnRow(50, FAST_TABLE);
    await seedCarrierCursor("ordered", 200);
    await seedCarrierCursor("fast", 50);
    const p = await readDrainProgress(postgres.admin, {
      selfNodeId: SELF,
      carrierNodeId: CARRIER,
      enrolments: ENROLMENTS,
    });
    expect(p.drained).toBe(true);
    expect(p.ownTailSeq).toBe(200n); // from the earlier lane, not the last-iterated one
    expect(p.carrierAppliedSeq).toBe(50n); // min across own-carrying lanes
  });

  it("does not throw when a lane is omitted entirely from the enrolment set (empty table list → `and false`)", async () => {
    // SP-2b's enabled-set filtering can hand `readDrainProgress` a partial enrolment set that omits a
    // whole lane. CORE_ENROLMENT is real and entirely ordered-lane, so `tablesForLane(_, "fast")` is
    // `[]` here. Without the empty-lane guard the fast lane's subquery emits an invalid `in ()` and
    // Postgres throws a syntax error; with it, the fast lane is treated as no-own-rows and drops
    // through the `continue`. Seed one ordered-lane own row that is drained, and assert the call
    // completes with a sensible DrainProgress rather than throwing.
    const orderedTable = tablesForLane(CORE_ENROLMENT, "ordered")[0];
    expect(tablesForLane(CORE_ENROLMENT, "fast")).toEqual([]); // the fast lane is genuinely empty
    await seedOwnRow(70, orderedTable);
    await seedCarrierCursor("ordered", 70);
    const p = await readDrainProgress(postgres.admin, {
      selfNodeId: SELF,
      carrierNodeId: CARRIER,
      enrolments: CORE_ENROLMENT,
    });
    expect(p).toEqual({ drained: true, ownTailSeq: 70n, carrierAppliedSeq: 70n });
  });

  it("is NOT drained when only ONE of two own-carrying lanes has caught up", async () => {
    await seedOwnRow(50, ORDERED_TABLE); // ordered drained
    await seedOwnRow(120, FAST_TABLE); // fast behind
    await seedCarrierCursor("ordered", 50);
    await seedCarrierCursor("fast", 90);
    const p = await readDrainProgress(postgres.admin, {
      selfNodeId: SELF,
      carrierNodeId: CARRIER,
      enrolments: ENROLMENTS,
    });
    expect(p.drained).toBe(false); // the fast lane is not drained even though ordered is
  });
});

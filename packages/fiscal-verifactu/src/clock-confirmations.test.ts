import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  checkFailed,
  isRefusal,
  newId,
  refusalOn,
  triggerRaised,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { clockChecks } from "./schema/clock-checks.js";
import { clockConfirmations } from "./schema/clock-confirmations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const PERSON = "33333333-3333-4333-8333-333333333333";

type CheckRow = typeof clockChecks.$inferInsert;
type ConfirmationRow = typeof clockConfirmations.$inferInsert;

function insertCheck(nodeId: string, seq: number, overrides: Partial<CheckRow> = {}) {
  return withTransaction(suite.db, (tx) =>
    tx
      .insert(clockChecks)
      .values({
        seq,
        nodeId,
        openedAt: new Date("2026-07-21T09:58:00.000Z"),
        reason: "behind_chain",
        detail: { clockAt: "2026-07-21T09:58:00.000Z", heads: {} },
        ...overrides,
      })
      .returning({ id: clockChecks.id }),
  ).then((rows) => rows[0]!.id);
}

function insertConfirmation(nodeId: string, seq: number, overrides: Partial<ConfirmationRow> = {}) {
  return withTransaction(suite.db, (tx) =>
    tx
      .insert(clockConfirmations)
      .values({
        seq,
        nodeId,
        boxClockAt: new Date("2026-07-21T10:00:00.000Z"),
        confirmedAt: new Date("2026-07-21T10:00:00.000Z"),
        stepMs: 0,
        source: "authority",
        personId: null,
        reason: "behind_chain",
        proof: { authority: { agrees: true } },
        checkId: null,
        registroId: null,
        recordAt: null,
        ...overrides,
      })
      .returning({ id: clockConfirmations.id }),
  ).then((rows) => rows[0]!.id);
}

async function countOf(tableName: "clock_checks" | "clock_confirmations") {
  const { rows } = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(tableName)}`,
  );
  return Number(rows[0]!.n);
}

describe("clock_checks", () => {
  it("keeps a full row for every declared reason", async () => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    const reasons = ["start", "change", "behind_chain", "disagrees"] as const;
    for (const [index, reason] of reasons.entries()) {
      await insertCheck(nodeId, index + 1, { reason });
    }
    const { rows } = await suite.db.execute<{ seq: number; reason: string; detail: string }>(
      sql`select seq, reason, detail from clock_checks order by seq`,
    );
    expect(rows.map((row) => [Number(row.seq), row.reason])).toEqual([
      [1, "start"],
      [2, "change"],
      [3, "behind_chain"],
      [4, "disagrees"],
    ]);
    expect(JSON.parse(rows[0]!.detail)).toEqual({ clockAt: "2026-07-21T09:58:00.000Z", heads: {} });
  });

  it("refuses an update and a delete", async () => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    await insertCheck(nodeId, 1);
    const update = await captureError(async () =>
      suite.db.execute(sql`update clock_checks set reason = 'start'`),
    );
    expect(triggerRaised(update, "clock_checks is append-only")).toBe(true);
    const remove = await captureError(async () => suite.db.execute(sql`delete from clock_checks`));
    expect(triggerRaised(remove, "clock_checks is append-only")).toBe(true);
    const { rows } = await suite.db.execute<{ reason: string }>(
      sql`select reason from clock_checks`,
    );
    expect(rows).toEqual([{ reason: "behind_chain" }]);
  });

  it("refuses an undeclared reason", async () => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    const error = await captureError(() =>
      insertCheck(nodeId, 1, { reason: "later" as CheckRow["reason"] }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(checkFailed(error, "clock_checks_reason_ck")).toBe(true);
    expect(await countOf("clock_checks")).toBe(0);
    await insertCheck(nodeId, 1);
    expect(await countOf("clock_checks")).toBe(1);
  });

  it("refuses a second row with the same seq", async () => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    await insertCheck(nodeId, 1);
    const error = await captureError(() => insertCheck(nodeId, 1));
    expect(refusalOn(error, UNIQUE_VIOLATION, { table: "clock_checks", columns: ["seq"] })).toBe(
      true,
    );
    expect(await countOf("clock_checks")).toBe(1);
    await insertCheck(nodeId, 2);
    expect(await countOf("clock_checks")).toBe(2);
  });

  it("refuses a row naming no node", async () => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    const error = await captureError(() => insertCheck(newId(), 1));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(await countOf("clock_checks")).toBe(0);
    await insertCheck(nodeId, 1);
    expect(await countOf("clock_checks")).toBe(1);
  });
});

describe("clock_confirmations", () => {
  it("keeps a full row for every declared source and reason", async () => {
    const { nodeId, registroIds } = await seedPendingEnvios(suite.db, { count: 1 });
    const checkId = await insertCheck(nodeId, 1);
    await insertConfirmation(nodeId, 1, {
      source: "admin",
      personId: PERSON,
      checkId,
      registroId: registroIds[0]!,
      recordAt: new Date("2026-07-21T10:30:00.000Z"),
      stepMs: 1500,
    });
    await insertConfirmation(nodeId, 2, { source: "authority" });
    await insertConfirmation(nodeId, 3, { source: "devices" });
    await insertConfirmation(nodeId, 4, { source: "elapsed" });
    for (const [index, reason] of (
      ["start", "change", "disagrees", "unusable"] as const
    ).entries()) {
      await insertConfirmation(nodeId, 5 + index, { reason });
    }
    const { rows } = await suite.db.execute<{
      seq: number;
      source: string;
      reason: string;
      person_id: string | null;
      check_id: string | null;
      registro_id: string | null;
      record_at: string | null;
      step_ms: number;
    }>(
      sql`select seq, source, reason, person_id, check_id, registro_id, record_at, step_ms
          from clock_confirmations order by seq`,
    );
    expect(rows.map((row) => [Number(row.seq), row.source, row.reason])).toEqual([
      [1, "admin", "behind_chain"],
      [2, "authority", "behind_chain"],
      [3, "devices", "behind_chain"],
      [4, "elapsed", "behind_chain"],
      [5, "authority", "start"],
      [6, "authority", "change"],
      [7, "authority", "disagrees"],
      [8, "authority", "unusable"],
    ]);
    expect(rows[0]).toMatchObject({
      person_id: PERSON,
      check_id: checkId,
      registro_id: registroIds[0],
      record_at: "2026-07-21T10:30:00.000Z",
    });
    expect(Number(rows[0]!.step_ms)).toBe(1500);
  });

  it("refuses an update and a delete", async () => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    await insertConfirmation(nodeId, 1);
    const update = await captureError(async () =>
      suite.db.execute(sql`update clock_confirmations set step_ms = 5`),
    );
    expect(triggerRaised(update, "clock_confirmations is append-only")).toBe(true);
    const remove = await captureError(async () =>
      suite.db.execute(sql`delete from clock_confirmations`),
    );
    expect(triggerRaised(remove, "clock_confirmations is append-only")).toBe(true);
    const { rows } = await suite.db.execute<{ step_ms: number }>(
      sql`select step_ms from clock_confirmations`,
    );
    expect(rows.map((row) => Number(row.step_ms))).toEqual([0]);
  });

  it.each([
    {
      name: "an administrator's confirmation naming no person",
      overrides: { source: "admin", personId: null } as Partial<ConfirmationRow>,
      check: "clock_confirmations_person_ck",
    },
    {
      name: "a devices confirmation naming a person",
      overrides: { source: "devices", personId: PERSON } as Partial<ConfirmationRow>,
      check: "clock_confirmations_person_ck",
    },
    {
      name: "an undeclared source",
      overrides: { source: "clock" as ConfirmationRow["source"] },
      check: "clock_confirmations_source_ck",
    },
    {
      name: "an undeclared reason",
      overrides: { reason: "later" as ConfirmationRow["reason"] },
      check: "clock_confirmations_reason_ck",
    },
    {
      name: "a record_at without its record",
      overrides: { recordAt: new Date("2026-07-21T10:30:00.000Z") },
      check: "clock_confirmations_record_ck",
    },
  ])("refuses $name", async ({ overrides, check }) => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    const error = await captureError(() => insertConfirmation(nodeId, 1, overrides));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(checkFailed(error, check)).toBe(true);
    expect(await countOf("clock_confirmations")).toBe(0);
    await insertConfirmation(nodeId, 1);
    expect(await countOf("clock_confirmations")).toBe(1);
  });

  it("refuses a record without its record_at", async () => {
    const { nodeId, registroIds } = await seedPendingEnvios(suite.db, { count: 1 });
    const error = await captureError(() =>
      insertConfirmation(nodeId, 1, { registroId: registroIds[0]! }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(checkFailed(error, "clock_confirmations_record_ck")).toBe(true);
    expect(await countOf("clock_confirmations")).toBe(0);
    await insertConfirmation(nodeId, 1, {
      registroId: registroIds[0]!,
      recordAt: new Date("2026-07-21T10:30:00.000Z"),
    });
    expect(await countOf("clock_confirmations")).toBe(1);
  });

  it("refuses a second row with the same seq", async () => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    await insertConfirmation(nodeId, 1);
    const error = await captureError(() => insertConfirmation(nodeId, 1));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "clock_confirmations", columns: ["seq"] }),
    ).toBe(true);
    expect(await countOf("clock_confirmations")).toBe(1);
    await insertConfirmation(nodeId, 2);
    expect(await countOf("clock_confirmations")).toBe(2);
  });

  it("refuses a second closing of the same check", async () => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    const checkId = await insertCheck(nodeId, 1);
    const otherCheckId = await insertCheck(nodeId, 2);
    await insertConfirmation(nodeId, 1, { checkId });
    const error = await captureError(() => insertConfirmation(nodeId, 2, { checkId }));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "clock_confirmations", columns: ["check_id"] }),
    ).toBe(true);
    expect(await countOf("clock_confirmations")).toBe(1);
    await insertConfirmation(nodeId, 2, { checkId: otherCheckId });
    expect(await countOf("clock_confirmations")).toBe(2);
  });

  it("keeps two confirmations naming the same record", async () => {
    const { nodeId, registroIds } = await seedPendingEnvios(suite.db, { count: 1 });
    const recordAt = new Date("2026-07-21T10:30:00.000Z");
    await insertConfirmation(nodeId, 1, { registroId: registroIds[0]!, recordAt });
    await insertConfirmation(nodeId, 2, { registroId: registroIds[0]!, recordAt });
    const { rows } = await suite.db.execute<{ registro_id: string }>(
      sql`select registro_id from clock_confirmations order by seq`,
    );
    expect(rows).toEqual([{ registro_id: registroIds[0] }, { registro_id: registroIds[0] }]);
  });

  it.each([
    { name: "a check that does not exist", overrides: { checkId: newId() } },
    {
      name: "a record that does not exist",
      overrides: { registroId: newId(), recordAt: new Date("2026-07-21T10:30:00.000Z") },
    },
  ])("refuses a row naming $name", async ({ overrides }) => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    const error = await captureError(() => insertConfirmation(nodeId, 1, overrides));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(await countOf("clock_confirmations")).toBe(0);
    await insertConfirmation(nodeId, 1);
    expect(await countOf("clock_confirmations")).toBe(1);
  });

  it("refuses a row naming no node", async () => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    const error = await captureError(() => insertConfirmation(newId(), 1));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(await countOf("clock_confirmations")).toBe(0);
    await insertConfirmation(nodeId, 1);
    expect(await countOf("clock_confirmations")).toBe(1);
  });
});

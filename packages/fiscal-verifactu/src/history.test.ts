import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { UNIQUE_VIOLATION, captureError, refusalOn, withTransaction } from "@waitron/db";
import { seedNode, seedPerson } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import type { ConflictEvidence, LookupConflictEvidence } from "./conflict-types.js";
import * as history from "./history.js";
import { verifactuHistory } from "./schema/verifactu-history.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

it("sequences appends by write order and returns the ids of the stored evidence", async () => {
  const [first, second] = await withTransaction(suite.db, async (tx) => {
    const nodeId = await seedNode(tx);
    const personId = await seedPerson(tx);
    const entry = { kind: "clock.confirmed", nodeId, personId } as const;
    const data = { source: "admin", reason: "start", stepMs: 1, proof: {} } as const;
    const first = await history.appendHistory(tx, {
      ...entry,
      at: new Date("2026-10-19T22:00:00.000Z"),
      data: { ...data, confirmedAt: "2026-10-19T22:00:00.001Z" },
    });
    const second = await history.appendHistory(tx, {
      ...entry,
      at: new Date("2026-10-19T21:00:00.000Z"),
      data: { ...data, stepMs: -1, confirmedAt: "2026-10-19T20:59:59.999Z" },
    });
    return [first, second];
  });
  expect(first.seq).toBe(1);
  expect(second.seq).toBe(2);
  const { rows } = await suite.db.execute(sql`
    select id, seq, at, json_extract(data, '$.stepMs') as step_ms
    from verifactu_history order by seq`);
  expect(rows).toEqual([
    { id: first.id, seq: 1, at: "2026-10-19T22:00:00.000Z", step_ms: 1 },
    { id: second.id, seq: 2, at: "2026-10-19T21:00:00.000Z", step_ms: -1 },
  ]);
});

const at = new Date("2026-07-21T00:01:00Z");
const invoice = {
  IDEmisorFactura: "89890001K",
  NumSerieFactura: "S1/1",
  FechaExpedicionFactura: "20-07-2026",
};
const observation: ConflictEvidence = {
  line: { IDFactura: invoice, EstadoRegistro: "Incorrecto" },
  csv: null,
  comparison: { kind: "annulled" },
};
const lookup: LookupConflictEvidence = {
  source: "consulta",
  invoice,
  reference: null,
  state: "Correcto",
  fingerprint: null,
  system: null,
};

it("appends an observed conflict once per record, attempt and cause", async () => {
  const fixture = await seedPendingEnvios(suite.db, { count: 1 });
  await withTransaction(suite.db, async (tx) => {
    const entry = {
      kind: "conflict.observed",
      nodeId: fixture.nodeId,
      registroId: fixture.registroIds[0]!,
      at,
      data: { attempt: 1, cause: "fiscal.duplicado_anulado", evidence: observation },
    } as const;
    const first = await history.appendHistory(tx, entry, { ifAbsent: true });
    expect(first?.seq).toBe(1);
    expect(await history.appendHistory(tx, entry, { ifAbsent: true })).toBeNull();
    expect(await tx.select({ id: verifactuHistory.id }).from(verifactuHistory)).toEqual([
      { id: first?.id },
    ]);
  });
});

it("surfaces a sequence clash when the event key is new", async () => {
  const fixture = await seedPendingEnvios(suite.db, { count: 1 });
  await withTransaction(suite.db, async (tx) => {
    const entry = {
      kind: "conflict.observed",
      nodeId: fixture.nodeId,
      registroId: fixture.registroIds[0]!,
      at,
      data: { attempt: 1, cause: "fiscal.duplicado_anulado", evidence: observation },
    } as const;
    await history.appendHistory(tx, entry);
    const select = vi.spyOn(tx, "select");
    const builder = tx.select({ seq: verifactuHistory.seq });
    // Only the sequence read is stale. The insert still reaches SQLite.
    vi.spyOn(builder, "from").mockImplementationOnce(() => Promise.resolve([{ seq: 0 }]) as never);
    select.mockReturnValueOnce(builder);
    const error = await captureError(() =>
      history.appendHistory(
        tx,
        { ...entry, data: { ...entry.data, attempt: 2 } },
        { ifAbsent: true },
      ),
    );
    select.mockRestore();
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "verifactu_history", columns: ["seq"] }),
    ).toBe(true);
  });
});

it("reads the retained lookup by its record", async () => {
  const fixture = await seedPendingEnvios(suite.db, { count: 2 });
  const [registroId, withoutLookup] = fixture.registroIds;
  await withTransaction(suite.db, async (tx) => {
    const entry = {
      kind: "conflict.lookup",
      nodeId: fixture.nodeId,
      registroId: registroId!,
      at,
      data: { evidence: lookup },
    } as const;
    const written = await history.appendHistory(tx, entry);
    expect(await history.lookupConflict(tx, registroId!)).toEqual({
      id: written.id,
      registroId,
      recordedAt: at,
      evidence: lookup,
    });
    expect(await history.lookupConflict(tx, withoutLookup!)).toBeNull();
  });
});

it("requires a derived key for an idempotent append", async () => {
  await withTransaction(suite.db, async (tx) => {
    const nodeId = await seedNode(tx);
    const personId = await seedPerson(tx);
    await expect(
      history.appendHistory(
        tx,
        {
          kind: "clock.confirmed",
          nodeId,
          personId,
          at,
          data: {
            source: "admin",
            reason: "start",
            stepMs: 1,
            confirmedAt: at.toISOString(),
            proof: {},
          },
        },
        { ifAbsent: true },
      ),
    ).rejects.toThrow("History entry has no event key");
  });
});

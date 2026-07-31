import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeAeat } from "@waitron/verifactu/src/testing/fake-aeat.js";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { AckState } from "@waitron/fiscal";
import { FISCAL_MIGRATIONS } from "./migrations.js";
import { VerifactuBackend } from "./backend.js";
import {
  ackStateOf,
  applyAck,
  deleteAck,
  markDelivered,
  newProjection,
  pendingAcks,
  unsentCount,
  writeAck,
  type Ack,
} from "./acks.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";

// The suite-wide instants, shared with reconcile.test.ts / drain-fixtures: every seeded record's
// `fecha_expedicion_factura` is 2026-07-20 (drain-fixtures' PAST_FECHA), so all fall in one period.
const SERVER_NOW = new Date("2026-07-21T00:00:00Z");
const DRAIN_AT = new Date("2026-07-21T00:01:00Z"); // past the seeded `proximo_intento_en`
const PERIOD = { year: "2026", month: "07" };
// `steadyClock`'s fixed instant (test/write-path-fixtures.ts). `seedPendingEnvios` hands the backend
// that clock, so reconcile stamps its correction/ack with exactly this — the value the coalesce
// falls back to when a lost-ack row carries no `enviado_en`.
const CLOCK_INSTANT = new Date("2026-03-01T13:05:00+01:00");

const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, FISCAL_MIGRATIONS] });

// Real per-test isolation (deliberately NOT drain.test.ts's shared-and-accumulating convention):
// acks/envios/incidents carry no append-only trigger, so truncating them before each test leaves
// only THIS test's freshly-seeded rows. registros_facturacion is append-only and left behind —
// harmless, since nothing here reaches a registro except through its own envios/acks row.
beforeEach(async () => {
  await pg.db.execute(sql`truncate table acks, incidents, envios cascade`);
});

// A `type`, not an `interface`: `tx.execute<T>` constrains `T` to `Record<string, unknown>`, which
// an object-literal type alias satisfies but a mergeable interface does not (see reconcile.ts).
type AckRow = {
  registro_id: string;
  state: string;
  csv: string | null;
  submitted_at: string;
  delivered_at: string | null;
};

async function acksFor(tenantId: string): Promise<AckRow[]> {
  const { rows } = await withTenant(pg.db, tenantId, (tx) =>
    tx.execute<AckRow>(
      sql`select registro_id, state, csv, submitted_at, delivered_at from acks where tenant_id = ${tenantId}`,
    ),
  );
  return rows;
}

async function envioFor(
  tenantId: string,
  registroId: string,
): Promise<{ estado: string; csv: string | null; enviado_en: string | null }> {
  const { rows } = await withTenant(pg.db, tenantId, (tx) =>
    tx.execute<{ estado: string; csv: string | null; enviado_en: string | null }>(
      sql`select estado, csv, enviado_en from envios where registro_id = ${registroId}`,
    ),
  );
  return rows[0]!;
}

describe("acks — production atomicity (drainer + reconcile)", () => {
  it("writes an ack atomically when the drainer sets a terminal estado", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });

    await backend.drain(DRAIN_AT);

    const env = await envioFor(seeded.tenantId, seeded.registroIds[0]!);
    expect(env.estado).toBe("aceptado");

    const acks = await acksFor(seeded.tenantId);
    expect(acks).toHaveLength(1);
    expect(acks[0]!.registro_id).toBe(seeded.registroIds[0]);
    // The ack agrees with the committed envios row it reflects.
    expect(acks[0]!.state).toBe("accepted");
    expect(acks[0]!.csv).toBe(env.csv);
    expect(acks[0]!.csv).not.toBeNull();
    expect(acks[0]!.delivered_at).toBeNull();
    // submitted_at is the envío's own `enviado_en` (stamped at claim), not a fresh clock reading.
    expect(new Date(acks[0]!.submitted_at).getTime()).toBe(new Date(env.enviado_en!).getTime());
  });

  it("reconcile writes/updates an ack when it corrects a lostAck (pendiente → accepted)", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await backend.drain(DRAIN_AT); // AEAT now holds it Correcta; ours aceptado; drainer wrote an ack

    // Model a genuinely lost acknowledgement: our side never persisted the response, so it still
    // reads `pendiente`, has no CSV, was never claimed (`enviado_en` null), and carries no ack.
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(
        sql`update envios set estado = 'pendiente', confirmado_en = null, csv = null, enviado_en = null where tenant_id = ${seeded.tenantId}`,
      ),
    );
    await pg.db.execute(sql`truncate table acks`);

    const result = await backend.reconcile(seeded.tenantId, PERIOD);

    // The audit still REPORTS the mismatch (localState read from the pre-correction snapshot).
    expect(result.lostAck.map((m) => m.recordId)).toEqual([seeded.registroIds[0]]);
    expect(result.lostAck[0]!.localState).toBe("pendiente");
    expect(result.lostAck[0]!.reportedState).toBe("Correcta");

    // AND it corrected the estado…
    const env = await envioFor(seeded.tenantId, seeded.registroIds[0]!);
    expect(env.estado).toBe("aceptado");

    // …atomically with a fresh ack derived from that committed estado.
    const acks = await acksFor(seeded.tenantId);
    expect(acks).toHaveLength(1);
    expect(acks[0]!.state).toBe("accepted");
    // consulta can never return the CSV, so a reconcile ack's csv is null.
    expect(acks[0]!.csv).toBeNull();
    expect(acks[0]!.delivered_at).toBeNull();
    // No `enviado_en` on the lost-ack row → submitted_at coalesces to the clock instant.
    expect(new Date(acks[0]!.submitted_at).getTime()).toBe(CLOCK_INSTANT.getTime());
  });

  it("INVARIANT: every ack agrees with the committed envios.estado it reflects (drain + reconcile)", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 2 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });

    // Producer 1 — the drainer accepts both records, writing two `accepted` acks.
    await backend.drain(DRAIN_AT);

    // Producer 2 — force record 0 into a lost-ack state and let reconcile correct + re-ack it.
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(
        sql`update envios set estado = 'pendiente', confirmado_en = null, csv = null where registro_id = ${seeded.registroIds[0]}`,
      ),
    );
    await pg.db.execute(sql`delete from acks where registro_id = ${seeded.registroIds[0]}`);
    await backend.reconcile(seeded.tenantId, PERIOD);

    // The load-bearing invariant: for EVERY acked row, acks.state === ackStateOf(envios.estado).
    const { rows } = await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute<{ state: string; estado: string }>(sql`
        select a.state, e.estado
        from acks a join envios e on e.registro_id = a.registro_id
        where a.tenant_id = ${seeded.tenantId}
      `),
    );
    expect(rows).toHaveLength(2); // record 0 (reconcile ack) + record 1 (drainer ack)
    for (const row of rows) {
      expect(row.state).toBe(ackStateOf(row.estado));
    }
  });

  it("is idempotent: a second reconcile after a correction finds a clean match and does not double-write", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await backend.drain(DRAIN_AT);
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      tx.execute(
        sql`update envios set estado = 'pendiente', confirmado_en = null, csv = null where tenant_id = ${seeded.tenantId}`,
      ),
    );
    await pg.db.execute(sql`truncate table acks`);

    const first = await backend.reconcile(seeded.tenantId, PERIOD);
    expect(first.lostAck).toHaveLength(1); // corrected on the first pass

    const second = await backend.reconcile(seeded.tenantId, PERIOD);
    expect(second.lostAck).toEqual([]); // now a clean match — nothing to re-classify
    expect(second.drift).toEqual([]);
    expect(second.noTrace).toEqual([]);

    // The ack upsert deduped: exactly one row, still undelivered.
    const acks = await acksFor(seeded.tenantId);
    expect(acks).toHaveLength(1);
    expect(acks[0]!.state).toBe("accepted");
  });
});

describe("acks — durable transport (pendingAcks / markDelivered)", () => {
  it("pendingAcks returns undelivered acks; markDelivered clears them", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 2 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await backend.drain(DRAIN_AT); // two accepted records → two acks

    const before = await pendingAcks(pg.db, seeded.tenantId);
    expect(before).toHaveLength(2);
    expect(before.map((a) => a.recordId).sort()).toEqual([...seeded.registroIds].sort());
    expect(before.every((a) => a.state === "accepted")).toBe(true);
    expect(before.every((a) => a.csv !== null)).toBe(true);
    expect(before.every((a) => a.submittedAt instanceof Date)).toBe(true);

    await markDelivered(pg.db, seeded.tenantId, seeded.registroIds[0]!);

    const after = await pendingAcks(pg.db, seeded.tenantId);
    expect(after.map((a) => a.recordId)).toEqual([seeded.registroIds[1]]);
  });

  it("writeAck writes nothing for a non-terminal estado (a record with no ack keeps counting)", async () => {
    // Cert-expired at the DB level: the submission never happened, the row is still `pendiente`, so
    // no ack is produced. Mirrors the projection's cert-expired case one layer down.
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    await withTenant(pg.db, seeded.tenantId, (tx) =>
      writeAck(tx, seeded.registroIds[0]!, DRAIN_AT),
    );
    expect(await acksFor(seeded.tenantId)).toHaveLength(0);
  });

  it("deleteAck removes a record's ack row, and is a no-op when there is none", async () => {
    const aeat = createFakeAeat({ serverNow: SERVER_NOW });
    const seeded = await seedPendingEnvios(pg.db, { count: 1 });
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: seeded.clock,
      db: pg.db,
      resolveClient: staticResolver(aeat.client()),
    });
    await backend.drain(DRAIN_AT); // writes an `accepted` ack

    expect(await acksFor(seeded.tenantId)).toHaveLength(1);

    await withTenant(pg.db, seeded.tenantId, (tx) => deleteAck(tx, seeded.registroIds[0]!));
    expect(await acksFor(seeded.tenantId)).toHaveLength(0);

    // Idempotent: deleting an already-absent ack does not throw.
    await withTenant(pg.db, seeded.tenantId, (tx) => deleteAck(tx, seeded.registroIds[0]!));
    expect(await acksFor(seeded.tenantId)).toHaveLength(0);
  });
});

describe("acks — mapping + in-process consumer", () => {
  it("ackStateOf maps every terminal estado; non-terminal estados yield null", () => {
    expect(ackStateOf("aceptado")).toBe("accepted");
    expect(ackStateOf("aceptado_con_errores")).toBe("accepted_with_errors");
    expect(ackStateOf("rechazado")).toBe("rejected");
    expect(ackStateOf("detenido")).toBe("halted");
    expect(ackStateOf("pendiente")).toBeNull();
    expect(ackStateOf("enviando")).toBeNull();
  });

  const ackOf = (recordId: string, state: AckState): Ack => ({
    recordId,
    state,
    csv: null,
    submittedAt: new Date(),
  });

  it("accepted / accepted_with_errors decrement the unsent count; rejected / halted keep it counted and flag it", () => {
    const p = newProjection(["a", "b", "c", "d"]);
    expect(unsentCount(p)).toBe(4);

    applyAck(p, ackOf("a", "accepted"));
    applyAck(p, ackOf("b", "accepted_with_errors"));
    expect(unsentCount(p)).toBe(2); // a, b confirmed → decremented
    expect(p.flagged.size).toBe(0);

    applyAck(p, ackOf("c", "rejected"));
    applyAck(p, ackOf("d", "halted"));
    expect(unsentCount(p)).toBe(2); // c, d still counted (never confirmed)
    expect([...p.flagged].sort()).toEqual(["c", "d"]); // …and flagged

    // A correction re-accepting a flagged record decrements it and clears the flag.
    applyAck(p, ackOf("c", "accepted"));
    expect(unsentCount(p)).toBe(1);
    expect([...p.flagged]).toEqual(["d"]);
  });

  it("cert-expired: a record that never receives an ack keeps the unsent count non-zero", () => {
    // Two records submitted; the cert expired before one could be sent, so only one is ever acked.
    const p = newProjection(["sent", "cert-expired"]);
    applyAck(p, ackOf("sent", "accepted"));
    expect(unsentCount(p)).toBe(1); // the un-acked record stays counted
    expect(p.counted.has("cert-expired")).toBe(true);
  });
});

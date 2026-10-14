import { seedFixtureSif as registerSif } from "../test/sif-fixture.js";
import { sql } from "drizzle-orm";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  locations,
  nodes,
  withTransaction,
  captureError,
  refusalOn,
  UNIQUE_VIOLATION,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { nodeId as brandNodeId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { markDelivered } from "./acks.js";

const venue = useVenueDb({ migrations: TEST_MIGRATIONS });

const SIF = { nif: "89890001K", idSistemaInformatico: "WT" } as const;
const NODE = brandNodeId("11111111-1111-4111-8111-111111111111");
const ACK_RECORD = "22222222-2222-4222-8222-222222222222";
/** An instant no clock reading taken during the test can precede. */
const STARTED_AT = Date.now() - 1;

beforeEach(async () => {
  await withTransaction(venue.db, async (tx) => {
    const [location] = await tx
      .insert(locations)
      .values({
        name: "Sala",
        invoiceLocales: ["es"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    await tx.insert(nodes).values({ id: NODE, locationId: location!.id, name: "Caja" });
  });
});

afterEach(() => vi.useRealTimers());

describe("supplied installation identities", () => {
  it("keeps the supplied identity with a clock far ahead", async () => {
    vi.setSystemTime(new Date("2039-01-01T00:00:00.000Z"));
    const result = await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE, numeroInstalacion: "P000042" }),
    );
    expect(result.numeroInstalacion).toBe("P000042");
  });
  it("keeps the supplied identity when the clock moves backwards", async () => {
    await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE, numeroInstalacion: "P000042" }),
    );
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const result = await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE, numeroInstalacion: "P000043" }),
    );
    expect(result.numeroInstalacion).toBe("P000043");
  });
  it("refuses reuse of a supplied identity despite a different clock", async () => {
    await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE, numeroInstalacion: "P000042" }),
    );
    vi.setSystemTime(new Date("2039-01-01T00:00:00.000Z"));
    const error = await captureError(() =>
      withTransaction(venue.db, (tx) =>
        registerSif(tx, { ...SIF, nodeId: NODE, numeroInstalacion: "P000042" }),
      ),
    );
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "registro_sif",
        columns: ["nif", "id_sistema_informatico", "numero_instalacion"],
      }),
    ).toBe(true);
  });
});

describe("registerSif stamps the clock", () => {
  it("revokes the identity it replaces, stamping a readable moment on the old row only", async () => {
    const first = await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE }),
    );
    const second = await withTransaction(venue.db, (tx) =>
      registerSif(tx, { ...SIF, nodeId: NODE }),
    );

    const rows = venue.db.all<{ id: string; revocado_en: string | null }>(
      sql`select id, revocado_en from registro_sif order by numero_instalacion`,
    );
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
    expect(rows[1]!.revocado_en).toBeNull();
    const revoked = rows[0]!.revocado_en;
    expect(revoked).not.toBeNull();
    expect(new Date(revoked!).getTime()).toBeGreaterThanOrEqual(STARTED_AT);
  });

  it("moves the existing chain head's actualizado_en when it resets the pointer", async () => {
    await withTransaction(venue.db, (tx) => registerSif(tx, { ...SIF, nodeId: NODE }));
    // A value no clock reading can produce, so a SET clause that never ran is visible.
    venue.db.run(
      sql`update cadenas set actualizado_en = '2020-01-01T00:00:00.000Z', secuencia = 7
          where node_id = ${NODE}`,
    );

    await withTransaction(venue.db, (tx) => registerSif(tx, { ...SIF, nodeId: NODE }));

    const [head] = venue.db.all<{
      actualizado_en: string;
      secuencia: number;
      ultimo_registro_id: string | null;
    }>(
      sql`select actualizado_en, secuencia, ultimo_registro_id from cadenas
          where node_id = ${NODE}`,
    );
    expect(new Date(head!.actualizado_en).getTime()).toBeGreaterThanOrEqual(STARTED_AT);
    expect(head!.ultimo_registro_id).toBeNull();
    expect(head!.secuencia).toBe(7); // ours, never reset
  });
});

describe("markDelivered", () => {
  /**
   * Seeded through raw SQL with the foreign key off, so no `registros_facturacion` row is needed:
   * `markDelivered` updates `delivered_at`, which no key reads.
   */
  beforeEach(() => {
    venue.db.run(sql`pragma foreign_keys = off`);
    venue.db.run(sql`
      insert into acks (registro_id, submitted_at, state, delivered_at) values
        (${ACK_RECORD}, '2026-01-01T00:00:00.000Z', 'accepted', null),
        ('other', '2026-01-01T00:00:00.000Z', 'accepted', null)`);
    venue.db.run(sql`pragma foreign_keys = on`);
  });

  it("stamps delivered_at on the named ack, and on no other", async () => {
    await markDelivered(venue.db, ACK_RECORD);

    const rows = venue.db.all<{ registro_id: string; delivered_at: string | null }>(
      sql`select registro_id, delivered_at from acks order by registro_id`,
    );
    const delivered = rows.find((r) => r.registro_id === ACK_RECORD)!.delivered_at;
    expect(delivered).not.toBeNull();
    expect(new Date(delivered!).getTime()).toBeGreaterThanOrEqual(STARTED_AT);
    expect(rows.find((r) => r.registro_id === "other")!.delivered_at).toBeNull();
  });
});

import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { locations, nodes, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { nodeId as brandNodeId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { markDelivered } from "./acks.js";
import { registerSif } from "./registro-sif.js";
import { raiseInstallationFloor } from "./restore.js";

/**
 * The four places this package asked PostgreSQL for a scalar function the storage engine does not
 * have: `greatest` in `raiseInstallationFloor`, and `now()` in `registerSif`'s revocation, in the
 * chain-head reset it calls, and in `markDelivered`.
 *
 * The cases live here rather than in `restore.test.ts`, `registro-sif.test.ts` and `acks.test.ts`
 * because all three of those suites died in their own setup before reaching any of it. Two of the
 * three no longer do. Measured one file at a time, `pnpm --filter @waitron/fiscal-verifactu exec
 * vitest run src/<file> --reporter=dot` (2026-09-22): `restore.test.ts` reports 10 passed and
 * `registro-sif.test.ts` 16 passed, while `acks.test.ts` still reports 10 failed, every one of them
 * `near "truncate": syntax error`. Moving these cases back beside the code they cover is not this
 * change — but for the first two it is no longer blocked.
 */

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

function counter(): (number | undefined)[] {
  return venue.db
    .all<{ proximo_numero: number }>(
      sql`select proximo_numero from contadores_instalacion
          where nif = ${SIF.nif} and id_sistema_informatico = ${SIF.idSistemaInformatico}`,
    )
    .map((row) => row.proximo_numero);
}

function raise(floor: number): Promise<void> {
  return withTransaction(venue.db, (tx) => raiseInstallationFloor(tx, { ...SIF, floor }));
}

/**
 * `raiseInstallationFloor` never lowers the installation counter (CLAUDE.md §5: an installation
 * number a previous restore used must never be minted twice). Both directions plus the create.
 */
describe("raiseInstallationFloor", () => {
  it("raises a counter standing below the floor", async () => {
    await raise(10);
    await raise(500);
    expect(counter()).toEqual([500]);
  });

  it("leaves a counter already standing above the floor", async () => {
    await raise(500);
    await raise(10);
    expect(counter()).toEqual([500]);
  });

  it("creates the row at the floor when the restored database holds no counter", async () => {
    expect(counter()).toEqual([]);
    await raise(42);
    expect(counter()).toEqual([42]);
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
   * Seeded through raw SQL with the foreign key off: `acks.registro_id` references
   * `registros_facturacion`, whose own four keys and eleven NOT NULL columns are the whole sale
   * write path. `markDelivered` updates `delivered_at`, which no key reads.
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

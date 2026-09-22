import { captureError, newId, triggerRaised, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TENANT_A, seedTenantTillSif } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";

/**
 * `registros_facturacion` refuses to let a written row change (CLAUDE.md §5).
 *
 * **Four cases went with the storage switch, and each is named here rather than left as a silent
 * deletion. Two of the four have a successor and two do not.**
 *
 *  - `is actually running as the non-owner application role` read `current_user` and `pg_roles`.
 *    SQLite has no roles: one process opens one file, and what a caller may do is decided outside
 *    the database (`packages/db/src/testing/roles.ts`). Nothing holds that property, and nothing
 *    is owed it — there is no second role for a session to be confused with.
 *  - `rejects TRUNCATE by statement trigger` refused `truncate … cascade`. This engine has no
 *    TRUNCATE statement at all, so the PostgreSQL schema's separate truncate-blocking trigger has
 *    no counterpart (`packages/store/src/append-only.ts` states the same gap, and the one thing it
 *    still cannot refuse: `DROP TABLE`). What DOES hold the "this table cannot be emptied"
 *    property now is the append-only DELETE trigger, proven for `registros_facturacion` by name
 *    against a product-migrated database in `scripts/append-only-triggers.test.ts`.
 *  - the two `every append-only trigger exists and is ENABLE ALWAYS` cases enumerated `pg_trigger`
 *    and asserted `tgenabled = 'A'`. Both halves are gone: there is no trigger catalogue to read
 *    that way and no ENABLE ALWAYS, because the replication apply worker the flag existed for has
 *    no counterpart either. `scripts/append-only-triggers.test.ts` replaced them, and it is the
 *    stronger guard — it pins the same table list by name and proves each refusal by ATTEMPTING an
 *    update and a delete, where these two read a catalogue.
 *
 * The remaining case's title lost the words `even when the privilege is granted`: the grant it
 * described does not exist, and the trigger is now the first layer the UPDATE meets rather than
 * the second.
 */
const pg = useVenueDb({
  migrations: TEST_MIGRATIONS,
  setup: seedTenantTillSif,
  resetPerTest: false,
});

/**
 * One minimal alta.
 *
 * `id` and `creado_en` are stated rather than omitted: both are `$defaultFn` columns only the
 * insert BUILDER fills, so a raw statement omitting them is refused `NOT NULL constraint failed:
 * registros_facturacion.id`. `'[]'::jsonb`/`'{}'::jsonb` lose their casts — the columns are TEXT
 * holding JSON, and a `::` reaches SQLite's parser as `unrecognized token: ":"`. And
 * `repeat('F', 64)` is `no such function: repeat` here, so the huella is built in JavaScript and
 * bound. All three measured by running this file.
 */
async function insertRegistro(tx: Transaction, secuencia: number) {
  return tx.execute(sql`
    insert into registros_facturacion (
      id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, descripcion_operacion, desglose, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, creado_en
    ) values (${newId()}, ${TENANT_A.tillId}, ${TENANT_A.nodeId}, ${TENANT_A.sifId}, ${TENANT_A.saleId},
      ${secuencia}, 'alta',
      '89890001K', ${"A/" + String(secuencia)}, '2026-07-20', 'Waitron SL',
      'F2', 'Venta en establecimiento', '[]', '12.35', '123.45',
      true, '{}',
      '2026-07-20T19:20:30+01:00', 60, '01', ${"F".repeat(64)}, '2026-07-20T18:20:30.000Z'
    ) returning id
  `);
}

describe("registros_facturacion is immutable", () => {
  it("permits INSERT", async () => {
    // Successful insertion is the control for the rejection case: without it, a refusal below
    // could be a broken statement rather than the guard biting.
    await expect(withTransaction(pg.db, (tx) => insertRegistro(tx, 1))).resolves.toBeDefined();
  });

  it("rejects UPDATE by trigger", async () => {
    await withTransaction(pg.db, (tx) => insertRegistro(tx, 4));
    const error = await captureError(async () =>
      pg.db.execute(sql`update registros_facturacion set huella = ${"B".repeat(64)}`),
    );
    // The trigger's own `RAISE(ABORT, …)` text, chosen by `packages/store/src/append-only.ts`.
    // `triggerRaised` matches the class AND the words, so an `ON DELETE RESTRICT` refusal — which
    // arrives under the same result code — cannot satisfy it.
    expect(triggerRaised(error, "registros_facturacion is append-only")).toBe(true);
    // The row is still the row that was written: a refusal that rolled the statement back but left
    // the value changed would satisfy the assertion above and break CLAUDE.md §5 anyway.
    const { rows } = await pg.db.execute<{ huella: string }>(
      sql`select huella from registros_facturacion where secuencia = 4`,
    );
    expect(rows[0]?.huella).toBe("F".repeat(64));
  });
});

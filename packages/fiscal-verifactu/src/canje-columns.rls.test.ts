import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { CONTAINER_SETUP_TIMEOUT_MS, startRealPostgres } from "./testing/postgres.js";
import { seedSale, seedTill, type SeededTill } from "./testing/seed.js";

/**
 * RLS still scopes `registros_facturacion` to the tenant AFTER the `destinatarios` column is added
 * (migration 0011). Real Postgres via Testcontainers, as a NON-SUPERUSER role: the container
 * default user and PGlite alike bypass FORCE ROW LEVEL SECURITY, so only a role that is neither
 * superuser nor BYPASSRLS actually exercises the tenant-isolation policy (CLAUDE.md §4). Mirrors
 * this package's `rectificativa-columns.rls.test.ts`.
 *
 * The tenant-isolation policy is table-level, so a column add cannot change it — this test is what
 * confirms that, rather than assuming it.
 */
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";
const OTHER_TENANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const suite = useRealPostgres({
  start: startRealPostgres,
  probeRole: { name: PROBE_ROLE, password: PROBE_PASSWORD, inRole: "app_user" },
  timeoutMs: CONTAINER_SETUP_TIMEOUT_MS,
});

/** Inserts one F3 canje alta registro (with destinatarios and facturas_sustituidas populated) as
 * the superuser admin, which bypasses RLS — the row exists regardless of tenant scoping. */
async function seedCanje(till: SeededTill, saleId: string): Promise<void> {
  await suite.admin.execute(sql`
    insert into registros_facturacion (
      tenant_id, till_id, node_id, sif_id, sale_id, secuencia, tipo_registro,
      id_emisor_factura, num_serie_factura, fecha_expedicion_factura, nombre_razon_emisor,
      tipo_factura, facturas_sustituidas, destinatarios,
      descripcion_operacion, cuota_total, importe_total,
      primer_registro, sistema_informatico,
      fecha_hora_huso_gen_registro, offset_minutos, tipo_huella, huella, entorno
    ) values (
      ${till.tenantId}, ${till.tillId}, ${till.nodeId}, ${till.sifId}, ${saleId}, 1, 'alta',
      '89890001K', 'F/1', '2026-07-20', 'Waitron SL',
      'F3',
      ${JSON.stringify({
        IDFacturaSustituida: [
          {
            IDEmisorFactura: "89890001K",
            NumSerieFactura: "A/1",
            FechaExpedicionFactura: "20-07-2026",
          },
        ],
      })}::jsonb,
      ${JSON.stringify({ IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B99999999" }] })}::jsonb,
      'Canje de tiques simplificados', '21.43', '123.45',
      true, '{}'::jsonb,
      '2026-07-20T19:20:30+01:00', 60, '01', repeat('F', 64), 'production'
    )
  `);
}

describe("registros_facturacion RLS after the destinatarios column add", () => {
  it("shows a canje row to its own tenant and hides it from another", async () => {
    const till = await seedTill(suite.admin, "A");
    const saleId = await seedSale(suite.admin, till, 1);
    await seedCanje(till, saleId);

    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // Same tenant: the row is visible, and the new column reads back under RLS.
      const own = await withTenant(probe, till.tenantId, (tx) =>
        tx.execute<{ destinatarios: unknown }>(
          sql`select destinatarios from registros_facturacion where sale_id = ${saleId}`,
        ),
      );
      expect(own.rows).toHaveLength(1);
      expect(own.rows[0]?.destinatarios).toEqual({
        IDDestinatario: [{ NombreRazon: "Cliente SL", NIF: "B99999999" }],
      });

      // Another tenant's app.tenant_id: the tenant-isolation policy filters the row out entirely.
      const other = await withTenant(probe, OTHER_TENANT, (tx) =>
        tx.execute(sql`select 1 from registros_facturacion where sale_id = ${saleId}`),
      );
      expect(other.rows).toHaveLength(0);
    } finally {
      await probe.close();
    }
  });
});

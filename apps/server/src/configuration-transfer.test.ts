import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { WaitronModule } from "@waitron/module";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { withTenant } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyVenue, planVenue, type VenueRequest } from "@waitron/provisioning";
import { hashPassword, hashPin } from "@waitron/identity";
import { recordSale } from "@waitron/core";
import { nodeId, seriesId, tenantId, tillId } from "@waitron/shared";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import { systemClock } from "./till-backend.js";
import {
  buildConfigurationBundle,
  collectConfigurationMedia,
  decodeConfigurationBundle,
  encodeConfigurationBundle,
  importConfigurationTables,
  publishConfigurationMedia,
  type ConfigurationBundle,
} from "./configuration-transfer.js";

const suite = usePgliteDb({ migrations: migrationOptionsFor(manifestSets(), null) });

function venue(taxId: string): VenueRequest {
  return {
    country: "ES",
    taxId,
    legalName: "Prepared SL",
    location: {
      name: "Prepared",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      fiscalTerritory: "ES-common",
      addressLine1: "Calle 1",
      addressLine2: null,
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
    },
    tillName: "Till",
    seriesCode: "F",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Admin",
      email: `${taxId.toLowerCase()}@example.test`,
      pinHash: hashPin("1234"),
      passwordHash: hashPassword("a secure password"),
    },
  };
}

const bundle: ConfigurationBundle = {
  version: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  sourceTenantId: "tenant",
  sourceOperatorId: "source-admin",
  venue: {
    country: "ES",
    taxId: "B12345678",
    legalName: "Prepared SL",
    location: {
      id: "location",
      name: "Prepared",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      fiscalTerritory: "ES-common",
      addressLine1: "Calle 1",
      addressLine2: null,
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00:00",
      orderFlow: "prepay",
      bumpMode: "line",
      fireControl: "waiter",
      receiptPrintMode: "auto",
      drawerOpenPolicy: "gated",
      catalogueId: null,
    },
    tillName: "Till",
    seriesCode: "F",
    rectificativeSeriesCode: "R",
  },
  modules: { core: 1 },
  tables: { products: [{ id: "p1", tenant_id: "tenant", descriptions: { "es-ES": "Café" } }] },
  reconnect: ["printers"],
};

describe("configuration transfer archive", () => {
  it("round-trips the versioned payload under the export passphrase", () => {
    expect(
      decodeConfigurationBundle(
        encodeConfigurationBundle(bundle, "a strong passphrase"),
        "a strong passphrase",
      ),
    ).toEqual(bundle);
  });

  it("rejects a short passphrase before creating an artifact", () => {
    expect(() => encodeConfigurationBundle(bundle, "short")).toThrowError(
      expect.objectContaining({ code: "setup.request_invalid", params: { field: "passphrase" } }),
    );
  });

  it("rejects an undeclared module contribution", async () => {
    const { exportConfigurationTables } = await import("./configuration-transfer.js");
    const module = { name: "probe" } as WaitronModule;
    await expect(exportConfigurationTables({} as never, "tenant", [module])).rejects.toMatchObject({
      code: "setup.request_invalid",
      params: { field: "module:probe" },
    });
  });

  it("carries only referenced, digest-matched media and publishes it byte-for-byte", async () => {
    const source = await mkdtemp(join(tmpdir(), "waitron-config-source-"));
    const target = await mkdtemp(join(tmpdir(), "waitron-config-target-"));
    try {
      const bytes = Buffer.from("prepared product image");
      const name = `${createHash("sha256").update(bytes).digest("hex")}.png`;
      await writeFile(join(source, name), bytes);
      await writeFile(join(source, `${"0".repeat(64)}.png`), "unreferenced");
      const withImage: ConfigurationBundle = {
        ...bundle,
        tables: { products: [{ ...bundle.tables.products![0], image: name }] },
      };
      const media = await collectConfigurationMedia(withImage, source);
      expect(media.map((entry) => entry.name)).toEqual([`media/${name}`]);

      const artifact = encodeConfigurationBundle(withImage, "a strong passphrase", media);
      expect(decodeConfigurationBundle(artifact, "a strong passphrase")).toEqual(withImage);
      await publishConfigurationMedia(artifact, "a strong passphrase", target);
      expect(await readFile(join(target, name))).toEqual(bytes);
    } finally {
      await Promise.all([
        rm(source, { recursive: true, force: true }),
        rm(target, { recursive: true, force: true }),
      ]);
    }
  });

  it("refuses media whose content does not match its content-addressed filename", async () => {
    const source = await mkdtemp(join(tmpdir(), "waitron-config-source-"));
    try {
      const name = `${"0".repeat(64)}.png`;
      await writeFile(join(source, name), "different bytes");
      const withImage: ConfigurationBundle = {
        ...bundle,
        tables: { products: [{ ...bundle.tables.products![0], image: name }] },
      };
      await expect(collectConfigurationMedia(withImage, source)).rejects.toMatchObject({
        code: "setup.request_invalid",
        params: { field: `media:${name}` },
      });
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  });
});

describe("configuration transfer database path", () => {
  it("rolls the new venue back when an imported row is invalid", async () => {
    const targetRequest = venue("B11111111");
    const coreOnly = [
      {
        name: "core",
        version: "0.0.0",
        tier: "mandatory",
        migrations: { name: "core", table: "__drizzle_migrations_db", from: "../db/drizzle" },
        configurationTransfer: { kind: "tables", tables: [{ name: "products" }] },
      } satisfies WaitronModule,
    ];
    await expect(
      applyVenue(planVenue(targetRequest, ALL_MODULES), {
        db: suite.db,
        modules: ALL_MODULES,
        beforeCommit: async (tx, result) => {
          await importConfigurationTables(
            tx,
            {
              ...bundle,
              tables: {
                products: [{ ...bundle.tables.products![0], injected_column: "refuse me" }],
              },
            },
            { tenantId: result.tenantId, locationId: result.locationId },
            coreOnly,
            { core: 1 },
          );
        },
      }),
    ).rejects.toMatchObject({ code: "setup.request_invalid" });
    const persisted = await suite.db.execute<{ count: number }>(sql`
      select count(*)::int as count from tenants where tax_id = ${targetRequest.taxId}
    `);
    expect(persisted.rows[0]!.count).toBe(0);
  });

  it("copies declared configuration into a fresh venue while scrubbing staff authenticators", async () => {
    const source = await applyVenue(planVenue(venue("B12345678"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
    });
    await withTenant(suite.db, source.tenantId, async (tx) => {
      await tx.execute(sql`
        insert into persons
          (id, tenant_id, display_name, pin_hash, password_hash, email, role)
        values
          ('12121212-aaaa-aaaa-aaaa-121212121212', ${source.tenantId}, 'Second admin',
           'second-admin-pin', 'second-admin-password', 'second-admin@example.test', 'admin')`);
      await tx.execute(sql`
        insert into catalogues (id, tenant_id, name) values
          ('11111111-aaaa-aaaa-aaaa-111111111111', ${source.tenantId}, 'Prepared menu')`);
      await tx.execute(sql`
        insert into products
          (id, tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
        values
          ('22222222-aaaa-aaaa-aaaa-222222222222', ${source.tenantId},
           '11111111-aaaa-aaaa-aaaa-111111111111', '{"es-ES":"Café"}', 'each', 1.50, 'general')`);
      await tx.execute(sql`
        insert into persons
          (id, tenant_id, display_name, pin_hash, password_hash, email, role)
        values
          ('33333333-aaaa-aaaa-aaaa-333333333333', ${source.tenantId}, 'Ada',
           'source-pin-secret', 'source-password-secret', 'ada@example.test', 'manager')`);
      await tx.execute(sql`
        insert into employments
          (id, tenant_id, person_id, contracted_minutes_per_week, contract_type, start_date, pay_rate)
        values
          ('66666666-aaaa-aaaa-aaaa-666666666666', ${source.tenantId},
           '33333333-aaaa-aaaa-aaaa-333333333333', 2400, 'permanent', '2026-01-01', 12.50)`);
      await tx.execute(sql`
        insert into availability
          (id, tenant_id, person_id, weekday, available_from_minute, available_to_minute,
           effective_from)
        values
          ('77777777-aaaa-aaaa-aaaa-777777777777', ${source.tenantId},
           '33333333-aaaa-aaaa-aaaa-333333333333', 1, 540, 1020, '2026-01-01')`);
      await tx.execute(sql`
        insert into shift_templates
          (id, tenant_id, location_id, label, weekday, starts_minute, ends_minute, role)
        values
          ('88888888-aaaa-aaaa-aaaa-888888888888', ${source.tenantId}, ${source.locationId},
           'Evening', 1, 1020, 120, 'bar')`);
      await tx.execute(sql`
        insert into convenio_config (id, tenant_id, location_id)
        values ('99999999-aaaa-aaaa-aaaa-999999999999', ${source.tenantId}, ${source.locationId})`);
      await tx.execute(sql`
        insert into payment_policy (tenant_id, offline_mode, offline_amount_cap)
        values (${source.tenantId}, 'cash_only', 50)`);
      await tx.execute(sql`
        insert into working_orders
          (id, tenant_id, till_id, node_id, order_number, label)
        values
          ('aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa', ${source.tenantId}, ${source.tillId},
           ${source.nodeId}, 1, 'Practice tab')`);
      await tx.execute(sql`
        insert into dining_tables
          (id, tenant_id, location_id, label, tab_id)
        values
          ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', ${source.tenantId}, ${source.locationId},
           'T1', 'aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa')`);
      await tx.execute(sql`
        insert into payments
          (id, tenant_id, working_order_id, node_id, provider, payment_ref, amount, state)
        values
          ('cccccccc-bbbb-bbbb-bbbb-cccccccccccc', ${source.tenantId},
           'aaaaaaaa-bbbb-bbbb-bbbb-aaaaaaaaaaaa', ${source.nodeId}, 'simulated',
           'practice-payment', 1.50, 'captured')`);
      await tx.execute(sql`
        insert into bookings
          (id, tenant_id, location_id, booking_date, booking_time, party_size, contact_name,
           table_id, created_by)
        values
          ('dddddddd-bbbb-bbbb-bbbb-dddddddddddd', ${source.tenantId}, ${source.locationId},
           '2026-09-10', '20:00', 2, 'Practice guest',
           'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
           '33333333-aaaa-aaaa-aaaa-333333333333')`);
      await tx.execute(sql`
        insert into print_agents
          (id, tenant_id, location_id, name, token_hash, active, host)
        values
          ('44444444-aaaa-aaaa-aaaa-444444444444', ${source.tenantId}, ${source.locationId},
           'Kitchen agent', 'source-agent-token', true, 'source-box.local')`);
      await tx.execute(sql`
        insert into printers
          (id, tenant_id, location_id, name, transport, local_key, active)
        values
          ('55555555-aaaa-aaaa-aaaa-555555555555', ${source.tenantId}, ${source.locationId},
           'Kitchen printer', 'usb', 'B120300001', true)`);
      await tx.execute(sql`
        insert into sales
          (tenant_id, till_id, series_id, node_id, invoice_number, issued_at,
           issued_offset_minutes, total, vat_breakdown, locale, invoice_locales,
           fiscal_backend, fiscal_state)
        values
          (${source.tenantId}, ${source.tillId}, ${source.seriesIds[0]}, ${source.nodeId}, 99,
           '2026-09-09T10:00:00Z', 0, 1.50, '[]', 'es-ES', array['es-ES'],
           'verifactu', 'recorded')`);
    });
    const sourceOperator = await suite.db.execute<{ id: string }>(sql`
      select id from persons
      where tenant_id = ${source.tenantId} and role = 'admin'
        and id <> '12121212-aaaa-aaaa-aaaa-121212121212'
    `);
    const versions = await schemaVersionsByModule(suite.db, ALL_MODULES);
    const transferred = await buildConfigurationBundle(
      suite.db,
      { ...source, sourceOperatorId: sourceOperator.rows[0]!.id },
      ALL_MODULES,
      new Date("2026-09-09T00:00:00.000Z"),
      versions,
    );
    for (const person of transferred.tables.persons ?? []) {
      expect(person).not.toHaveProperty("pin_hash");
      expect(person).not.toHaveProperty("password_hash");
    }
    expect(transferred.tables).not.toHaveProperty("sales");
    expect(transferred.tables.print_agents).toHaveLength(1);
    expect(transferred.tables.print_agents![0]).not.toHaveProperty("host");

    const target = await applyVenue(planVenue(venue("B87654321"), ALL_MODULES), {
      db: suite.db,
      modules: ALL_MODULES,
      beforeCommit: async (tx, result) => {
        await importConfigurationTables(
          tx,
          transferred,
          { tenantId: result.tenantId, locationId: result.locationId },
          ALL_MODULES,
          versions,
        );
      },
    });
    const imported = await suite.db.execute<{
      products: number;
      staff: number;
      suspended_admins: number;
      secret_hits: number;
      status: string;
      target_sales: number;
      source_sales: number;
      inactive_agents: number;
      inactive_printers: number;
      source_agent_secrets: number;
      employments: number;
      availability: number;
      shift_templates: number;
      convenio_config: number;
      payment_policy: number;
      linked_tables: number;
      target_orders: number;
      target_payments: number;
      target_bookings: number;
    }>(sql`
      select
        (select count(*)::int from products where tenant_id = ${target.tenantId}) as products,
        (select count(*)::int from persons where tenant_id = ${target.tenantId} and role = 'manager') as staff,
        (select count(*)::int from persons where tenant_id = ${target.tenantId}
          and role = 'admin' and status = 'suspended') as suspended_admins,
        (select count(*)::int from persons where tenant_id = ${target.tenantId}
          and (pin_hash = 'source-pin-secret' or password_hash = 'source-password-secret')) as secret_hits,
        (select status from persons where tenant_id = ${target.tenantId} and role = 'manager') as status,
        (select count(*)::int from sales where tenant_id = ${target.tenantId}) as target_sales,
        (select count(*)::int from sales where tenant_id = ${source.tenantId}) as source_sales,
        (select count(*)::int from print_agents
          where tenant_id = ${target.tenantId} and not active) as inactive_agents,
        (select count(*)::int from printers
          where tenant_id = ${target.tenantId} and not active and local_key = 'B120300001') as inactive_printers,
        (select count(*)::int from print_agents
          where tenant_id = ${target.tenantId} and token_hash = 'source-agent-token') as source_agent_secrets,
        (select count(*)::int from employments where tenant_id = ${target.tenantId}) as employments,
        (select count(*)::int from availability where tenant_id = ${target.tenantId}) as availability,
        (select count(*)::int from shift_templates where tenant_id = ${target.tenantId}) as shift_templates,
        (select count(*)::int from convenio_config where tenant_id = ${target.tenantId}) as convenio_config,
        (select count(*)::int from payment_policy where tenant_id = ${target.tenantId}) as payment_policy,
        (select count(*)::int from dining_tables
          where tenant_id = ${target.tenantId} and tab_id is not null) as linked_tables,
        (select count(*)::int from working_orders where tenant_id = ${target.tenantId}) as target_orders,
        (select count(*)::int from payments where tenant_id = ${target.tenantId}) as target_payments,
        (select count(*)::int from bookings where tenant_id = ${target.tenantId}) as target_bookings
    `);
    expect(imported.rows[0]).toEqual({
      products: 1,
      staff: 1,
      suspended_admins: 1,
      secret_hits: 0,
      status: "suspended",
      target_sales: 0,
      source_sales: 1,
      inactive_agents: 1,
      inactive_printers: 1,
      source_agent_secrets: 0,
      employments: 1,
      availability: 1,
      shift_templates: 1,
      convenio_config: 1,
      payment_policy: 1,
      linked_tables: 0,
      target_orders: 0,
      target_payments: 0,
      target_bookings: 0,
    });

    const fiscal = ALL_MODULES.find((module) => module.fiscal?.id === "verifactu")!.fiscal!;
    await withTenant(suite.db, target.tenantId, (tx) =>
      recordSale(
        tx,
        fiscal.makeBackend({ db: suite.db, clock: systemClock(), environment: "production" }),
        {
          tenantId: tenantId(target.tenantId),
          tillId: tillId(target.tillId),
          nodeId: nodeId(target.nodeId),
          seriesId: seriesId(target.seriesIds[0]!),
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          total: "1.00",
          lines: [
            {
              lineNo: 1,
              descriptions: { "es-ES": "First live sale" },
              quantity: "1",
              unitPrice: "1.00",
              vatRate: "0.00",
              lineTotal: "1.00",
            },
          ],
          clock: systemClock(),
          settlement: {
            kind: "immediate",
            tenders: [
              {
                method: "cash",
                amount: "1.00",
                tipAmount: "0.00",
                settledAt: new Date("2026-09-09T12:00:00Z"),
              },
            ],
          },
        },
      ),
    );
    const firstLive = await suite.db.execute<{
      invoice_number: number;
      first_record: boolean;
      previous_hash: string | null;
    }>(
      sql`
        select s.invoice_number, r.primer_registro as first_record,
          r.anterior_huella as previous_hash
        from sales s
        join registros_facturacion r on r.tenant_id = s.tenant_id and r.sale_id = s.id
        where s.tenant_id = ${target.tenantId}
      `,
    );
    expect(firstLive.rows).toEqual([
      { invoice_number: 1, first_record: true, previous_hash: null },
    ]);
  });
});

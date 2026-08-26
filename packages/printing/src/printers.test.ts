import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { createPrinter } from "./printers.js";
import type { PrintConfig } from "./printers.js";
import "./errors.js";

// PGlite, not real Postgres: `createPrinter` is a single INSERT gated by an app-layer required-field
// pre-check plus the DB's transport CHECK + composite FK — none of which is a CONCURRENCY or
// deployment-role-privilege property. RLS-as-app_user and the FK/CHECK integrity are already proven
// on real Postgres in packages/db's printing.rls.test.ts (and the enrol race in agent.test.ts), so
// the heavier target buys this suite nothing (CLAUDE.md §4). A superuser PGlite connection bypasses
// RLS, so the explicit `tenant_id` the verb writes/reads is what scopes these rows.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

/** A fresh tenant + venue per test, seeded on the superuser connection (RLS bypassed for setup). Each
 * test gets its OWN tenant (via seedTenant's fresh NIF) so rows are order-independent. */
async function setup(): Promise<PrintConfig> {
  const tenantId = await seedTenant(suite.db);
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
  return { tenantId, locationId: rows[0]!.id };
}

/** Seed a bare print_agents row directly (a fixture the network_tcp/usb composite FK needs). The
 * token_hash is a placeholder — nothing here authenticates the agent. */
async function seedAgent(cfg: PrintConfig): Promise<string> {
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into print_agents (tenant_id, location_id, name, token_hash)
    values (${cfg.tenantId}, ${cfg.locationId}, 'Cocina agent', 'scrypt$fixture') returning id`);
  return rows[0]!.id;
}

function asTx<T>(cfg: PrintConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, cfg.tenantId, fn);
}

async function printerRow(printerId: string): Promise<{ transport: string; port: number | null }> {
  const { rows } = await suite.db.execute<{ transport: string; port: number | null }>(
    sql`select transport, port from printers where id = ${printerId}`,
  );
  return rows[0]!;
}

/** The AppError code a thrown rejection carries, or undefined if `fn` resolved. */
async function codeOf(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("createPrinter", () => {
  it("inserts a network_tcp printer bound to its agent; an omitted port defaults to 9100", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    // port deliberately OMITTED — this is the receipt for the "drizzle omits undefined → the column
    // default applies" claim in printers.ts: the stored port must be 9100, not NULL.
    const { id } = await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, {
        name: "Cocina",
        transport: "network_tcp",
        agentId,
        host: "10.0.0.9",
      }),
    );
    const row = await printerRow(id);
    expect(row.transport).toBe("network_tcp");
    expect(row.port).toBe(9100);
  });

  it("inserts a usb printer bound to its agent + device path", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const { id } = await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, {
        name: "Barra USB",
        transport: "usb",
        agentId,
        usbPath: "/dev/usb/lp0",
      }),
    );
    expect((await printerRow(id)).transport).toBe("usb");
  });

  it("inserts an agent-less cloud_poll printer", async () => {
    const cfg = await setup();
    const { id } = await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, { name: "Nube", transport: "cloud_poll", pollId: "poll-123" }),
    );
    expect((await printerRow(id)).transport).toBe("cloud_poll");
  });

  it("rejects a network_tcp printer with no host → printer.invalid_config", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    expect(
      await codeOf(() =>
        asTx(cfg, (tx) =>
          createPrinter(tx, cfg, { name: "Bad", transport: "network_tcp", agentId }),
        ),
      ),
    ).toBe("printer.invalid_config");
  });

  it("rejects a usb printer with no usb_path → printer.invalid_config", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    expect(
      await codeOf(() =>
        asTx(cfg, (tx) => createPrinter(tx, cfg, { name: "Bad", transport: "usb", agentId })),
      ),
    ).toBe("printer.invalid_config");
  });

  it("rejects a cloud_poll printer with no poll_id → printer.invalid_config", async () => {
    const cfg = await setup();
    expect(
      await codeOf(() =>
        asTx(cfg, (tx) => createPrinter(tx, cfg, { name: "Bad", transport: "cloud_poll" })),
      ),
    ).toBe("printer.invalid_config");
  });
});

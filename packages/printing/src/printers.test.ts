import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, isPgError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { createPrinter, deactivatePrinter, listPrinters, updatePrinter } from "./printers.js";
import type { PrintConfig, PrintTransport } from "./printers.js";
import "./errors.js";

// PGlite, not real Postgres: `createPrinter` is a single INSERT gated by an app-layer required-field
// pre-check plus the DB's transport CHECK + composite FK — none of which is a CONCURRENCY or
// deployment-role-privilege property. The FK/CHECK integrity is already proven on real Postgres in
// packages/db's printing.test.ts (and the enrol race in agent.test.ts), so the heavier target buys
// this suite nothing (CLAUDE.md §4). The explicit `tenant_id` the verb writes/reads is what scopes
// these rows.
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

/**
 * A fresh tenant + venue per test, seeded on the superuser connection. Each test gets its OWN
 * tenant (via seedTenant's fresh NIF) so rows are order-independent.
 */
async function setup(): Promise<PrintConfig> {
  const tenantId = await seedTenant(suite.db);
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Bar', array['es-ES'], 'Sale on premises') returning id`);
  return { tenantId, locationId: rows[0]!.id };
}

/** Seed a bare print_agents row directly (a fixture the network_tcp/usb composite FK needs). The
 * token_hash is a placeholder — nothing here authenticates the agent. */
async function seedAgent(cfg: PrintConfig): Promise<string> {
  const { rows } = await suite.db.execute<{ id: string }>(sql`
    insert into print_agents (tenant_id, location_id, name, token_hash)
    values (${cfg.tenantId}, ${cfg.locationId}, 'Kitchen agent', 'scrypt$fixture') returning id`);
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

/** The raw rejected value (or undefined if `fn` resolved), for asserting an error propagated UNCHANGED
 * (the translate-or-rethrow fallthrough) rather than being translated to a domain code. */
async function errorOf(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

/** Create a network_tcp printer bound to `agentId` and return its id. */
async function seedPrinter(cfg: PrintConfig, agentId: string, name = "Kitchen"): Promise<string> {
  const { id } = await asTx(cfg, (tx) =>
    createPrinter(tx, cfg, { name, transport: "network_tcp", agentId, host: "10.0.0.9" }),
  );
  return id;
}

async function fullRow(printerId: string): Promise<{
  name: string;
  host: string | null;
  usb_path: string | null;
  ticket_scope: string;
  active: boolean;
  agent_id: string | null;
}> {
  const { rows } = await suite.db.execute<{
    name: string;
    host: string | null;
    usb_path: string | null;
    ticket_scope: string;
    active: boolean;
    agent_id: string | null;
  }>(
    sql`select name, host, usb_path, ticket_scope, active, agent_id from printers where id = ${printerId}`,
  );
  return rows[0]!;
}

describe("createPrinter", () => {
  it("inserts a network_tcp printer bound to its agent; an omitted port defaults to 9100", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    // port deliberately OMITTED — this is the receipt for the "drizzle omits undefined → the column
    // default applies" claim in printers.ts: the stored port must be 9100, not NULL.
    const { id } = await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, {
        name: "Kitchen",
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
        name: "Bar USB",
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
      createPrinter(tx, cfg, { name: "Cloud", transport: "cloud_poll", pollId: "poll-123" }),
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

  it("maps a bind to an unknown agent (the composite FK, 23503) → agent.not_found", async () => {
    // The pre-check passes (agentId + host both PRESENT), so the write reaches the DB, where the
    // (tenant_id, agent_id) → print_agents composite FK has no matching row → 23503, translated friendly.
    const cfg = await setup();
    const ghost = randomUUID();
    expect(
      await codeOf(() =>
        asTx(cfg, (tx) =>
          createPrinter(tx, cfg, {
            name: "Ghost",
            transport: "network_tcp",
            agentId: ghost,
            host: "10.0.0.1",
          }),
        ),
      ),
    ).toBe("agent.not_found");
  });
});

describe("updatePrinter", () => {
  it("applies a partial edit (only the named fields change) and 204-equivalents (resolves)", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const id = await seedPrinter(cfg, agentId);
    // Every editable field present at once — so each `if (patch.X !== undefined)` set-branch is
    // exercised (port/pollId/active included). The extra pollId on a network_tcp row is allowed: the
    // CHECK asserts the transport's REQUIRED fields are present, not that the others are absent.
    await asTx(cfg, (tx) =>
      updatePrinter(tx, cfg, id, {
        name: "Kitchen 2",
        host: "10.0.0.20",
        port: 9200,
        pollId: "poll-extra",
        ticketScope: "order",
        active: false,
      }),
    );
    const row = await fullRow(id);
    expect(row.name).toBe("Kitchen 2");
    expect(row.host).toBe("10.0.0.20");
    expect(row.ticket_scope).toBe("order");
    expect(row.active).toBe(false);
    const { rows } = await suite.db.execute<{ port: number; poll_id: string | null }>(
      sql`select port, poll_id from printers where id = ${id}`,
    );
    expect(rows[0]!.port).toBe(9200);
    expect(rows[0]!.poll_id).toBe("poll-extra");
  });

  it("clears a nullable field with an explicit null (usb_path stays null; a re-bind to another agent)", async () => {
    const cfg = await setup();
    const first = await seedAgent(cfg);
    const second = await suite.db.execute<{ id: string }>(sql`
      insert into print_agents (tenant_id, location_id, name, token_hash)
      values (${cfg.tenantId}, ${cfg.locationId}, 'Second', 'scrypt$fixture') returning id`);
    const id = await seedPrinter(cfg, first);
    await asTx(cfg, (tx) =>
      updatePrinter(tx, cfg, id, { agentId: second.rows[0]!.id, usbPath: null }),
    );
    const row = await fullRow(id);
    expect(row.agent_id).toBe(second.rows[0]!.id);
    expect(row.usb_path).toBeNull();
  });

  it("an EMPTY patch is a no-op on an existing printer, and 404s a missing one", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const id = await seedPrinter(cfg, agentId);
    // Empty patch, existing id → resolves (no-op), never a drizzle "No values to set" throw.
    await expect(asTx(cfg, (tx) => updatePrinter(tx, cfg, id, {}))).resolves.toBeUndefined();
    // Empty patch, unknown id → printer.not_found.
    expect(await codeOf(() => asTx(cfg, (tx) => updatePrinter(tx, cfg, randomUUID(), {})))).toBe(
      "printer.not_found",
    );
  });

  it("an unknown printer id → printer.not_found", async () => {
    const cfg = await setup();
    expect(
      await codeOf(() => asTx(cfg, (tx) => updatePrinter(tx, cfg, randomUUID(), { name: "X" }))),
    ).toBe("printer.not_found");
  });

  it("a transport change that leaves a required field absent (CHECK 23514) → printer.invalid_config", async () => {
    // network_tcp → usb needs usb_path; the row has host but no usb_path, so the transport-fields CHECK
    // fails on the update. `agentId` is NOT in the patch (undefined), exercising the FK-branch skip.
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const id = await seedPrinter(cfg, agentId);
    expect(
      await codeOf(() => asTx(cfg, (tx) => updatePrinter(tx, cfg, id, { transport: "usb" }))),
    ).toBe("printer.invalid_config");
  });

  it("a re-bind to an unknown agent (FK 23503) → agent.not_found", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const id = await seedPrinter(cfg, agentId);
    const ghost = randomUUID();
    expect(
      await codeOf(() => asTx(cfg, (tx) => updatePrinter(tx, cfg, id, { agentId: ghost }))),
    ).toBe("agent.not_found");
  });

  it("a driver error that is NEITHER the FK NOR the CHECK propagates UNCHANGED (the rethrow branch)", async () => {
    // An invalid enum value reaches the `transport` column as 22P02 — not 23503/23514 — so
    // translatePrinterWriteError must rethrow it rather than mistranslate it to a printing code.
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const id = await seedPrinter(cfg, agentId);
    const err = await errorOf(() =>
      asTx(cfg, (tx) =>
        updatePrinter(tx, cfg, id, { transport: "carrier_pigeon" as PrintTransport }),
      ),
    );
    expect(err).toBeDefined();
    // NOT translated: the two mapped domain codes must not appear on the rethrown error.
    expect((err as { code?: string }).code).not.toBe("agent.not_found");
    expect((err as { code?: string }).code).not.toBe("printer.invalid_config");
  });
});

describe("deactivatePrinter", () => {
  it("flips active=false (never a delete) and 404s an unknown id", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const id = await seedPrinter(cfg, agentId);
    await asTx(cfg, (tx) => deactivatePrinter(tx, cfg, id));
    expect((await fullRow(id)).active).toBe(false);
    // The row still exists (deactivated, not deleted).
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*)::int as n from printers where id = ${id}`,
    );
    expect(rows[0]!.n).toBe(1);
    expect(await codeOf(() => asTx(cfg, (tx) => deactivatePrinter(tx, cfg, randomUUID())))).toBe(
      "printer.not_found",
    );
  });
});

describe("listPrinters", () => {
  it("lists this tenant's printers by name (active and deactivated)", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg);
    const bId = await seedPrinter(cfg, agentId, "Bravo");
    const aId = await seedPrinter(cfg, agentId, "Alfa");
    await asTx(cfg, (tx) => deactivatePrinter(tx, cfg, bId));
    const rows = await asTx(cfg, (tx) => listPrinters(tx, cfg));
    const mine = rows.filter((r) => r.id === aId || r.id === bId);
    expect(mine.map((r) => r.name)).toEqual(["Alfa", "Bravo"]); // sorted by name
    expect(mine.find((r) => r.id === bId)!.active).toBe(false); // a deactivated printer still lists
    expect(mine.find((r) => r.id === aId)!.port).toBe(9100);
  });
});

describe("isPgError (@waitron/db SQLSTATE cause-walk, as printers.ts uses it)", () => {
  it("recognises a bare driver error", () => {
    expect(isPgError(Object.assign(new Error("fk"), { code: "23503" }), "23503")).toBe(true);
  });

  it("recognises a violation wrapped in a cause chain (drizzle wraps the real error)", () => {
    const inner = Object.assign(new Error("fk"), { code: "23503" });
    expect(
      isPgError(new Error("outer", { cause: new Error("mid", { cause: inner }) }), "23503"),
    ).toBe(true);
  });

  it("does not match a different SQLSTATE", () => {
    expect(isPgError(Object.assign(new Error("unique"), { code: "23505" }), "23503")).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const looped: Error & { cause?: unknown } = new Error("loop");
    looped.cause = looped;
    expect(isPgError(looped, "23503")).toBe(false);
  });

  it("returns false for a non-object value", () => {
    expect(isPgError(null, "23503")).toBe(false);
    expect(isPgError(undefined, "23503")).toBe(false);
    expect(isPgError("nope", "23503")).toBe(false);
  });
});

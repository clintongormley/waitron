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
// pre-check plus the DB's transport CHECK + partial UNIQUE — none of which is a CONCURRENCY or
// deployment-role-privilege property. The CHECK/UNIQUE integrity is already proven on real Postgres in
// packages/db's printing.test.ts, so the heavier target buys this suite nothing (CLAUDE.md §4). The
// explicit `tenant_id` the verb writes/reads is what scopes these rows.
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

/** Create a network_tcp printer and return its id. */
async function seedPrinter(cfg: PrintConfig, name = "Kitchen"): Promise<string> {
  const { id } = await asTx(cfg, (tx) =>
    createPrinter(tx, cfg, { name, transport: "network_tcp", host: "10.0.0.9" }),
  );
  return id;
}

async function fullRow(printerId: string): Promise<{
  name: string;
  host: string | null;
  local_key: string | null;
  ticket_scope: string;
  active: boolean;
}> {
  const { rows } = await suite.db.execute<{
    name: string;
    host: string | null;
    local_key: string | null;
    ticket_scope: string;
    active: boolean;
  }>(sql`select name, host, local_key, ticket_scope, active from printers where id = ${printerId}`);
  return rows[0]!;
}

describe("createPrinter", () => {
  it("inserts a network_tcp printer; an omitted port defaults to 9100", async () => {
    const cfg = await setup();
    // port deliberately OMITTED — this is the receipt for the "drizzle omits undefined → the column
    // default applies" claim in printers.ts: the stored port must be 9100, not NULL.
    const { id } = await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, { name: "Kitchen", transport: "network_tcp", host: "10.0.0.9" }),
    );
    const row = await printerRow(id);
    expect(row.transport).toBe("network_tcp");
    expect(row.port).toBe(9100);
  });

  it("creates a usb printer from a serial", async () => {
    const cfg = await setup();
    expect(
      (
        await asTx(cfg, (tx) =>
          createPrinter(tx, cfg, { name: "Cocina", transport: "usb", localKey: "SN-1" }),
        )
      ).id,
    ).toBeDefined();
  });

  it("rejects a usb printer with no local_key before any write", async () => {
    const cfg = await setup();
    await expect(
      asTx(cfg, (tx) => createPrinter(tx, cfg, { name: "X", transport: "usb" })),
    ).rejects.toMatchObject({
      code: "printer.invalid_config",
      params: { reason: "usb_missing_localKey" },
    });
  });

  it("maps a duplicate local_key to printer.already_registered", async () => {
    const cfg = await setup();
    await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, { name: "A", transport: "usb", localKey: "SN-DUP" }),
    );
    await expect(
      asTx(cfg, (tx) =>
        createPrinter(tx, cfg, { name: "B", transport: "usb", localKey: "SN-DUP" }),
      ),
    ).rejects.toMatchObject({ code: "printer.already_registered", params: { localKey: "SN-DUP" } });
  });

  it("creates a bluetooth printer from a MAC", async () => {
    const cfg = await setup();
    await expect(
      asTx(cfg, (tx) =>
        createPrinter(tx, cfg, {
          name: "BT",
          transport: "bluetooth",
          localKey: "AA:BB:CC:DD:EE:FF",
        }),
      ),
    ).resolves.toBeDefined();
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
    expect(
      await codeOf(() =>
        asTx(cfg, (tx) => createPrinter(tx, cfg, { name: "Bad", transport: "network_tcp" })),
      ),
    ).toBe("printer.invalid_config");
  });

  it("rejects a bluetooth printer with no local_key → printer.invalid_config", async () => {
    const cfg = await setup();
    expect(
      await codeOf(() =>
        asTx(cfg, (tx) => createPrinter(tx, cfg, { name: "Bad", transport: "bluetooth" })),
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

describe("updatePrinter", () => {
  it("applies a partial edit (only the named fields change) and 204-equivalents (resolves)", async () => {
    const cfg = await setup();
    const id = await seedPrinter(cfg);
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

  it("clears a nullable field with an explicit null (local_key cleared on a network_tcp printer)", async () => {
    const cfg = await setup();
    const id = await seedPrinter(cfg);
    await asTx(cfg, (tx) => updatePrinter(tx, cfg, id, { localKey: null }));
    expect((await fullRow(id)).local_key).toBeNull();
  });

  it("an EMPTY patch is a no-op on an existing printer, and 404s a missing one", async () => {
    const cfg = await setup();
    const id = await seedPrinter(cfg);
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
    // network_tcp → usb needs local_key; the row has host but no local_key, so the transport-fields
    // CHECK fails on the update. `localKey` is NOT in the patch (undefined), exercising the
    // unique-violation-branch skip.
    const cfg = await setup();
    const id = await seedPrinter(cfg);
    expect(
      await codeOf(() => asTx(cfg, (tx) => updatePrinter(tx, cfg, id, { transport: "usb" }))),
    ).toBe("printer.invalid_config");
  });

  it("a re-key to an already-registered local_key (UNIQUE 23505) → printer.already_registered", async () => {
    const cfg = await setup();
    await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, { name: "Existing", transport: "usb", localKey: "SN-TAKEN" }),
    );
    const id = await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, { name: "Mine", transport: "usb", localKey: "SN-MINE" }),
    ).then((r) => r.id);
    await expect(
      asTx(cfg, (tx) => updatePrinter(tx, cfg, id, { localKey: "SN-TAKEN" })),
    ).rejects.toMatchObject({
      code: "printer.already_registered",
      params: { localKey: "SN-TAKEN" },
    });
  });

  it("a driver error that is NEITHER the UNIQUE NOR the CHECK propagates UNCHANGED (the rethrow branch)", async () => {
    // An invalid enum value reaches the `transport` column as 22P02 — not 23505/23514 — so
    // translatePrinterWriteError must rethrow it rather than mistranslate it to a printing code.
    const cfg = await setup();
    const id = await seedPrinter(cfg);
    const err = await errorOf(() =>
      asTx(cfg, (tx) =>
        updatePrinter(tx, cfg, id, { transport: "carrier_pigeon" as PrintTransport }),
      ),
    );
    expect(err).toBeDefined();
    // NOT translated: the two mapped domain codes must not appear on the rethrown error.
    expect((err as { code?: string }).code).not.toBe("printer.already_registered");
    expect((err as { code?: string }).code).not.toBe("printer.invalid_config");
  });
});

describe("deactivatePrinter", () => {
  it("flips active=false (never a delete) and 404s an unknown id", async () => {
    const cfg = await setup();
    const id = await seedPrinter(cfg);
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
  it("lists printers with local_key, no agentId field", async () => {
    const cfg = await setup();
    await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, { name: "N", transport: "network_tcp", host: "10.0.0.9" }),
    );
    const rows = await asTx(cfg, (tx) => listPrinters(tx, cfg));
    expect(rows[0]).toMatchObject({ transport: "network_tcp", localKey: null, host: "10.0.0.9" });
    expect(rows[0]).not.toHaveProperty("agentId");
  });

  it("lists this tenant's printers by name (active and deactivated)", async () => {
    const cfg = await setup();
    const bId = await seedPrinter(cfg, "Bravo");
    const aId = await seedPrinter(cfg, "Alfa");
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
    expect(isPgError(Object.assign(new Error("unique"), { code: "23505" }), "23505")).toBe(true);
  });

  it("recognises a violation wrapped in a cause chain (drizzle wraps the real error)", () => {
    const inner = Object.assign(new Error("unique"), { code: "23505" });
    expect(
      isPgError(new Error("outer", { cause: new Error("mid", { cause: inner }) }), "23505"),
    ).toBe(true);
  });

  it("does not match a different SQLSTATE", () => {
    expect(isPgError(Object.assign(new Error("check"), { code: "23514" }), "23505")).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const looped: Error & { cause?: unknown } = new Error("loop");
    looped.cause = looped;
    expect(isPgError(looped, "23505")).toBe(false);
  });

  it("returns false for a non-object value", () => {
    expect(isPgError(null, "23505")).toBe(false);
    expect(isPgError(undefined, "23505")).toBe(false);
    expect(isPgError("nope", "23505")).toBe(false);
  });
});

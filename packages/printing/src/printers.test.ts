import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  isPgError,
  locations,
  printers,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { createPrinter, deactivatePrinter, listPrinters, updatePrinter } from "./printers.js";
import type { PrintConfig, PrintTransport } from "./printers.js";
import "./errors.js";

// One venue file (`useVenueDb`). `createPrinter` is a single INSERT gated by an app-layer
// required-field pre-check plus the DB's transport CHECK and partial UNIQUE, and every case below
// runs its transactions one after another, so nothing here turns on two writers contending. The
// CHECK and the partial UNIQUE have their own cases in `packages/db/src/schema/printing.test.ts`;
// what this suite adds on top is this package's own behaviour over them — the error codes those
// refusals are mapped onto, the partial-edit and deactivation paths, the listing, and the layout
// settings.
//
// This engine has no roles and no grants, so no case below is a claim about a privilege
// (`packages/db/src/testing/roles.ts`), and no suite this branch left behind replaces that half.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

/**
 * A fresh tenant + venue per test. Each test gets its OWN tenant (via seedTenant's fresh NIF) so
 * rows are order-independent. There is one handle on the venue file and no role to seed under.
 */
async function setup(): Promise<PrintConfig> {
  await seedTenant(suite.db);
  // Through the table definition rather than raw SQL: `locations.id` is supplied by
  // `$defaultFn(newId)` in JavaScript, so a raw INSERT naming no id is refused
  // `NOT NULL constraint failed: locations.id`.
  const [row] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  return { locationId: row!.id };
}

function asTx<T>(cfg: PrintConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  void cfg;
  return withTransaction(suite.db, fn);
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
  // Read THROUGH the table definition: `active` is the shared `flag` helper, an integer column with
  // a boolean read mapping, so a raw `select active` hands back 0 or 1 and only this route gives the
  // boolean the assertions below are written against.
  const [row] = await suite.db
    .select({
      name: printers.name,
      host: printers.host,
      local_key: printers.localKey,
      ticket_scope: printers.ticketScope,
      active: printers.active,
    })
    .from(printers)
    .where(eq(printers.id, printerId));
  return row!;
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

  it("a CHECK that is NOT the transport-fields one is not dressed up as printer.invalid_config", async () => {
    // `printers` carries seven CHECK constraints and only ONE of them — `printers_transport_fields_ck`
    // — means "this transport is short of a field it needs". A character table outside 0..255 trips
    // `printers_character_table_ck`, which is a different complaint entirely, so translating it to
    // `printer.invalid_config {reason: "transport_fields"}` would tell an operator to fix a field
    // that is not the problem. 16 is accepted (the control, in the update case above), 300 is not.
    const cfg = await setup();
    const id = await seedPrinter(cfg);
    const err = await errorOf(() =>
      asTx(cfg, (tx) => updatePrinter(tx, cfg, id, { characterTable: 300 })),
    );
    expect(err).toBeDefined();
    expect((err as { code?: string }).code).not.toBe("printer.invalid_config");
  });

  it("a driver error that is NEITHER the UNIQUE NOR the CHECK propagates UNCHANGED (the rethrow branch)", async () => {
    // A transport the column's own CHECK does not allow. It was an invalid ENUM value on
    // PostgreSQL, arriving as 22P02 and matching neither translated class; `transport` is a text
    // column with `printers_transport_ck` here, so the refusal is now a CHECK — but not the
    // transport-fields one, and translatePrinterWriteError must still rethrow it rather than
    // mistranslate it to a printing code.
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
      sql`select count(*) as n from printers where id = ${id}`,
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

// The refusal a driver reports is a numeric extended RESULT CODE on `errcode`, not a five-character
// SQLSTATE on `code` — `code` is the constant "ERR_SQLITE_ERROR" on every failure alike, so nothing
// reads it (`packages/db/src/sql-state.ts`). The codes below are the ones that suite measured:
// 2067 a unique index, 275 a CHECK. Every case in this block kept its subject; what changed is the
// spelling of a refusal.
describe("isPgError (@waitron/db result-code cause-walk, as printers.ts uses it)", () => {
  it("recognises a bare driver error", () => {
    expect(isPgError(Object.assign(new Error("unique"), { errcode: 2067 }), UNIQUE_VIOLATION)).toBe(
      true,
    );
  });

  it("recognises a violation wrapped in a cause chain (drizzle wraps the real error)", () => {
    const inner = Object.assign(new Error("unique"), { errcode: 2067 });
    expect(
      isPgError(
        new Error("outer", { cause: new Error("mid", { cause: inner }) }),
        UNIQUE_VIOLATION,
      ),
    ).toBe(true);
  });

  it("does not match a different class of refusal", () => {
    expect(isPgError(Object.assign(new Error("check"), { errcode: 275 }), UNIQUE_VIOLATION)).toBe(
      false,
    );
  });

  it("terminates on a self-referential cause chain", () => {
    const looped: Error & { cause?: unknown; errcode?: number } = new Error("loop");
    looped.cause = looped;
    // The loop carries no result code of its own, so what this case proves is that the walk
    // RETURNS rather than spinning — with a code on it the answer would be true either way.
    expect(isPgError(looped, UNIQUE_VIOLATION)).toBe(false);
  });

  it("returns false for a non-object value", () => {
    expect(isPgError(null, UNIQUE_VIOLATION)).toBe(false);
    expect(isPgError(undefined, UNIQUE_VIOLATION)).toBe(false);
    expect(isPgError("nope", UNIQUE_VIOLATION)).toBe(false);
  });
});

describe("printer layout settings", () => {
  it("defaults to 80mm, 180dpi, wpc1252 table 16, and stores, updates and lists each setting", async () => {
    const cfg = await setup();
    const defaulted = await seedPrinter(cfg, "Defaults");
    const { id } = await asTx(cfg, (tx) =>
      createPrinter(tx, cfg, {
        name: "Narrow",
        transport: "network_tcp",
        host: "10.0.0.10",
        paperWidth: "58mm",
        characterSet: "pc858",
        characterTable: 19,
      }),
    );
    await asTx(cfg, (tx) =>
      updatePrinter(tx, cfg, id, { resolution: "203dpi", characterTable: 6 }),
    );
    const rows = await asTx(cfg, (tx) => listPrinters(tx, cfg));
    expect(rows.find((r) => r.id === defaulted)).toMatchObject({
      paperWidth: "80mm",
      resolution: "180dpi",
      characterSet: "wpc1252",
      characterTable: 16,
    });
    expect(rows.find((r) => r.id === id)).toMatchObject({
      paperWidth: "58mm",
      resolution: "203dpi",
      characterSet: "pc858",
      characterTable: 6,
    });
  });
});

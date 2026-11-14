import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  isRefusal,
  printers,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import { randomUUID } from "node:crypto";
import { createPrinter, listPrinters, updatePrinter } from "./printers.js";
import type { PaperWidth } from "./layout.js";
import type { PrintTransport } from "./printers.js";

import "./errors.js";

// The CHECK and the partial UNIQUE have their own cases in `packages/db/src/schema/printing.test.ts`;
// this suite covers the error codes those refusals are mapped onto.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function setup(): Promise<void> {
  await seedVenue(suite.db, {
    name: "Bar",
    invoiceLocales: ["es-ES"],
    operationDescription: "Sale on premises",
  });
}

function asTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
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
async function seedPrinter(name = "Kitchen"): Promise<string> {
  const { id } = await asTx((tx) =>
    createPrinter(tx, { name, transport: "network_tcp", host: "10.0.0.9" }),
  );
  return id;
}

async function fullRow(printerId: string): Promise<{
  name: string;
  host: string | null;
  local_key: string | null;
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
      active: printers.active,
    })
    .from(printers)
    .where(eq(printers.id, printerId));
  return row!;
}

describe("createPrinter", () => {
  it.each([
    { transport: "usb" as const, localKey: "RESTORE-USB" },
    { transport: "bluetooth" as const, localKey: "AA:BB:CC:DD:EE:19" },
    { transport: "network_tcp" as const, host: "10.0.0.19" },
    { transport: "cloud_poll" as const, pollId: "restore-poll" },
  ])("Add restores a retained $transport printer with its saved settings", async (endpoint) => {
    await setup();
    const { id } = await asTx((tx) =>
      createPrinter(tx, {
        ...endpoint,
        name: "Saved printer",
        paperWidth: "58mm",
        resolution: "203dpi",
        hasCashDrawer: true,
        portable: true,
        pickupRoles: ["receipt"],
      }),
    );
    for (const deletedAt of [null, "2026-11-10T12:00:00.000Z"]) {
      await asTx((tx) =>
        tx.update(printers).set({ active: false, deletedAt }).where(eq(printers.id, id)),
      );
      const added = await asTx((tx) => createPrinter(tx, { ...endpoint, name: "Scanned name" }));
      expect(added.id).toBe(id);
      const [restored] = await suite.db.select().from(printers).where(eq(printers.id, id));
      expect(restored).toMatchObject({
        name: "Saved printer",
        active: true,
        deletedAt: null,
        paperWidth: "58mm",
        resolution: "203dpi",
        hasCashDrawer: true,
        portable: true,
        pickupRoles: ["receipt"],
      });
    }
  });

  it("restores the latest deleted endpoint, but keeps active network Add as an insertion", async () => {
    await setup();
    const endpoint = { transport: "network_tcp" as const, host: "10.0.0.29", port: 9200 };
    const older = await asTx((tx) => createPrinter(tx, { ...endpoint, name: "Older" }));
    const newer = await asTx((tx) => createPrinter(tx, { ...endpoint, name: "Newer" }));
    await asTx(async (tx) => {
      await tx
        .update(printers)
        .set({ active: false, deletedAt: "2026-11-09T12:00:00.000Z" })
        .where(eq(printers.id, older.id));
      await tx
        .update(printers)
        .set({ active: false, deletedAt: "2026-11-10T12:00:00.000Z" })
        .where(eq(printers.id, newer.id));
    });
    expect((await asTx((tx) => createPrinter(tx, { ...endpoint, name: "Scan" }))).id).toBe(
      newer.id,
    );
    const fresh = await asTx((tx) => createPrinter(tx, { ...endpoint, name: "Another" }));
    expect(fresh.id).not.toBe(newer.id);
    expect(fresh.id).not.toBe(older.id);
    await asTx((tx) =>
      tx.update(printers).set({ active: false, deletedAt: null }).where(eq(printers.id, older.id)),
    );
    const another = await asTx((tx) => createPrinter(tx, { ...endpoint, name: "Third active" }));
    expect(another.id).not.toBe(older.id);
    expect(another.id).not.toBe(newer.id);
    expect(another.id).not.toBe(fresh.id);
  });

  it("lists printers with no watcherId", async () => {
    await setup();
    const kitchen = await seedPrinter("Kitchen");
    const listed = await asTx((tx) => listPrinters(tx));
    expect(listed.map((printer) => printer.id)).toContain(kitchen);
    for (const printer of listed) expect(printer).not.toHaveProperty("watcherId");
  });
  it("inserts a network_tcp printer; an omitted port defaults to 9100", async () => {
    await setup();
    // port deliberately OMITTED: the stored port must be the column default 9100, not NULL.
    const { id } = await asTx((tx) =>
      createPrinter(tx, { name: "Kitchen", transport: "network_tcp", host: "10.0.0.9" }),
    );
    const row = await printerRow(id);
    expect(row.transport).toBe("network_tcp");
    expect(row.port).toBe(9100);
  });

  it("creates a usb printer from a serial", async () => {
    await setup();
    expect(
      (
        await asTx((tx) =>
          createPrinter(tx, { name: "Pantry", transport: "usb", localKey: "SN-1" }),
        )
      ).id,
    ).toBeDefined();
  });

  it("rejects a usb printer with no local_key before any write", async () => {
    await setup();
    await expect(
      asTx((tx) => createPrinter(tx, { name: "X", transport: "usb" })),
    ).rejects.toMatchObject({
      code: "printer.invalid_config",
      params: { reason: "usb_missing_localKey" },
    });
  });

  it("maps a duplicate local_key to printer.already_registered", async () => {
    await setup();
    await asTx((tx) => createPrinter(tx, { name: "A", transport: "usb", localKey: "SN-DUP" }));
    await expect(
      asTx((tx) => createPrinter(tx, { name: "B", transport: "usb", localKey: "SN-DUP" })),
    ).rejects.toMatchObject({ code: "printer.already_registered", params: { localKey: "SN-DUP" } });
  });

  it("creates a bluetooth printer from a MAC", async () => {
    await setup();
    await expect(
      asTx((tx) =>
        createPrinter(tx, {
          name: "BT",
          transport: "bluetooth",
          localKey: "AA:BB:CC:DD:EE:FF",
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("inserts an agent-less cloud_poll printer", async () => {
    await setup();
    const { id } = await asTx((tx) =>
      createPrinter(tx, { name: "Cloud", transport: "cloud_poll", pollId: "poll-123" }),
    );
    expect((await printerRow(id)).transport).toBe("cloud_poll");
  });

  it("rejects a network_tcp printer with no host → printer.invalid_config", async () => {
    await setup();
    expect(
      await codeOf(() =>
        asTx((tx) => createPrinter(tx, { name: "Bad", transport: "network_tcp" })),
      ),
    ).toBe("printer.invalid_config");
  });

  it("rejects a bluetooth printer with no local_key → printer.invalid_config", async () => {
    await setup();
    expect(
      await codeOf(() => asTx((tx) => createPrinter(tx, { name: "Bad", transport: "bluetooth" }))),
    ).toBe("printer.invalid_config");
  });

  it("rejects a cloud_poll printer with no poll_id → printer.invalid_config", async () => {
    await setup();
    expect(
      await codeOf(() => asTx((tx) => createPrinter(tx, { name: "Bad", transport: "cloud_poll" }))),
    ).toBe("printer.invalid_config");
  });
});

describe("updatePrinter", () => {
  it("applies a partial edit (only the named fields change) and 204-equivalents (resolves)", async () => {
    await setup();
    const id = await seedPrinter();
    // Every editable field present at once — so each `if (patch.X !== undefined)` set-branch is
    // exercised (port/pollId/active included). The extra pollId on a network_tcp row is allowed: the
    // CHECK asserts the transport's REQUIRED fields are present, not that the others are absent.
    await asTx((tx) =>
      updatePrinter(tx, id, {
        name: "Kitchen 2",
        host: "10.0.0.20",
        port: 9200,
        pollId: "poll-extra",
        active: false,
      }),
    );
    const row = await fullRow(id);
    expect(row.name).toBe("Kitchen 2");
    expect(row.host).toBe("10.0.0.20");
    expect(row.active).toBe(false);
    const { rows } = await suite.db.execute<{ port: number; poll_id: string | null }>(
      sql`select port, poll_id from printers where id = ${id}`,
    );
    expect(rows[0]!.port).toBe(9200);
    expect(rows[0]!.poll_id).toBe("poll-extra");
  });

  it("clears a nullable field with an explicit null (local_key cleared on a network_tcp printer)", async () => {
    await setup();
    const id = await seedPrinter();
    await asTx((tx) => updatePrinter(tx, id, { localKey: null }));
    expect((await fullRow(id)).local_key).toBeNull();
  });

  it("an EMPTY patch is a no-op on an existing printer, and 404s a missing one", async () => {
    await setup();
    const id = await seedPrinter();
    // Empty patch, existing id → resolves (no-op), never a drizzle "No values to set" throw.
    await expect(asTx((tx) => updatePrinter(tx, id, {}))).resolves.toBeUndefined();
    expect(await codeOf(() => asTx((tx) => updatePrinter(tx, randomUUID(), {})))).toBe(
      "printer.not_found",
    );
  });

  it("an unknown printer id → printer.not_found", async () => {
    await setup();
    expect(await codeOf(() => asTx((tx) => updatePrinter(tx, randomUUID(), { name: "X" })))).toBe(
      "printer.not_found",
    );
  });

  it("a transport change that leaves a required field absent → printer.invalid_config", async () => {
    // network_tcp → usb needs local_key; the row has host but no local_key, so the transport-fields
    // CHECK fails on the update. `localKey` is NOT in the patch (undefined), exercising the
    // unique-violation-branch skip.
    await setup();
    const id = await seedPrinter();
    expect(await codeOf(() => asTx((tx) => updatePrinter(tx, id, { transport: "usb" })))).toBe(
      "printer.invalid_config",
    );
  });

  it("a re-key to an already-registered local_key → printer.already_registered", async () => {
    await setup();
    await asTx((tx) =>
      createPrinter(tx, { name: "Existing", transport: "usb", localKey: "SN-TAKEN" }),
    );
    const id = await asTx((tx) =>
      createPrinter(tx, { name: "Mine", transport: "usb", localKey: "SN-MINE" }),
    ).then((r) => r.id);
    await expect(
      asTx((tx) => updatePrinter(tx, id, { localKey: "SN-TAKEN" })),
    ).rejects.toMatchObject({
      code: "printer.already_registered",
      params: { localKey: "SN-TAKEN" },
    });
  });

  it("a CHECK that is NOT the transport-fields one is not dressed up as printer.invalid_config", async () => {
    // Only `printers_transport_fields_ck` means "this transport is short of a field it needs". A
    // paper width the schema does not list trips `printers_paper_width_ck`, a different complaint, so
    // translating it to `printer.invalid_config` would send an operator to the wrong field.
    await setup();
    const id = await seedPrinter();
    const err = await errorOf(() =>
      asTx((tx) => updatePrinter(tx, id, { paperWidth: "100mm" as PaperWidth })),
    );
    expect(err).toMatchObject({
      errcode: CHECK_VIOLATION[0],
      message: "CHECK constraint failed: printers_paper_width_ck",
    });
  });

  it("printers_transport_ck, a CHECK other than the transport-fields one, is rethrown as the engine's own refusal", async () => {
    await setup();
    const id = await seedPrinter();
    const err = await errorOf(() =>
      asTx((tx) => updatePrinter(tx, id, { transport: "carrier_pigeon" as PrintTransport })),
    );
    expect(err).toMatchObject({
      errcode: CHECK_VIOLATION[0],
      message: "CHECK constraint failed: printers_transport_ck",
    });
  });
});

describe("a deleted printer", () => {
  async function markDeleted(id: string): Promise<void> {
    // Deletion is set independently of `active`, so a predicate that reads only `active` fails here.
    await asTx((tx) =>
      tx
        .update(printers)
        .set({ deletedAt: "2026-10-09T10:00:00.000Z", active: true })
        .where(eq(printers.id, id)),
    );
  }

  it("deleted printer refuses empty patch and Enable, disabled can Enable", async () => {
    await setup();
    const id = await seedPrinter();
    await markDeleted(id);
    for (const patch of [{}, { active: true }, { name: "Renamed" }]) {
      await expect(asTx((tx) => updatePrinter(tx, id, patch))).rejects.toMatchObject({
        code: "printer.not_found",
      });
    }
    expect(await asTx((tx) => listPrinters(tx))).toEqual([]);
    const disabled = await seedPrinter("Disabled control");
    await asTx((tx) => updatePrinter(tx, disabled, { active: false }));
    await asTx((tx) => updatePrinter(tx, disabled, { active: true }));
    expect((await asTx((tx) => listPrinters(tx))).map((p) => p.id)).toEqual([disabled]);
  });

  it("updatePrinter refuses a deleted printer and leaves it unchanged", async () => {
    await setup();
    const id = await seedPrinter();
    await markDeleted(id);
    await expect(asTx((tx) => updatePrinter(tx, id, { active: false }))).rejects.toMatchObject({
      code: "printer.not_found",
    });
    expect((await fullRow(id)).active).toBe(true);
  });

  it("a deleted printer's local_key can be registered again", async () => {
    await setup();
    const { id: first } = await asTx((tx) =>
      createPrinter(tx, { name: "Old", transport: "usb", localKey: "SN-REUSE" }),
    );
    await markDeleted(first);
    const { id: second } = await asTx((tx) =>
      createPrinter(tx, { name: "Old", transport: "usb", localKey: "SN-REUSE" }),
    );
    expect(second).toBe(first);
    expect((await asTx((tx) => listPrinters(tx))).map((p) => p.id)).toEqual([second]);
  });
});

describe("updatePrinter", () => {
  it("flips active=false (never a delete) and 404s an unknown id", async () => {
    await setup();
    const id = await seedPrinter();
    await asTx((tx) => updatePrinter(tx, id, { active: false }));
    expect((await fullRow(id)).active).toBe(false);
    const { rows } = await suite.db.execute<{ n: number }>(
      sql`select count(*) as n from printers where id = ${id}`,
    );
    expect(rows[0]!.n).toBe(1);
    expect(
      await codeOf(() => asTx((tx) => updatePrinter(tx, randomUUID(), { active: false }))),
    ).toBe("printer.not_found");
  });
});

describe("listPrinters", () => {
  it("lists printers with local_key, no agentId field", async () => {
    await setup();
    await asTx((tx) =>
      createPrinter(tx, { name: "N", transport: "network_tcp", host: "10.0.0.9" }),
    );
    const rows = await asTx((tx) => listPrinters(tx));
    expect(rows[0]).toMatchObject({ transport: "network_tcp", localKey: null, host: "10.0.0.9" });
    expect(rows[0]).not.toHaveProperty("agentId");
  });

  it("lists this tenant's printers by name (active and deactivated)", async () => {
    await setup();
    const bId = await seedPrinter("Bravo");
    const aId = await seedPrinter("Alfa");
    await asTx((tx) => updatePrinter(tx, bId, { active: false }));
    const rows = await asTx((tx) => listPrinters(tx));
    const mine = rows.filter((r) => r.id === aId || r.id === bId);
    expect(mine.map((r) => r.name)).toEqual(["Alfa", "Bravo"]);
    expect(mine.find((r) => r.id === bId)!.active).toBe(false);
    expect(mine.find((r) => r.id === aId)!.port).toBe(9100);
  });
});

// The driver reports a refusal as a numeric extended result code on `errcode` — 2067 a unique index,
// 275 a CHECK (`packages/db/src/sql-state.ts`).
describe("isRefusal (@waitron/db result-code cause-walk, as printers.ts uses it)", () => {
  it("recognises a bare driver error", () => {
    expect(isRefusal(Object.assign(new Error("unique"), { errcode: 2067 }), UNIQUE_VIOLATION)).toBe(
      true,
    );
  });

  it("recognises a violation wrapped in a cause chain (drizzle wraps the real error)", () => {
    const inner = Object.assign(new Error("unique"), { errcode: 2067 });
    expect(
      isRefusal(
        new Error("outer", { cause: new Error("mid", { cause: inner }) }),
        UNIQUE_VIOLATION,
      ),
    ).toBe(true);
  });

  it("does not match a different class of refusal", () => {
    expect(isRefusal(Object.assign(new Error("check"), { errcode: 275 }), UNIQUE_VIOLATION)).toBe(
      false,
    );
  });

  it("terminates on a self-referential cause chain", () => {
    const looped: Error & { cause?: unknown; errcode?: number } = new Error("loop");
    looped.cause = looped;
    // The loop carries no result code of its own, so what this case proves is that the walk
    // RETURNS rather than spinning — with a code on it the answer would be true either way.
    expect(isRefusal(looped, UNIQUE_VIOLATION)).toBe(false);
  });

  it("returns false for a non-object value", () => {
    expect(isRefusal(null, UNIQUE_VIOLATION)).toBe(false);
    expect(isRefusal(undefined, UNIQUE_VIOLATION)).toBe(false);
    expect(isRefusal("nope", UNIQUE_VIOLATION)).toBe(false);
  });
});

describe("printer layout settings", () => {
  it("defaults to 80mm and 180dpi, and stores, updates and lists each setting", async () => {
    await setup();
    const defaulted = await seedPrinter("Defaults");
    const { id } = await asTx((tx) =>
      createPrinter(tx, {
        name: "Narrow",
        transport: "network_tcp",
        host: "10.0.0.10",
        paperWidth: "58mm",
      }),
    );
    await asTx((tx) => updatePrinter(tx, id, { resolution: "203dpi" }));
    const rows = await asTx((tx) => listPrinters(tx));
    expect(rows.find((r) => r.id === defaulted)).toMatchObject({
      paperWidth: "80mm",
      resolution: "180dpi",
    });
    expect(rows.find((r) => r.id === id)).toMatchObject({
      paperWidth: "58mm",
      resolution: "203dpi",
    });
  });
});

it("lists pick-up roles as a set so repeated roles do not appear as multiple choices", async () => {
  await setup();
  const { id } = await asTx((tx) =>
    createPrinter(tx, {
      name: "Receipt only",
      transport: "network_tcp",
      host: "10.0.0.8",
      pickupRoles: ["receipt", "receipt"],
    }),
  );
  const listed = await asTx((tx) => listPrinters(tx));
  expect(listed.find((row) => row.id === id)!.pickupRoles).toEqual(["receipt"]);
});

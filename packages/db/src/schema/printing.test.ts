import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  UNIQUE_VIOLATION,
} from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { withTransaction } from "../tenancy.js";
import { printAgents } from "./print-agents.js";
import { printJobs } from "./print-jobs.js";
import { printers } from "./printers.js";
import { locations, tenants } from "./tenants.js";

// What this suite proves is the column mapping, the defaults, the CHECKs and the foreign keys.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const GHOST_LOCATION = "dddddddd-0000-4000-8000-000000000099";
const TOKEN_HASH = "scrypt$00$00";
const HELLO = new TextEncoder().encode("Hello");

describe("printing schema (print_agents/printers/print_jobs — columns, CHECKs, FKs)", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: false });

  beforeAll(async () => {
    await suite.db
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await suite.db.insert(locations).values({
      id: LOCATION_A,
      name: "Loc A",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    });
  });

  function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, fn);
  }

  // Seeds go through Drizzle: `$defaultFn` columns are filled client-side, so a raw insert is
  // refused NOT NULL.
  async function seedAgent(name: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(printAgents)
        .values({ locationId: LOCATION_A, name, tokenHash: TOKEN_HASH })
        .returning({ id: printAgents.id });
      return row!.id;
    });
  }

  async function seedPrinter(name: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(printers)
        .values({ locationId: LOCATION_A, name, transport: "network_tcp", host: "10.0.0.5" })
        .returning({ id: printers.id });
      return row!.id;
    });
  }

  async function seedJob(printer: string): Promise<string> {
    return inTx(async (tx) => {
      const [row] = await tx
        .insert(printJobs)
        .values({ locationId: LOCATION_A, printerId: printer, payload: HELLO })
        .returning({ id: printJobs.id });
      return row!.id;
    });
  }

  function insertPrinter(opts: {
    transport: "usb" | "network_tcp" | "bluetooth" | "cloud_poll";
    name?: string;
    localKey?: string | null;
    host?: string | null;
    pollId?: string | null;
  }): Promise<{ id: string }[]> {
    return inTx((tx) =>
      tx
        .insert(printers)
        .values({
          locationId: LOCATION_A,
          name: opts.name ?? "Probe printer",
          transport: opts.transport,
          localKey: opts.localKey ?? null,
          host: opts.host ?? null,
          pollId: opts.pollId ?? null,
        })
        .returning({ id: printers.id }),
    );
  }

  // ---- print_agents -------------------------------------------------------------------------

  it("print_agents: exposes every column through the Drizzle export, with the active default", async () => {
    const id = await seedAgent("Kitchen USB agent");
    await inTx((tx) =>
      tx
        .update(printAgents)
        .set({ lastSeenAt: new Date().toISOString() })
        .where(eq(printAgents.id, id)),
    );
    const [row] = await inTx((tx) => tx.select().from(printAgents).where(eq(printAgents.id, id)));
    expect(row!.name).toBe("Kitchen USB agent");
    expect(row!.locationId).toBe(LOCATION_A);
    expect(row!.active).toBe(true);
    expect(row!.lastSeenAt).not.toBeNull();
  });

  it("print_agents: the location FK rejects a non-existent location (direct location_id → locations.id)", async () => {
    const e = await captureError(() =>
      inTx((tx) =>
        tx
          .insert(printAgents)
          .values({ locationId: GHOST_LOCATION, name: "Ghost location", tokenHash: TOKEN_HASH }),
      ),
    );
    expect(isRefusal(e, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("print_agent_pairing_codes no longer exists (join-and-accept replaced the pairing code)", () => {
    // Read the catalogue rather than catch a failing select: `no such table` carries the generic
    // result code every other statement error shares, so the catch would pass for any reason.
    const found = suite.db.all<{ name: string }>(
      sql`select name from sqlite_master where name = 'print_agent_pairing_codes'`,
    );
    expect(found).toEqual([]);
    // Control: a table that is there is found by the same read.
    const control = suite.db.all<{ name: string }>(
      sql`select name from sqlite_master where name = 'print_agents'`,
    );
    expect(control).toHaveLength(1);
  });

  it("allows many NULL node_id agents but at most one per node_id", async () => {
    await seedAgent("till A");
    await seedAgent("till B");

    const node = "cccccccc-0000-4000-8000-000000000001";
    await inTx((tx) =>
      tx
        .insert(printAgents)
        .values({ locationId: LOCATION_A, name: "box", tokenHash: TOKEN_HASH, nodeId: node }),
    );
    const err = await captureError(() =>
      inTx((tx) =>
        tx.insert(printAgents).values({
          locationId: LOCATION_A,
          name: "box dup",
          tokenHash: TOKEN_HASH,
          nodeId: node,
        }),
      ),
    );
    expect(isRefusal(err, UNIQUE_VIOLATION)).toBe(true);
  });

  // ---- printers -----------------------------------------------------------------------------

  it("printers: exposes every column through the Drizzle export, with the port and ticket_scope defaults", async () => {
    const id = await seedPrinter("Kitchen printer");
    await inTx((tx) => tx.update(printers).set({ active: false }).where(eq(printers.id, id)));
    const [row] = await inTx((tx) => tx.select().from(printers).where(eq(printers.id, id)));
    expect(row!.name).toBe("Kitchen printer");
    expect(row!.transport).toBe("network_tcp");
    expect(row!.localKey).toBeNull();
    expect(row!.host).toBe("10.0.0.5");
    expect(row!.port).toBe(9100);
    expect(row!.ticketScope).toBe("station");
    expect(row!.paperWidth).toBe("80mm");
    expect(row!.resolution).toBe("180dpi");
    expect(row!.characterSet).toBe("wpc1252");
    expect(row!.characterTable).toBe(16);
    expect(row!.active).toBe(false);

    await inTx((tx) => tx.update(printers).set({ characterTable: 6 }).where(eq(printers.id, id)));
    const [updated] = await inTx((tx) =>
      tx
        .select({ characterTable: printers.characterTable })
        .from(printers)
        .where(eq(printers.id, id)),
    );
    expect(updated!.characterTable).toBe(6);
  });

  it("printers: rejects a character table outside the ESC/POS byte range", async () => {
    const err = await captureError(() =>
      inTx((tx) =>
        tx.insert(printers).values({
          locationId: LOCATION_A,
          name: "Bad table",
          transport: "network_tcp",
          host: "10.0.0.6",
          characterTable: 256,
        }),
      ),
    );
    expect(isRefusal(err, CHECK_VIOLATION)).toBe(true);
  });

  it("printers: the transport-fields CHECK admits a well-formed cloud_poll printer", async () => {
    const [cloud] = await insertPrinter({
      transport: "cloud_poll",
      name: "Cloud printer",
      pollId: "poll-abc",
    });
    expect(cloud!.id).toBeDefined();
  });

  // ---- print_jobs ---------------------------------------------------------------------------

  it("print_jobs: round-trips the binary payload and the delivery lifecycle columns", async () => {
    const printer = await seedPrinter("Printer for job");
    const id = await seedJob(printer);
    await inTx((tx) =>
      tx
        .update(printJobs)
        .set({ status: "done", deliveredAt: new Date().toISOString(), attempts: sql`attempts + 1` })
        .where(eq(printJobs.id, id)),
    );
    const [row] = await inTx((tx) => tx.select().from(printJobs).where(eq(printJobs.id, id)));
    expect(row!.printerId).toBe(printer);
    expect(row!.status).toBe("done");
    expect(row!.kind).toBe("document");
    expect(row!.attempts).toBe(1);
    expect(row!.deliveredAt).not.toBeNull();
    // `Buffer.isBuffer` is the discriminating assertion: a Buffer is also a Uint8Array, so
    // `instanceof Uint8Array` would hold either way.
    expect(Buffer.isBuffer(row!.payload)).toBe(false);
    expect(new TextDecoder().decode(row!.payload)).toBe("Hello");
  });

  it("print_jobs: stores a drawer command kind", async () => {
    const printer = await seedPrinter("Drawer command");
    const [job] = await inTx((tx) =>
      tx
        .insert(printJobs)
        .values({
          locationId: LOCATION_A,
          printerId: printer,
          payload: new Uint8Array([27, 112, 0, 25, 250]),
          kind: "drawer",
        })
        .returning(),
    );
    expect(job!.kind).toBe("drawer");
  });

  it.each([
    { kind: "unknown", refusal: CHECK_VIOLATION },
    { kind: null, refusal: NOT_NULL_VIOLATION },
  ])("print_jobs: refuses kind $kind", async ({ kind, refusal }) => {
    const printer = await seedPrinter(`Bad kind ${kind}`);
    // Raw SQL, because `kind`'s TypeScript type admits only the two labels; `id` and `created_at`
    // are `$defaultFn` columns, so the statement supplies them.
    const error = await captureError(() =>
      inTx(async (tx) =>
        tx.run(
          sql`insert into print_jobs (id, location_id, printer_id, payload, kind, created_at)
              values (${`job-${String(kind)}`}, ${LOCATION_A}, ${printer}, x'1b700019fa',
                      ${kind}, ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isRefusal(error, refusal)).toBe(true);
  });

  it("printers: rejects a usb printer with no local_key (the transport-fields CHECK)", async () => {
    const e = await captureError(() => insertPrinter({ transport: "usb", localKey: null }));
    expect(isRefusal(e, CHECK_VIOLATION)).toBe(true);
  });

  it("printers: accepts usb keyed on a serial and bluetooth keyed on a MAC", async () => {
    const usb = await insertPrinter({ transport: "usb", localKey: "SN-ABC123" });
    expect(usb[0]!.id).toBeDefined();
    const bt = await insertPrinter({
      transport: "bluetooth",
      localKey: "AA:BB:CC:DD:EE:FF",
    });
    expect(bt[0]!.id).toBeDefined();
  });

  it("printers: rejects a network_tcp printer with no host (the transport-fields CHECK)", async () => {
    const e = await captureError(() => insertPrinter({ transport: "network_tcp", host: null }));
    expect(isRefusal(e, CHECK_VIOLATION)).toBe(true);
  });

  it("printers: rejects a second registration of the same (location, local_key)", async () => {
    await insertPrinter({ transport: "usb", localKey: "SN-DUP" });
    const e = await captureError(() => insertPrinter({ transport: "usb", localKey: "SN-DUP" }));
    expect(isRefusal(e, UNIQUE_VIOLATION)).toBe(true);
  });

  it("printers: allows two NULL-local_key printers in one location (partial index)", async () => {
    const a = await insertPrinter({ transport: "network_tcp", host: "10.0.0.1" });
    expect(a[0]!.id).toBeDefined();
    const b = await insertPrinter({ transport: "network_tcp", host: "10.0.0.2" });
    expect(b[0]!.id).toBeDefined();
  });

  it("printers: the old (agent_id) FK and the agent_id/usb_path columns are gone", () => {
    // SQLite stores no name for a foreign key, so this asks whether any key on `printers` points
    // at `print_agents`.
    const keys = suite.db.all<{ table: string }>(
      sql.raw(`select "table" from pragma_foreign_key_list('printers')`),
    );
    expect(keys.filter((key) => key.table === "print_agents")).toEqual([]);
    // Control: the read finds the foreign key that is there.
    expect(keys.filter((key) => key.table === "locations")).toHaveLength(1);
    const cols = suite.db.all<{ name: string }>(
      sql`select name from pragma_table_info('printers')
           where name in ('agent_id', 'usb_path')`,
    );
    expect(cols).toEqual([]);
  });

  it("print_jobs: accepts claimed_by naming an agent, and NULL", async () => {
    const agentA = await seedAgent("Agent A claim ok");
    const printerA = await seedPrinter("Printer A claim ok");
    const claimed = await inTx((tx) =>
      tx
        .insert(printJobs)
        .values({
          locationId: LOCATION_A,
          printerId: printerA,
          payload: new Uint8Array([0]),
          claimedBy: agentA,
        })
        .returning({ id: printJobs.id }),
    );
    expect(claimed[0]!.id).toBeDefined();
    const queued = await seedJob(printerA);
    expect(queued).toBeDefined();
  });
});

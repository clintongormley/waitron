import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTransaction } from "../tenancy.js";
import { printAgents } from "./print-agents.js";
import { printJobs } from "./print-jobs.js";
import { printers } from "./printers.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// cases retain the role switch so the reads and writes still exercise app_user grants.
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
// A location id that is never seeded — the negative for the direct location_id → locations.id FK.
const GHOST_LOCATION = "dddddddd-0000-4000-8000-000000000099";
// A non-null token_hash fixture (shape only — the DB stores it as opaque text; the real scrypt value
// comes from hashSecret in a later task).
const TOKEN_HASH = "scrypt$00$00";

describe("printing schema (print_agents/printers/print_jobs — columns, CHECKs, FKs)", () => {
  const suite = useTemplateDb({ template: "core", resetPerTest: false });

  beforeAll(async () => {
    await suite.admin
      .insert(tenants)
      .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    // The location — the direct location_id → locations.id FK target. operation_description
    // is Spanish test DATA, not a schema identifier, exactly as the sibling tests use 'Hostelería'.
    await suite.admin.execute(sql`
      insert into locations (id, name, invoice_locales, operation_description) values (${LOCATION_A}, 'Loc A', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
  });

  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.admin, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  async function seedAgent(name: string): Promise<string> {
    return asApp(async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into print_agents (location_id, name, token_hash) values (${LOCATION_A}, ${name}, ${TOKEN_HASH}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  // A network_tcp printer (host satisfies the transport CHECK). No stored agent binding — an agent is
  // discovered at run time, so a printer names none.
  async function seedPrinter(name: string): Promise<string> {
    return asApp(async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into printers (location_id, name, transport, host) values (${LOCATION_A}, ${name}, 'network_tcp', '10.0.0.5')
            returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  async function seedJob(printer: string): Promise<string> {
    return asApp(async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into print_jobs (location_id, printer_id, payload) values (${LOCATION_A}, ${printer}, decode('48656c6c6f', 'hex'))
            returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  // Insert a printer with an arbitrary transport/field combination — the probe for the
  // `printers_transport_fields_ck` CHECK and the `printers_local_key_key` partial UNIQUE. Only the
  // fields relevant to a transport are supplied; the rest stay NULL. `transport` is a bound param
  // coerced into the print_transport column in assignment context (so an unknown enum value raises
  // the enum's own error, not a syntax error).
  function insertPrinter(opts: {
    transport: string;
    name?: string;
    localKey?: string | null;
    host?: string | null;
    pollId?: string | null;
  }): Promise<{ id: string }[]> {
    const name = opts.name ?? "Probe printer";
    const localKey = opts.localKey ?? null;
    const host = opts.host ?? null;
    const pollId = opts.pollId ?? null;
    return asApp((tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into printers (location_id, name, transport, local_key, host, poll_id) values (${LOCATION_A}, ${name}, ${opts.transport}, ${localKey}, ${host}, ${pollId})
              returning id`,
        )
        .then((r) => r.rows),
    );
  }

  // ---- print_agents -------------------------------------------------------------------------

  it("print_agents: exposes every column through the Drizzle export, with the active default", async () => {
    const id = await seedAgent("Kitchen USB agent");
    await asApp((tx) =>
      tx.execute(sql`update print_agents set last_seen_at = now() where id = ${id}`),
    );
    // Read back through the Drizzle `printAgents` export — exercises the produced table export and its
    // column mapping under the app role.
    const [row] = await asApp((tx) =>
      tx
        .select()
        .from(printAgents)
        .where(sql`id = ${id}`),
    );
    expect(row!.name).toBe("Kitchen USB agent");
    expect(row!.locationId).toBe(LOCATION_A);
    expect(row!.active).toBe(true);
    expect(row!.lastSeenAt).not.toBeNull();
  });

  it("print_agents: the location FK rejects a non-existent location (direct location_id → locations.id)", async () => {
    const e = await captureError(() =>
      asApp((tx) =>
        tx.execute(
          sql`insert into print_agents (location_id, name, token_hash) values (${GHOST_LOCATION}, 'Ghost location', ${TOKEN_HASH})`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on location_id
  });

  it("print_agent_pairing_codes no longer exists (join-and-accept replaced the pairing code)", async () => {
    // Undefined_table (42P01), read off the wrapped driver error the same way the FK/CHECK cases
    // above do — drizzle's own `.message` is "Failed query: …", so the real Postgres code lives on
    // `.cause` (pgErrorCode unwraps it).
    const e = await captureError(() =>
      asApp((tx) => tx.execute(sql`select 1 from print_agent_pairing_codes limit 1`)),
    );
    expect(pgErrorCode(e)).toBe("42P01");
  });

  it("allows many NULL node_id agents but at most one per node_id", async () => {
    // Two manual agents (node_id NULL) coexist — NULLS DISTINCT is the Postgres default.
    await seedAgent("till A");
    await seedAgent("till B");

    const node = "cccccccc-0000-4000-8000-000000000001";
    await asApp((tx) =>
      tx.execute(
        sql`insert into print_agents (location_id, name, token_hash, node_id) values (${LOCATION_A}, 'box', ${TOKEN_HASH}, ${node})`,
      ),
    );
    const err = await captureError(() =>
      asApp((tx) =>
        tx.execute(
          sql`insert into print_agents (location_id, name, token_hash, node_id) values (${LOCATION_A}, 'box dup', ${TOKEN_HASH}, ${node})`,
        ),
      ),
    );
    expect(pgErrorCode(err)).toBe("23505"); // unique_violation on print_agents_tenant_node_key
  });

  // ---- printers -----------------------------------------------------------------------------

  it("printers: exposes every column through the Drizzle export, with the port and ticket_scope defaults", async () => {
    const id = await seedPrinter("Kitchen printer");
    await asApp((tx) => tx.execute(sql`update printers set active = false where id = ${id}`));
    const [row] = await asApp((tx) =>
      tx
        .select()
        .from(printers)
        .where(sql`id = ${id}`),
    );
    expect(row!.name).toBe("Kitchen printer");
    expect(row!.transport).toBe("network_tcp");
    expect(row!.localKey).toBeNull(); // network_tcp carries no local_key
    expect(row!.host).toBe("10.0.0.5");
    expect(row!.port).toBe(9100); // the column default applied
    expect(row!.ticketScope).toBe("station"); // the enum default
    expect(row!.paperWidth).toBe("80mm");
    expect(row!.resolution).toBe("180dpi");
    expect(row!.characterSet).toBe("wpc1252");
    expect(row!.characterTable).toBe(16);
    expect(row!.active).toBe(false);

    await asApp((tx) => tx.execute(sql`update printers set character_table = 6 where id = ${id}`));
    const [updated] = await asApp((tx) =>
      tx
        .select({ characterTable: printers.characterTable })
        .from(printers)
        .where(sql`id = ${id}`),
    );
    expect(updated!.characterTable).toBe(6);
  });

  it("printers: rejects a character table outside the ESC/POS byte range", async () => {
    const err = await captureError(() =>
      asApp((tx) =>
        tx.execute(sql`insert into printers
          (location_id, name, transport, host, character_table)
          values (${LOCATION_A}, 'Bad table', 'network_tcp', '10.0.0.6', 256)`),
      ),
    );
    expect(pgErrorCode(err)).toBe("23514");
  });

  it("printers: the transport-fields CHECK admits a well-formed cloud_poll printer", async () => {
    // cloud_poll needs only poll_id (it self-polls; usb/bluetooth/network_tcp are covered below).
    const cloudId = await asApp((tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into printers (location_id, name, transport, poll_id) values (${LOCATION_A}, 'Cloud printer', 'cloud_poll', 'poll-abc')
              returning id`,
        )
        .then((r) => r.rows[0]!.id),
    );
    expect(cloudId).toBeDefined();
  });

  // ---- print_jobs ---------------------------------------------------------------------------

  it("print_jobs: round-trips the bytea payload and the delivery lifecycle columns", async () => {
    const printer = await seedPrinter("Printer for job");
    const id = await seedJob(printer);
    // The agent runtime transitions queued → printing → done via UPDATE (app_user holds UPDATE).
    await asApp((tx) =>
      tx.execute(
        sql`update print_jobs set status = 'done', delivered_at = now(), attempts = attempts + 1 where id = ${id}`,
      ),
    );
    const [row] = await asApp((tx) =>
      tx
        .select()
        .from(printJobs)
        .where(sql`id = ${id}`),
    );
    expect(row!.printerId).toBe(printer);
    expect(row!.status).toBe("done");
    expect(row!.kind).toBe("document");
    expect(row!.attempts).toBe(1);
    expect(row!.deliveredAt).not.toBeNull();
    // payload round-trips as the exact bytes, handed back as a plain Uint8Array by the shared
    // `binary` column (columns.ts). `Buffer.isBuffer` is the DISCRIMINATING assertion here: a node
    // Buffer IS a Uint8Array, so `instanceof Uint8Array` would hold either way. The decode below
    // checks the bytes, not the type — `TextDecoder` reads the same "Hello" out of a Buffer.
    expect(Buffer.isBuffer(row!.payload)).toBe(false);
    expect(new TextDecoder().decode(row!.payload)).toBe("Hello");
  });

  it("print_jobs: the app role stores a drawer command kind", async () => {
    const printer = await seedPrinter("Drawer command");
    const [job] = await asApp((tx) =>
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
    { kind: "unknown", code: "23514" },
    { kind: null, code: "23502" },
  ])("print_jobs: refuses kind $kind", async ({ kind, code }) => {
    const printer = await seedPrinter(`Bad kind ${kind}`);
    const error = await captureError(() =>
      asApp((tx) =>
        tx.execute(
          sql`insert into print_jobs (location_id, printer_id, payload, kind) values (${LOCATION_A}, ${printer}, decode('1b700019fa', 'hex'), ${kind})`,
        ),
      ),
    );
    expect(pgErrorCode(error)).toBe(code);
  });

  // ---- central-printer-provisioning: local_key / bluetooth / claimed_by ---------------------

  it("printers: rejects a usb printer with no local_key (CHECK 23514)", async () => {
    const e = await captureError(() => insertPrinter({ transport: "usb", localKey: null }));
    expect(pgErrorCode(e)).toBe("23514"); // printers_transport_fields_ck
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

  it("printers: rejects a network_tcp printer with no host (CHECK 23514)", async () => {
    const e = await captureError(() => insertPrinter({ transport: "network_tcp", host: null }));
    expect(pgErrorCode(e)).toBe("23514"); // printers_transport_fields_ck
  });

  it("printers: rejects a second registration of the same (location, local_key) (UNIQUE 23505)", async () => {
    await insertPrinter({ transport: "usb", localKey: "SN-DUP" });
    const e = await captureError(() => insertPrinter({ transport: "usb", localKey: "SN-DUP" }));
    expect(pgErrorCode(e)).toBe("23505"); // printers_local_key_key partial UNIQUE
  });

  it("printers: allows two NULL-local_key printers in one location (partial index)", async () => {
    const a = await insertPrinter({ transport: "network_tcp", host: "10.0.0.1" });
    expect(a[0]!.id).toBeDefined();
    const b = await insertPrinter({ transport: "network_tcp", host: "10.0.0.2" });
    expect(b[0]!.id).toBeDefined();
  });

  it("printers: the old (agent_id) FK and the agent_id/usb_path columns are gone", async () => {
    // Decision #2: prove the drop by reading pg_constraint back, do not assume DROP COLUMN cascaded.
    const fk = await suite.admin.execute(
      sql`select 1 from pg_constraint
          where conrelid = 'printers'::regclass and conname = 'printers_agent_fk'`,
    );
    expect(fk.rows).toHaveLength(0);
    // No surviving FK on printers still references print_agents.
    const refs = await suite.admin.execute<{ conname: string }>(
      sql`select conname from pg_constraint
          where conrelid = 'printers'::regclass and contype = 'f'
            and confrelid = 'print_agents'::regclass`,
    );
    expect(refs.rows).toHaveLength(0);
    const cols = await suite.admin.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_name = 'printers' and column_name in ('agent_id', 'usb_path')`,
    );
    expect(cols.rows).toHaveLength(0);
  });

  it("print_jobs: accepts claimed_by naming an agent in the same tenant, and NULL", async () => {
    const agentA = await seedAgent("Agent A claim ok");
    const printerA = await seedPrinter("Printer A claim ok");
    const claimed = await asApp((tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into print_jobs (location_id, printer_id, payload, claimed_by) values (${LOCATION_A}, ${printerA}, decode('00', 'hex'), ${agentA})
              returning id`,
        )
        .then((r) => r.rows),
    );
    expect(claimed[0]!.id).toBeDefined();
    // NULL claimed_by is skipped by MATCH SIMPLE (a queued job).
    const queued = await seedJob(printerA);
    expect(queued).toBeDefined();
  });
});

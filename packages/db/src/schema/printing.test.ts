import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { printAgents } from "./print-agents.js";
import { printJobs } from "./print-jobs.js";
import { printers } from "./printers.js";
import { tenants } from "./tenants.js";

// Real Postgres (a template clone), not PGlite: every write below runs as the non-owner
// `app_user`, the deployment role, which PGlite (every connection a superuser) cannot be. The
// cases retain the role switch so the reads and writes still exercise app_user grants.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
// A location id that is never seeded — the negative for the direct location_id → locations.id FK.
const GHOST_LOCATION = "dddddddd-0000-4000-8000-000000000099";
// A non-null token_hash fixture (shape only — the DB stores it as opaque text; the real scrypt value
// comes from hashSecret in a later task).
const TOKEN_HASH = "scrypt$00$00";

describe("printing schema (print_agents/printers/print_jobs — columns, CHECKs, FKs)", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    // A location per tenant — the direct location_id → locations.id FK target. operation_description
    // is Spanish test DATA, not a schema identifier, exactly as the sibling tests use 'Hostelería'.
    await suite.admin.execute(sql`
      insert into locations (id, tenant_id, name, invoice_locales, operation_description)
      values
        (${LOCATION_A}, ${TENANT_A}, 'Loc A', array['es'], 'Hostelería'),
        (${LOCATION_B}, ${TENANT_B}, 'Loc B', array['es'], 'Hostelería')
      on conflict (id) do nothing`);
  });

  function asApp<T>(tenant: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, tenant, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  function locationOf(tenant: string): string {
    return tenant === TENANT_A ? LOCATION_A : LOCATION_B;
  }

  async function seedAgent(tenant: string, name: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into print_agents (tenant_id, location_id, name, token_hash)
            values (${tenant}, ${locationOf(tenant)}, ${name}, ${TOKEN_HASH}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  // A network_tcp printer (host satisfies the transport CHECK). No stored agent binding — an agent is
  // discovered at run time, so a printer names none.
  async function seedPrinter(tenant: string, name: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into printers (tenant_id, location_id, name, transport, host)
            values (${tenant}, ${locationOf(tenant)}, ${name}, 'network_tcp', '10.0.0.5')
            returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  async function seedJob(tenant: string, printer: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into print_jobs (tenant_id, location_id, printer_id, payload)
            values (${tenant}, ${locationOf(tenant)}, ${printer}, decode('48656c6c6f', 'hex'))
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
  function insertPrinter(
    tenant: string,
    opts: {
      transport: string;
      name?: string;
      localKey?: string | null;
      host?: string | null;
      pollId?: string | null;
    },
  ): Promise<{ id: string }[]> {
    const name = opts.name ?? "Probe printer";
    const localKey = opts.localKey ?? null;
    const host = opts.host ?? null;
    const pollId = opts.pollId ?? null;
    return asApp(tenant, (tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into printers (tenant_id, location_id, name, transport, local_key, host, poll_id)
              values (${tenant}, ${locationOf(tenant)}, ${name}, ${opts.transport}, ${localKey}, ${host}, ${pollId})
              returning id`,
        )
        .then((r) => r.rows),
    );
  }

  // ---- print_agents -------------------------------------------------------------------------

  it("print_agents: exposes every column through the Drizzle export, with the active default", async () => {
    const id = await seedAgent(TENANT_A, "Kitchen USB agent");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update print_agents set last_seen_at = now() where id = ${id}`),
    );
    // Read back through the Drizzle `printAgents` export — exercises the produced table export and its
    // column mapping under the app role.
    const [row] = await asApp(TENANT_A, (tx) =>
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
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into print_agents (tenant_id, location_id, name, token_hash)
              values (${TENANT_A}, ${GHOST_LOCATION}, 'Ghost location', ${TOKEN_HASH})`,
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
      asApp(TENANT_A, (tx) => tx.execute(sql`select 1 from print_agent_pairing_codes limit 1`)),
    );
    expect(pgErrorCode(e)).toBe("42P01");
  });

  // ---- printers -----------------------------------------------------------------------------

  it("printers: exposes every column through the Drizzle export, with the port and ticket_scope defaults", async () => {
    const id = await seedPrinter(TENANT_A, "Kitchen printer");
    await asApp(TENANT_A, (tx) =>
      tx.execute(sql`update printers set active = false where id = ${id}`),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
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
    expect(row!.active).toBe(false);
  });

  it("printers: the transport-fields CHECK admits a well-formed cloud_poll printer", async () => {
    // cloud_poll needs only poll_id (it self-polls; usb/bluetooth/network_tcp are covered below).
    const cloudId = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into printers (tenant_id, location_id, name, transport, poll_id)
              values (${TENANT_A}, ${LOCATION_A}, 'Cloud printer', 'cloud_poll', 'poll-abc')
              returning id`,
        )
        .then((r) => r.rows[0]!.id),
    );
    expect(cloudId).toBeDefined();
  });

  // ---- print_jobs ---------------------------------------------------------------------------

  it("print_jobs: round-trips the bytea payload and the delivery lifecycle columns", async () => {
    const printer = await seedPrinter(TENANT_A, "Printer for job");
    const id = await seedJob(TENANT_A, printer);
    // The agent runtime transitions queued → printing → done via UPDATE (app_user holds UPDATE).
    await asApp(TENANT_A, (tx) =>
      tx.execute(
        sql`update print_jobs set status = 'done', delivered_at = now(), attempts = attempts + 1 where id = ${id}`,
      ),
    );
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(printJobs)
        .where(sql`id = ${id}`),
    );
    expect(row!.printerId).toBe(printer);
    expect(row!.status).toBe("done");
    expect(row!.attempts).toBe(1);
    expect(row!.deliveredAt).not.toBeNull();
    // payload round-trips as the exact bytes (bytea → Buffer via the customType).
    expect(Buffer.isBuffer(row!.payload)).toBe(true);
    expect(row!.payload.toString("utf8")).toBe("Hello");
  });

  it("print_jobs: the printer binding is tenant-consistent (composite FK to printers)", async () => {
    const printerA = await seedPrinter(TENANT_A, "Printer A for FK");
    const e = await captureError(() =>
      asApp(TENANT_B, (tx) =>
        tx.execute(
          sql`insert into print_jobs (tenant_id, location_id, printer_id, payload)
              values (${TENANT_B}, ${LOCATION_B}, ${printerA}, decode('00', 'hex'))`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, printer_id)
  });

  // ---- central-printer-provisioning: local_key / bluetooth / claimed_by ---------------------

  it("printers: rejects a usb printer with no local_key (CHECK 23514)", async () => {
    const e = await captureError(() =>
      insertPrinter(TENANT_A, { transport: "usb", localKey: null }),
    );
    expect(pgErrorCode(e)).toBe("23514"); // printers_transport_fields_ck
  });

  it("printers: accepts usb keyed on a serial and bluetooth keyed on a MAC", async () => {
    const usb = await insertPrinter(TENANT_A, { transport: "usb", localKey: "SN-ABC123" });
    expect(usb[0]!.id).toBeDefined();
    const bt = await insertPrinter(TENANT_A, {
      transport: "bluetooth",
      localKey: "AA:BB:CC:DD:EE:FF",
    });
    expect(bt[0]!.id).toBeDefined();
  });

  it("printers: rejects a network_tcp printer with no host (CHECK 23514)", async () => {
    const e = await captureError(() =>
      insertPrinter(TENANT_A, { transport: "network_tcp", host: null }),
    );
    expect(pgErrorCode(e)).toBe("23514"); // printers_transport_fields_ck
  });

  it("printers: rejects a second registration of the same (location, local_key) (UNIQUE 23505)", async () => {
    await insertPrinter(TENANT_A, { transport: "usb", localKey: "SN-DUP" });
    const e = await captureError(() =>
      insertPrinter(TENANT_A, { transport: "usb", localKey: "SN-DUP" }),
    );
    expect(pgErrorCode(e)).toBe("23505"); // printers_local_key_key partial UNIQUE
  });

  it("printers: allows two NULL-local_key printers in one location (partial index)", async () => {
    const a = await insertPrinter(TENANT_A, { transport: "network_tcp", host: "10.0.0.1" });
    expect(a[0]!.id).toBeDefined();
    const b = await insertPrinter(TENANT_A, { transport: "network_tcp", host: "10.0.0.2" });
    expect(b[0]!.id).toBeDefined();
  });

  it("printers: the old (tenant_id, agent_id) FK and the agent_id/usb_path columns are gone", async () => {
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

  it("print_jobs: rejects claimed_by naming an agent in another tenant (composite FK 23503)", async () => {
    const printerA = await seedPrinter(TENANT_A, "Printer A for claim FK");
    const agentB = await seedAgent(TENANT_B, "Agent B for claim FK");
    // A tenant-A job whose claimed_by points at a tenant-B agent violates (tenant_id, claimed_by).
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into print_jobs (tenant_id, location_id, printer_id, payload, claimed_by)
              values (${TENANT_A}, ${LOCATION_A}, ${printerA}, decode('00', 'hex'), ${agentB})`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // print_jobs_claimed_by_fk
  });

  it("print_jobs: accepts claimed_by naming an agent in the same tenant, and NULL", async () => {
    const agentA = await seedAgent(TENANT_A, "Agent A claim ok");
    const printerA = await seedPrinter(TENANT_A, "Printer A claim ok");
    const claimed = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into print_jobs (tenant_id, location_id, printer_id, payload, claimed_by)
              values (${TENANT_A}, ${LOCATION_A}, ${printerA}, decode('00', 'hex'), ${agentA})
              returning id`,
        )
        .then((r) => r.rows),
    );
    expect(claimed[0]!.id).toBeDefined();
    // NULL claimed_by is skipped by MATCH SIMPLE (a queued job).
    const queued = await seedJob(TENANT_A, printerA);
    expect(queued).toBeDefined();
  });
});

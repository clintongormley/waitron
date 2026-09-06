import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database, Transaction } from "../client.js";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { printAgentPairingCodes, printAgents } from "./print-agents.js";
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

class RollbackSignal extends Error {}
async function rollBackAfter(
  admin: Database,
  tenant: string,
  fn: (tx: Transaction) => Promise<void>,
): Promise<void> {
  await withTenant(admin, tenant, async (tx) => {
    await fn(tx);
    throw new RollbackSignal();
  }).catch((error: unknown) => {
    if (!(error instanceof RollbackSignal)) throw error;
  });
}

describe("printing schema (print_agents/pairing_codes/printers/print_jobs — columns, CHECKs, FKs)", () => {
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

  async function seedPairingCode(
    tenant: string,
    codeSha256: string,
    label: string,
    location: string = locationOf(tenant),
  ): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into print_agent_pairing_codes (tenant_id, location_id, code_sha256, label)
            values (${tenant}, ${location}, ${codeSha256}, ${label}) returning id`,
      );
      return r.rows[0]!.id;
    });
  }

  // A network_tcp printer (agent_id + host satisfy the transport CHECK) bound to `agent`.
  async function seedPrinter(tenant: string, agent: string, name: string): Promise<string> {
    return asApp(tenant, async (tx) => {
      const r = await tx.execute<{ id: string }>(
        sql`insert into printers (tenant_id, location_id, name, transport, agent_id, host)
            values (${tenant}, ${locationOf(tenant)}, ${name}, 'network_tcp', ${agent}, '10.0.0.5')
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

  // ---- print_agent_pairing_codes ------------------------------------------------------------

  it("print_agent_pairing_codes: maps every column and is consumed by DELETE … RETURNING", async () => {
    const id = await seedPairingCode(TENANT_A, "sha-control", "Code control");
    const [row] = await asApp(TENANT_A, (tx) =>
      tx
        .select()
        .from(printAgentPairingCodes)
        .where(sql`id = ${id}`),
    );
    expect(row!.codeSha256).toBe("sha-control");
    expect(row!.label).toBe("Code control");
    expect(row!.locationId).toBe(LOCATION_A);
    // The redemption shape: a locking DELETE … RETURNING consumes the row (app_user holds DELETE).
    const deleted = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ id: string }>(
          sql`delete from print_agent_pairing_codes where id = ${id} returning id`,
        )
        .then((r) => r.rows),
    );
    expect(deleted).toHaveLength(1);
    expect(deleted[0]!.id).toBe(id);
  });

  it("print_agent_pairing_codes: (tenant_id, code_sha256) is UNIQUE — a duplicate digest is rejected 23505", async () => {
    await seedPairingCode(TENANT_A, "sha-dup", "First");
    const e = await captureError(() => seedPairingCode(TENANT_A, "sha-dup", "Duplicate"));
    expect(pgErrorCode(e)).toBe("23505"); // unique_violation on (tenant_id, code_sha256)

    // Proof by deletion of the guard (§4): with the UNIQUE index replaced by a PLAIN one inside a
    // ROLLED-BACK tx, the SAME (tenant, digest) inserts a second time without error — attributing the
    // 23505 above to the unique index, not to some other constraint.
    await rollBackAfter(suite.admin, TENANT_A, async (tx) => {
      await tx.execute(sql`drop index print_agent_pairing_codes_lookup_idx`);
      await tx.execute(
        sql`create index print_agent_pairing_codes_lookup_idx on print_agent_pairing_codes (tenant_id, code_sha256)`,
      );
      await tx.execute(sql`set local role app_user`);
      const inserted = await tx.execute<{ id: string }>(
        sql`insert into print_agent_pairing_codes (tenant_id, location_id, code_sha256, label)
            values (${TENANT_A}, ${LOCATION_A}, 'sha-dup', 'Now allowed') returning id`,
      );
      expect(inserted.rows).toHaveLength(1); // the duplicate digest inserts once the UNIQUE index is gone
    });
  });

  // ---- printers -----------------------------------------------------------------------------

  it("printers: exposes every column through the Drizzle export, with the port and ticket_scope defaults", async () => {
    const agent = await seedAgent(TENANT_A, "Agent for printer");
    const id = await seedPrinter(TENANT_A, agent, "Kitchen printer");
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
    expect(row!.agentId).toBe(agent);
    expect(row!.host).toBe("10.0.0.5");
    expect(row!.port).toBe(9100); // the column default applied
    expect(row!.ticketScope).toBe("station"); // the enum default
    expect(row!.active).toBe(false);
  });

  it("printers: the agent binding is tenant-consistent (composite FK to print_agents)", async () => {
    const agentB = await seedAgent(TENANT_B, "Agent B");
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into printers (tenant_id, location_id, name, transport, agent_id, host)
              values (${TENANT_A}, ${LOCATION_A}, 'Cross-tenant agent', 'network_tcp', ${agentB}, '10.0.0.9')`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation on (tenant_id, agent_id)
  });

  it("printers: the transport-fields CHECK rejects a usb printer with no usb_path", async () => {
    const agent = await seedAgent(TENANT_A, "Agent for usb");
    // usb requires agent_id AND usb_path; supplying the agent but omitting usb_path violates the CHECK.
    const e = await captureError(() =>
      asApp(TENANT_A, (tx) =>
        tx.execute(
          sql`insert into printers (tenant_id, location_id, name, transport, agent_id)
              values (${TENANT_A}, ${LOCATION_A}, 'Bad usb', 'usb', ${agent})`,
        ),
      ),
    );
    expect(pgErrorCode(e)).toBe("23514"); // check_violation — printers_transport_fields_ck
  });

  it("printers: the transport-fields CHECK admits a well-formed usb + cloud_poll printer", async () => {
    const agent = await seedAgent(TENANT_A, "Agent usb ok");
    // usb with agent + usb_path satisfies the CHECK.
    const usbId = await asApp(TENANT_A, (tx) =>
      tx
        .execute<{ id: string }>(
          sql`insert into printers (tenant_id, location_id, name, transport, agent_id, usb_path)
              values (${TENANT_A}, ${LOCATION_A}, 'USB printer', 'usb', ${agent}, '/dev/usb/lp0')
              returning id`,
        )
        .then((r) => r.rows[0]!.id),
    );
    expect(usbId).toBeDefined();
    // cloud_poll needs only poll_id (no agent — it self-polls).
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
    const agent = await seedAgent(TENANT_A, "Agent for job");
    const printer = await seedPrinter(TENANT_A, agent, "Printer for job");
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
    const agentA = await seedAgent(TENANT_A, "Agent A for FK");
    const printerA = await seedPrinter(TENANT_A, agentA, "Printer A for FK");
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
});

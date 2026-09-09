import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { esc } from "./escpos.js";
import { claimPrintJobs, reportPrintJob } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import type { PrintConfig } from "./printers.js";

// Real PostgreSQL, NOT PGlite: eligibility is derived at claim time from the venue (network_tcp) and
// the agent's reported visible device keys (usb/bluetooth) — schema-only logic that PGlite runs fine,
// but this suite shares the `for update … skip locked` claim path with the race suite and runs as the
// real deployment role (SET ROLE app_user) so the grant the claim/report needs is exercised, not
// bypassed by PGlite's superuser connection (CLAUDE.md §4).
const suite = useTemplateDb({ template: "core" });

async function setup(): Promise<PrintConfig> {
  const tenantId = await seedTenant(suite.admin);
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Bar', array['es-ES'], 'Sale on premises') returning id`);
  return { tenantId, locationId: rows[0]!.id };
}

/** Run `fn` as the real deployment role — a tenant-scoped tx that switches to `app_user` first, the
 * shape the Task-6 route wraps every runtime call in. */
function asApp<T>(db: Database, cfg: PrintConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

async function seedAgent(cfg: PrintConfig, name: string): Promise<string> {
  const { rows } = await suite.admin.execute<{ id: string }>(sql`
    insert into print_agents (tenant_id, location_id, name, token_hash)
    values (${cfg.tenantId}, ${cfg.locationId}, ${name}, 'scrypt$fixture') returning id`);
  return rows[0]!.id;
}

describe("claim eligibility (real Postgres) — derived from venue + visible keys", () => {
  it("claims a network_tcp job for any agent in the venue", async () => {
    const cfg = await setup();
    // An agent that registered NOTHING — printers carry no agent binding now, so venue membership
    // (the locationId the agent reports) is the whole eligibility test for a network printer.
    const otherAgentId = await seedAgent(cfg, "Other");
    await asApp(suite.admin, cfg, async (tx) => {
      const p = await createPrinter(tx, cfg, {
        name: "IP",
        transport: "network_tcp",
        host: "10.0.0.5",
      });
      await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
      const claimed = await claimPrintJobs(tx, cfg, otherAgentId, {
        locationId: cfg.locationId,
        visibleKeys: [],
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({
        transport: "network_tcp",
        host: "10.0.0.5",
        local_key: null,
      });
    });
  });

  it("does NOT claim a network_tcp job for an agent in a DIFFERENT venue", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Kitchen");
    // A second venue in the same tenant; the printer lives in `cfg.locationId`, the agent reports the
    // other one — the venue conjunct (`p.location_id = ctx.locationId`) must exclude it.
    const { rows } = await suite.admin.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${cfg.tenantId}, 'Terrace', array['es-ES'], 'Sale on premises') returning id`);
    const otherLocationId = rows[0]!.id;
    await asApp(suite.admin, cfg, async (tx) => {
      const p = await createPrinter(tx, cfg, {
        name: "IP",
        transport: "network_tcp",
        host: "10.0.0.5",
      });
      await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
      const claimed = await claimPrintJobs(tx, cfg, agentId, {
        locationId: otherLocationId,
        visibleKeys: [],
      });
      expect(claimed).toEqual([]);
    });
  });

  it("claims a usb job only for an agent that reports its serial", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Kitchen");
    await asApp(suite.admin, cfg, async (tx) => {
      const p = await createPrinter(tx, cfg, { name: "USB", transport: "usb", localKey: "SN-9" });
      await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
      // The agent that does NOT see SN-9 claims nothing — the empty-visibleKeys guard degenerates the
      // usb/bt branch to `false` rather than an `in ()`.
      expect(
        await claimPrintJobs(tx, cfg, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
      ).toHaveLength(0);
      // The agent that reports SN-9 claims it, and the RETURNING carries the device key.
      const claimed = await claimPrintJobs(tx, cfg, agentId, {
        locationId: cfg.locationId,
        visibleKeys: ["SN-9"],
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({ transport: "usb", local_key: "SN-9", host: null });
    });
  });

  it("claims a bluetooth job by its visible key too (usb/bluetooth share the branch)", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Kitchen");
    await asApp(suite.admin, cfg, async (tx) => {
      const p = await createPrinter(tx, cfg, {
        name: "BT",
        transport: "bluetooth",
        localKey: "AA:BB:CC",
      });
      await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
      expect(
        await claimPrintJobs(tx, cfg, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
      ).toHaveLength(0);
      const claimed = await claimPrintJobs(tx, cfg, agentId, {
        locationId: cfg.locationId,
        visibleKeys: ["AA:BB:CC"],
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toMatchObject({ transport: "bluetooth", local_key: "AA:BB:CC" });
    });
  });

  it("stamps claimed_by and lets only the claimer report", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Kitchen");
    const otherAgentId = await seedAgent(cfg, "Other");
    await asApp(suite.admin, cfg, async (tx) => {
      const p = await createPrinter(tx, cfg, {
        name: "IP",
        transport: "network_tcp",
        host: "10.0.0.5",
      });
      const { jobId } = await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
      await claimPrintJobs(tx, cfg, agentId, { locationId: cfg.locationId, visibleKeys: [] });
      // The non-claimer's report matches nothing (claimed_by scopes the report), so it is a no-op.
      expect(
        (
          await reportPrintJob(tx, cfg, {
            agentId: otherAgentId,
            jobId,
            outcome: { status: "done" },
          })
        ).updated,
      ).toBe(false);
      // The claimer's report applies.
      expect(
        (await reportPrintJob(tx, cfg, { agentId, jobId, outcome: { status: "done" } })).updated,
      ).toBe(true);
    });
  });
});

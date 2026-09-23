import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, printAgents, printJobs, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { esc } from "./escpos.js";
import { claimPrintJobs, reportPrintJob } from "./runtime.js";
import { createPrinter } from "./printers.js";
import { enqueuePrintJob } from "./outbox.js";
import type { PrintConfig } from "./printers.js";

// Eligibility is derived at claim time from the venue (network_tcp) and the agent's reported visible
// device keys (usb/bluetooth) — schema-only logic, which is what every case below asserts.
//
// WHAT THIS SUITE NO LONGER SHOWS. Its header used to say it ran as the real deployment role
// (`set local role app_user` inside a real PostgreSQL transaction) so the grants the claim and the
// report need were exercised rather than bypassed. This engine has no roles and `asAppUser` is an
// empty body (`packages/db/src/testing/roles.ts`), so that half is gone and nothing replaces it.
//
// The empty-visibleKeys guard is proven by deletion on this engine, 2026-09-22 on Node v26.7.0:
// with the `sql`false`` arm in `claimPrintJobs` (`packages/printing/src/runtime.ts`) widened to
// `sql`p.transport in ('usb','bluetooth')`` and nothing else changed, the usb case and the
// bluetooth case below FAILED and the other three passed; restored, all five pass.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function setup(): Promise<PrintConfig> {
  await seedTenant(suite.db);
  // Through the table definition, not raw SQL: `locations.id` comes from `$defaultFn(newId)` in
  // JavaScript, so a raw insert naming no id is refused `NOT NULL constraint failed: locations.id`,
  // and `invoiceLocales` reaches its column's JSON mapping where `array['es-ES']` used to be SQL.
  const [row] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  return { locationId: row!.id };
}

async function seedAgent(cfg: PrintConfig, name: string): Promise<string> {
  const [row] = await suite.db
    .insert(printAgents)
    .values({ locationId: cfg.locationId, name, tokenHash: "scrypt$fixture" })
    .returning({ id: printAgents.id });
  return row!.id;
}

describe("claim eligibility — derived from venue + visible keys", () => {
  it("claims a network_tcp job for any agent in the venue", async () => {
    const cfg = await setup();
    // An agent that registered NOTHING — printers carry no agent binding now, so venue membership
    // (the locationId the agent reports) is the whole eligibility test for a network printer.
    const otherAgentId = await seedAgent(cfg, "Other");
    await withTransaction(suite.db, async (tx: Transaction) => {
      const p = await createPrinter(tx, cfg, {
        name: "IP",
        transport: "network_tcp",
        host: "10.0.0.5",
      });
      await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
      const claimed = await claimPrintJobs(tx, otherAgentId, {
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
    const [other] = await suite.db
      .insert(locations)
      .values({
        name: "Terrace",
        invoiceLocales: ["es-ES"],
        operationDescription: "Sale on premises",
      })
      .returning({ id: locations.id });
    const otherLocationId = other!.id;
    await withTransaction(suite.db, async (tx: Transaction) => {
      const p = await createPrinter(tx, cfg, {
        name: "IP",
        transport: "network_tcp",
        host: "10.0.0.5",
      });
      await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
      const claimed = await claimPrintJobs(tx, agentId, {
        locationId: otherLocationId,
        visibleKeys: [],
      });
      expect(claimed).toEqual([]);
    });
  });

  it("claims a usb job only for an agent that reports its serial", async () => {
    const cfg = await setup();
    const agentId = await seedAgent(cfg, "Kitchen");
    await withTransaction(suite.db, async (tx: Transaction) => {
      const p = await createPrinter(tx, cfg, { name: "USB", transport: "usb", localKey: "SN-9" });
      const { jobId } = await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
      // The agent that does NOT see SN-9 claims nothing — the empty-visibleKeys guard degenerates the
      // usb/bt branch to `false` rather than an `in ()`. The FAILING case (the guard gone, or the branch
      // matching a printer whose key nobody reported) would return the job and flip it to `printing`; so
      // the job must be claimed 0 times AND left `queued` for another box that CAN see the device.
      expect(
        await claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
      ).toHaveLength(0);
      // Read through the table rather than raw SQL: `status` is a plain text column either way, but a
      // raw select skips drizzle's read mapping, and going through the table is what the rest of this
      // package now does.
      const [afterMiss] = await tx
        .select({ status: printJobs.status })
        .from(printJobs)
        .where(eq(printJobs.id, jobId));
      expect(afterMiss!.status).toBe("queued");
      // The agent that reports SN-9 claims it, and the RETURNING carries the device key.
      const claimed = await claimPrintJobs(tx, agentId, {
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
    await withTransaction(suite.db, async (tx: Transaction) => {
      const p = await createPrinter(tx, cfg, {
        name: "BT",
        transport: "bluetooth",
        localKey: "AA:BB:CC",
      });
      await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
      expect(
        await claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
      ).toHaveLength(0);
      const claimed = await claimPrintJobs(tx, agentId, {
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
    await withTransaction(suite.db, async (tx: Transaction) => {
      const p = await createPrinter(tx, cfg, {
        name: "IP",
        transport: "network_tcp",
        host: "10.0.0.5",
      });
      const { jobId } = await enqueuePrintJob(tx, cfg, p.id, esc().line("x").bytes());
      await claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [] });
      // claimed_by scopes the report's UPDATE to the claimer: the non-claimer's report updates no row
      // (`updated === false`); the claimer's updates it (`true`).
      expect(
        (
          await reportPrintJob(tx, {
            agentId: otherAgentId,
            jobId,
            outcome: { status: "done" },
          })
        ).updated,
      ).toBe(false);
      // The claimer's report applies.
      expect(
        (await reportPrintJob(tx, { agentId, jobId, outcome: { status: "done" } })).updated,
      ).toBe(true);
    });
  });
});

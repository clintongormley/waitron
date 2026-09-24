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

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function setup(): Promise<PrintConfig> {
  await seedTenant(suite.db);
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
    // An agent that registered NOTHING — printers carry no agent binding, so venue membership
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
      // An agent that does NOT see SN-9 must claim it 0 times AND leave it `queued` for another box
      // that CAN see the device.
      expect(
        await claimPrintJobs(tx, agentId, { locationId: cfg.locationId, visibleKeys: [] }),
      ).toHaveLength(0);
      const [afterMiss] = await tx
        .select({ status: printJobs.status })
        .from(printJobs)
        .where(eq(printJobs.id, jobId));
      expect(afterMiss!.status).toBe("queued");
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
      expect(
        (
          await reportPrintJob(tx, {
            agentId: otherAgentId,
            jobId,
            outcome: { status: "done" },
          })
        ).updated,
      ).toBe(false);
      expect(
        (await reportPrintJob(tx, { agentId, jobId, outcome: { status: "done" } })).updated,
      ).toBe(true);
    });
  });
});

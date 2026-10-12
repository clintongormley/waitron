import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { nodes, stampDeployment, withTransaction } from "@waitron/db";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { departmentReceipts, departments } from "@waitron/venue-service";
import { parseModuleConfig } from "@waitron/module";
import { provisionBillVenue } from "./testing/bill-venue.js";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { writeModuleConfig } from "./module-config.js";
import { startServer, type StartedServer } from "./boot.js";
import { freePorts } from "./testing/free-ports.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it.each(["ES-common", "GB-vat"])(
  "trading boot gives the department list description readiness for %s",
  async (pack) => {
    const venue = await provisionBillVenue(suite.db);
    await suite.db
      .update(nodes)
      .set({ filingModule: pack === "GB-vat" ? "none" : "verifactu" })
      .where(eq(nodes.id, venue.cfg.nodeId));
    const rows = await suite.db
      .select()
      .from(departments)
      .where(eq(departments.locationId, venue.cfg.locationId));
    for (const row of rows)
      await suite.db.delete(departmentReceipts).where(eq(departmentReceipts.departmentId, row.id));
    await stampDeployment(suite.db, "preproduction");
    const scratch = await mkdtemp(join(tmpdir(), "a493-boot-description-"));
    let server: StartedServer | undefined;
    try {
      const state = join(scratch, "state");
      await mkdir(state);
      await writeModuleConfig(state, venueModuleConfig(parseModuleConfig({}, ALL_MODULES), pack));
      const sets = manifestSets();
      const options = migrationOptionsFor(sets, null);
      for (const [index, set] of sets.entries())
        await cp(options[index]!.migrationsFolder, join(scratch, "migrations", set.name), {
          recursive: true,
        });
      const files = suite.db.all<{ name: string; file: string }>(sql`pragma database_list`);
      const [port] = await freePorts(1);
      const session = await withTransaction(suite.db, (tx) =>
        startManagementSession(tx, { personId: venue.adminId }),
      );
      server = await startServer({
        WAITRON_VENUE_DIR: dirname(files.find((file) => file.name === "main")!.file),
        WAITRON_STATE_DIR: state,
        WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_ENV: "dev",
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
        WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
        WAITRON_ONBOARDING_INTENT: "demo",
      });
      const response = await fetch(`http://127.0.0.1:${port}/management-api/venue-service`, {
        headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` },
      });
      expect(response.status).toBe(200);
      const model = (await response.json()) as {
        readiness: { code: string; departmentId?: string; departmentName?: string }[];
      };
      const missing = model.readiness.filter(
        (issue) => issue.code === "department.operation_description_required",
      );
      expect(missing).toEqual(
        pack === "ES-common"
          ? rows.map((row) => ({
              code: "department.operation_description_required",
              departmentId: row.id,
              departmentName: row.name,
            }))
          : [],
      );
    } finally {
      await server?.close();
      await rm(scratch, { recursive: true, force: true });
    }
  },
  60_000,
);

import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { nodes, stampDeployment } from "@waitron/db";
import { departmentReceipts, departments } from "@waitron/venue-service";
import { parseModuleConfig } from "@waitron/module";
import { provisionBillVenue } from "./testing/bill-venue.js";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { writeModuleConfig } from "./module-config.js";
import { startServer, type StartedServer } from "./boot.js";
import { freePorts } from "./testing/free-ports.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("a trading boot without a fiscal description field accepts a department's empty receipt", async () => {
  const venue = await provisionBillVenue(suite.db);
  await suite.db.update(nodes).set({ filingModule: "none" }).where(eq(nodes.id, venue.cfg.nodeId));
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
    await writeModuleConfig(state, venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"));
    const sets = manifestSets();
    const options = migrationOptionsFor(sets, null);
    for (const [index, set] of sets.entries())
      await cp(options[index]!.migrationsFolder, join(scratch, "migrations", set.name), {
        recursive: true,
      });
    const files = suite.db.all<{ name: string; file: string }>(sql`pragma database_list`);
    const [port] = await freePorts(1);
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
      WAITRON_TILL_SERIES_ID: venue.cfg.seriesId,
      WAITRON_ONBOARDING_INTENT: "demo",
    });
    const reply = await fetch(`http://127.0.0.1:${port}/api/sales`, {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        zoneId: venue.zoneId,
        lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
        tender: { method: "cash", amount: "3.00" },
      }),
    });
    expect(await reply.json()).not.toHaveProperty("error");
    expect(reply.status).toBe(200);
    expect(suite.db.all(sql`select fiscal_backend, total from sales`)).toEqual([
      { fiscal_backend: "none", total: 300 },
    ]);
    expect(suite.db.all(sql`select * from registros_facturacion`)).toEqual([]);
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);

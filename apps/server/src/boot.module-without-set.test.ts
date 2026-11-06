import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { nodes, stampDeployment } from "@waitron/db";
import { parseModuleConfig, type WaitronModule } from "@waitron/module";
import { provisionBillVenue } from "./testing/bill-venue.js";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { writeModuleConfig } from "./module-config.js";
import type { StartedServer } from "./boot.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePorts } from "./testing/free-ports.js";
import { waitForEvent, withCapturedStdout } from "./testing/boot-harness.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const removals = vi.hoisted(() => ({
  setless: {
    refuse: async () => new Map(),
    release: async () => {},
  },
  handed: [] as unknown[][],
}));

vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  const { fakeSetlessModule } = await import("@waitron/module/src/testing/fake-module.js");
  const setless = fakeSetlessModule("synthetic-setless", "core", {
    requires: { core: "*" },
    configurationTransfer: { kind: "none" },
    tableRemoval: removals.setless,
  });
  return {
    ...actual,
    ALL_MODULES: [...actual.ALL_MODULES, setless],
    enabledTableRemovals: (modules: readonly WaitronModule[]) => {
      const answer = actual.enabledTableRemovals(modules);
      removals.handed.push([...answer]);
      return answer;
    },
  };
});

const { startServer, httpPort } = ephemeralServerFixture();

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("a trading boot never names a module with no set of its own as waiting to be migrated", async () => {
  expect(ALL_MODULES.map((module) => module.name)).toContain("synthetic-setless");
  const venue = await provisionBillVenue(suite.db);
  await suite.db.update(nodes).set({ filingModule: "none" }).where(eq(nodes.id, venue.cfg.nodeId));
  await stampDeployment(suite.db, "preproduction");
  const scratch = await mkdtemp(join(tmpdir(), "a760-boot-setless-"));
  let server: StartedServer | undefined;
  try {
    const state = join(scratch, "state");
    await mkdir(state);
    // GB-vat switches off the migrated Veri*Factu set, so boot logs its reconcile line, which also
    // names what it thinks is still to migrate.
    await writeModuleConfig(state, venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat"));
    const sets = manifestSets();
    const options = migrationOptionsFor(sets, null);
    for (const [index, set] of sets.entries())
      await cp(options[index]!.migrationsFolder, join(scratch, "migrations", set.name), {
        recursive: true,
      });
    const files = suite.db.all<{ name: string; file: string }>(sql`pragma database_list`);
    const [port] = await freePorts(1);
    const [started, reconcileLine] = await withCapturedStdout(async (lines) => {
      const s = await startServer({
        WAITRON_VENUE_DIR: dirname(files.find((file) => file.name === "main")!.file),
        WAITRON_STATE_DIR: state,
        WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
        WAITRON_HTTP_PORT: String(port),
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_ENV: "dev",
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_NODE_ID: venue.cfg.nodeId,
        WAITRON_ONBOARDING_INTENT: "demo",
      });
      return [s, await waitForEvent(lines, "module.reconcile")] as const;
    });
    server = started;
    expect(reconcileLine.softDisabled).toEqual(["fiscal-verifactu"]);
    // fiscal-none's set has no migrations, so it reads as unmigrated: the line does name modules.
    expect(reconcileLine.toMigrate).toEqual(["fiscal-none"]);
    const reply = await fetch(`http://127.0.0.1:${httpPort()}/api/sales`, {
      method: "POST",
      headers: { cookie: venue.cookie, "content-type": "application/json" },
      body: JSON.stringify({
        zoneId: venue.zoneId,
        lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
        tender: { method: "cash", amount: "3.00" },
      }),
    });
    expect(reply.status).toBe(200);
    // Its tables are migrated with core's set, so its table-removal seat is in force.
    expect(removals.handed.at(-1)).toContain(removals.setless);
  } finally {
    await server?.close();
    await rm(scratch, { recursive: true, force: true });
  }
}, 60_000);

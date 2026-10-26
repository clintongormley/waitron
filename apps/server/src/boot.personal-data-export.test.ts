import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "./modules.js";
import type { StartedServer } from "./boot.js";
import { createClockVenue } from "./testing/clock-venue.js";
import { serverFixture } from "./testing/server-fixture.js";
import { copyMigrationsRoot, awaitListening } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";

const { beforeServerStarts, startServer } = serverFixture();
const disabled = new Set(["fiscal-none", "staffing"]);
const modules = ALL_MODULES.filter((m) => !disabled.has(m.name));
const suite = useVenueDb({
  migrations: migrationOptionsFor(
    manifestSets().filter((s) => !disabled.has(s.name)),
    null,
  ),
});

describe("the personal-data downloads in a real start", () => {
  it("answers a signed-in person with their own profile, gives an administrator another person's, and refuses a manager, in primary mode", async () => {
    beforeServerStarts();
    const venue = await createClockVenue(suite.db, () => new Date(), modules);
    const session = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId: venue.personId }),
    );
    const clockedIn = await venue.app.request("/api/clock/in", {
      method: "POST",
      headers: { cookie: venue.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedEntryId: null }),
    });
    expect(clockedIn.status).toBe(200);
    const [admin, manager] = await suite.db
      .insert(persons)
      .values([
        { displayName: "Ada Admin", email: "ada@example.test", role: "admin" },
        { displayName: "Mia Manager", email: "mia@example.test", role: "manager" },
      ])
      .returning({ id: persons.id });
    const [adminSession, managerSession] = await withTransaction(suite.db, async (tx) => [
      await startManagementSession(tx, { personId: admin!.id }),
      await startManagementSession(tx, { personId: manager!.id }),
    ]);
    await stampDeployment(suite.db, "preproduction");
    const scratch = await mkdtemp(join(tmpdir(), "waitron-personal-data-boot-"));
    let server: StartedServer | undefined;
    try {
      await copyMigrationsRoot(join(scratch, "migrations"));
      await writeFile(
        join(scratch, "modules.json"),
        JSON.stringify({ modules: Object.fromEntries([...disabled].map((m) => [m, false])) }),
      );
      const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
      const [port] = await freePorts(1);
      server = await startServer({
        WAITRON_HTTP_LANDING_PORT: "0",
        WAITRON_HTTP_PORT: String(port),
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
        WAITRON_STATE_DIR: scratch,
        WAITRON_VENUE_DIR: dirname(database),
        WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
        WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
        WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
        WAITRON_ENV: "preproduction",
      });
      await awaitListening(port);
      const response = await fetch(
        `http://127.0.0.1:${port}/management-api/me/personal-data/export`,
        { headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}` } },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/zip");
      const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
      const profile = JSON.parse(strFromU8(files["profile.json"]!)) as Record<string, unknown>;
      expect([profile.id, profile.displayName]).toEqual([venue.personId, "Ana"]);
      expect(strFromU8(files["README.txt"]!).split("\n")[0]).toContain("Clock venue SL");
      expect([
        Object.hasOwn(files, "time-record.csv"),
        Object.hasOwn(files, "time-record.pdf"),
        Object.hasOwn(files, "staff-roles.json"),
      ]).toEqual([true, true, false]);

      const url = `http://127.0.0.1:${port}/management-api/staff/${venue.personId}/personal-data/export`;
      const other = await fetch(url, {
        headers: { cookie: `${MANAGEMENT_COOKIE}=${adminSession.token}` },
      });
      expect(other.status).toBe(200);
      expect(other.headers.get("content-type")).toBe("application/zip");
      const otherFiles = unzipSync(new Uint8Array(await other.arrayBuffer()));
      const otherProfile = JSON.parse(strFromU8(otherFiles["profile.json"]!)) as Record<
        string,
        unknown
      >;
      expect([otherProfile.id, otherProfile.displayName]).toEqual([venue.personId, "Ana"]);

      const refused = await fetch(url, {
        headers: { cookie: `${MANAGEMENT_COOKIE}=${managerSession.token}` },
      });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({
        error: {
          code: "authorization.not_permitted",
          params: { permission: "personal_data.export" },
        },
      });

      const invoiceCustomers = `http://127.0.0.1:${port}/management-api/invoice-customers/personal-data`;
      const search = `${invoiceCustomers}?taxId=12345678Z`;
      const download = `${invoiceCustomers}/export?taxId=12345678Z`;
      const adminCookie = { cookie: `${MANAGEMENT_COOKIE}=${adminSession.token}` };
      const found = await fetch(search, { headers: adminCookie });
      expect(found.status).toBe(200);
      expect(await found.json()).toEqual({ taxId: "12345678Z", invoices: [] });
      const missing = await fetch(download, { headers: adminCookie });
      expect(missing.status).toBe(404);
      expect(await missing.json()).toEqual({
        error: { code: "invoice_customer.not_found", params: {} },
      });
      const managerCookie = { cookie: `${MANAGEMENT_COOKIE}=${managerSession.token}` };
      for (const target of [search, download]) {
        const managerRefused = await fetch(target, { headers: managerCookie });
        expect(managerRefused.status).toBe(403);
        expect(await managerRefused.json()).toEqual({
          error: {
            code: "authorization.not_permitted",
            params: { permission: "personal_data.export" },
          },
        });
      }
    } finally {
      await server?.close();
      await rm(scratch, { recursive: true, force: true });
    }
    beforeServerStarts();
  }, 60_000);
});

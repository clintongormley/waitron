import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  setDeploymentMode,
  setSingletonRoleTx,
  stampDeployment,
  withTransaction,
  writeMirrorConfig,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { ALL_MODULES } from "./modules.js";
import type { StartedServer } from "./boot.js";
import { createClockVenue } from "./testing/clock-venue.js";
import { serverFixture } from "./testing/server-fixture.js";
import { copyMigrationsRoot, awaitListening, httpsVia } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

const { beforeServerStarts, startServer } = serverFixture();
for (const state of ["provider", "workforce-only", "disabled"] as const) {
  describe(`actual export boot ${state}`, () => {
    const disabled = new Set([
      "fiscal-none",
      "staffing",
      ...(state === "provider" ? [] : ["workforce-es"]),
      ...(state === "disabled" ? ["workforce"] : []),
    ]);
    const modules = ALL_MODULES.filter((m) => !disabled.has(m.name));
    const suite = useVenueDb({
      migrations: migrationOptionsFor(
        manifestSets().filter((s) => !disabled.has(s.name)),
        null,
      ),
    });
    it.each(
      state === "provider"
        ? (["primary", "mirror", "fenced", "secondary", "setup"] as const)
        : (["primary"] as const),
    )(
      "serves only enabled writable exports in %s mode",
      async (mode) => {
        beforeServerStarts();
        const venue = await createClockVenue(suite.db, () => new Date(), modules);
        const session = await withTransaction(suite.db, (tx) =>
          startManagementSession(tx, { personId: venue.personId }),
        );
        await stampDeployment(suite.db, "preproduction");
        if (mode === "mirror") {
          await setDeploymentMode(suite.db, venue.cfg.nodeId, "mirror");
          await writeMirrorConfig(suite.db, venue.cfg.nodeId, {
            relayUrl: "https://127.0.0.1:1/",
            boxHostname: "box.test",
            boxCaPem: "unused",
            originNodeId: venue.cfg.nodeId,
          });
        } else if (mode === "secondary")
          await withTransaction(suite.db, (tx) =>
            setSingletonRoleTx(tx, venue.cfg.nodeId, "secondary"),
          );
        else if (mode === "fenced")
          await writeNodeMembership(
            suite.db,
            signedMembershipDoc(1, {
              signerNodeId: venue.cfg.nodeId,
              nodes: [
                { nodeId: venue.cfg.nodeId, contactUrl: "https://box.test", standing: "sell-only" },
              ],
            }),
          );
        const scratch = await mkdtemp(join(tmpdir(), "waitron-export-boot-"));
        let server: StartedServer | undefined, tls: ReturnType<typeof httpsVia> | undefined;
        const statements: string[] = [],
          original = DatabaseSync.prototype.prepare;
        const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
          this: DatabaseSync,
          query: string,
        ) {
          statements.push(query);
          return original.call(this, query);
        });
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
            WAITRON_TILL_NODE_ID: mode === "setup" ? undefined : venue.cfg.nodeId,
            WAITRON_TILL_LOCATION_ID: mode === "setup" ? undefined : venue.cfg.locationId,
            WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
            WAITRON_ENV: "preproduction",
          });
          await awaitListening(port);
          if (mode === "setup") tls = httpsVia(await readFile(join(scratch, "tls", "ca.crt")));
          const origin = `${mode === "setup" ? "https" : "http"}://127.0.0.1:${port}`;
          const get = (path: string) =>
            fetch(origin + path, {
              ...tls?.via,
              headers: { cookie: `${MANAGEMENT_COOKIE}=${session.token}`, "x-waitron-live": "1" },
            });
          const selection = `locationId=${venue.cfg.locationId}&from=2020-01-01&before=2026-02-01&format=csv&audience=standard&locale=en`;
          const own = `/management-api/me/attendance/export?${selection}`;
          const manager = `/management-api/attendance/export?${selection}`;
          const optionsPath = `/management-api/me/attendance/export-options?locationId=${venue.cfg.locationId}`;
          const options = await get(optionsPath);
          if (state !== "disabled" && mode === "primary") {
            expect(options.status).toBe(200);
            expect(await options.json()).toEqual({
              available: state === "provider",
              canExportAll: false,
            });
            const response = await get(own);
            expect(response.status).toBe(state === "provider" ? 200 : 404);
            if (state === "provider") {
              expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
              expect(await response.text()).toContain('"totals"');
            } else
              expect(await response.json()).toMatchObject({
                error: { code: "attendance.invalid", params: { reason: "export_unavailable" } },
              });
            const refused = await get(manager);
            expect(refused.status).toBe(403);
            expect(await refused.json()).toMatchObject({
              error: { code: "authorization.not_permitted" },
            });
          } else {
            expect(options.status).toBe(404);
            expect((await get(own)).status).toBe(404);
            expect((await get(manager)).status).toBe(404);
          }
          if (state === "disabled")
            expect(
              statements.filter((q) =>
                /\b(?:from|join|into|update)\s+["`[]?(?:attendance_\w*|time_entries|workforce_chains|pay_period_\w*)\b/i.test(
                  q,
                ),
              ),
            ).toEqual([]);
        } finally {
          await server?.close();
          await tls?.close();
          spy.mockRestore();
          await rm(scratch, { recursive: true, force: true });
        }
        beforeServerStarts();
      },
      60_000,
    );
  });
}

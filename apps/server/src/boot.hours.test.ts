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
import { timeEntries } from "@waitron/workforce";
import type {
  AttendanceInbox,
  AttendanceCommandResult,
} from "@waitron/workforce/attendance-contract";
import { ALL_MODULES } from "./modules.js";
import type { StartedServer } from "./boot.js";
import { createClockVenue } from "./testing/clock-venue.js";
import { serverFixture } from "./testing/server-fixture.js";
import { copyMigrationsRoot, awaitListening, httpsVia } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

const { beforeServerStarts, startServer } = serverFixture();
for (const enabled of [true, false]) {
  describe(`hours actual boot workforce=${enabled}`, () => {
    const disabled = new Set([
      "fiscal-none",
      "workforce-es",
      "staffing",
      ...(enabled ? [] : ["workforce"]),
    ]);
    const modules = ALL_MODULES.filter((m) => !disabled.has(m.name));
    const suite = useVenueDb({
      migrations: migrationOptionsFor(
        manifestSets().filter((s) => !disabled.has(s.name)),
        null,
      ),
    });
    it.each(
      enabled
        ? (["primary", "mirror", "fenced", "secondary", "setup"] as const)
        : (["primary"] as const),
    )(
      "only exposes the migrated writable hours surface in %s mode",
      async (mode) => {
        beforeServerStarts();
        const venue = await createClockVenue(suite.db, () => new Date(), modules);
        const session = await withTransaction(suite.db, (tx) =>
          startManagementSession(tx, { personId: venue.personId }),
        );
        const cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
        await stampDeployment(suite.db, "preproduction");
        if (mode === "mirror") {
          await setDeploymentMode(suite.db, venue.cfg.nodeId, "mirror");
          await writeMirrorConfig(suite.db, venue.cfg.nodeId, {
            relayUrl: "https://127.0.0.1:1/",
            boxHostname: "box.test",
            boxCaPem: "unused",
            originNodeId: venue.cfg.nodeId,
          });
        } else if (mode === "fenced")
          await writeNodeMembership(
            suite.db,
            signedMembershipDoc(1, {
              signerNodeId: venue.cfg.nodeId,
              nodes: [
                { nodeId: venue.cfg.nodeId, contactUrl: "https://box.test", standing: "sell-only" },
              ],
            }),
          );
        else if (mode === "secondary")
          await withTransaction(suite.db, (tx) =>
            setSingletonRoleTx(tx, venue.cfg.nodeId, "secondary"),
          );
        const scratch = await mkdtemp(join(tmpdir(), "waitron-hours-boot-"));
        let server: StartedServer | undefined;
        let tls: ReturnType<typeof httpsVia> | undefined;
        const statements: string[] = [],
          original = DatabaseSync.prototype.prepare;
        const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
          this: DatabaseSync,
          query: string,
        ) {
          statements.push(query);
          return original.call(this, query);
        });
        let result: AttendanceCommandResult | undefined;
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
              headers: {
                cookie: path.startsWith("/api/") ? venue.cookie : cookie,
                "x-waitron-live": "1",
              },
            });
          const paths = [
            `/api/attendance/hours?locationId=${venue.cfg.locationId}&kind=week`,
            "/management-api/me/attendance/inbox",
            `/management-api/me/attendance/hours?locationId=${venue.cfg.locationId}&kind=month`,
            `/management-api/me/attendance/day?locationId=${venue.cfg.locationId}&date=2026-01-05`,
            `/management-api/me/attendance/commands/${crypto.randomUUID()}`,
            `/management-api/attendance/hours?locationId=${venue.cfg.locationId}&kind=pay-period`,
          ];
          if (enabled && mode === "primary") {
            const own = await get(paths[1]!);
            expect(own.status).toBe(200);
            const inbox = (await own.json()) as AttendanceInbox;
            expect(inbox.locations).toEqual([
              { id: venue.cfg.locationId, name: "Clock venue", timeZone: "Europe/Madrid" },
            ]);
            for (const path of [paths[0]!, paths[2]!]) {
              const response = await get(path);
              expect(response.status, path).toBe(200);
              expect(await response.json()).toMatchObject({
                personId: venue.personId,
                locationId: venue.cfg.locationId,
                workedMinutes: 0,
              });
            }
            expect((await get(paths[3]!)).status).toBe(200);
            expect(await (await get(paths[4]!)).json()).toBeNull();
            const denied = await get(paths[5]!);
            expect(denied.status).toBe(403);
            expect(await denied.json()).toMatchObject({
              error: { code: "authorization.not_permitted" },
            });
            const command = {
              commandId: crypto.randomUUID(),
              expectedRevision: inbox.revision,
              action: "request",
              questionId: null,
              locationId: venue.cfg.locationId,
              changes: [
                { target: { missingKind: "in" }, at: "2026-01-05T09:00:00Z", offsetMinutes: 60 },
                { target: { missingKind: "out" }, at: "2026-01-05T17:00:00Z", offsetMinutes: 60 },
              ],
              reason: "Forgot this shift",
            };
            const response = await fetch(`${origin}/management-api/me/attendance/commands`, {
              method: "POST",
              headers: { cookie, "content-type": "application/json" },
              body: JSON.stringify(command),
            });
            expect(response.status).toBe(200);
            result = (await response.json()) as AttendanceCommandResult;
            expect(result.entryIds).toHaveLength(2);
            const selected = await get(
              `/management-api/me/attendance/hours?locationId=${venue.cfg.locationId}&kind=month&date=2026-01-05`,
            );
            expect(selected.status).toBe(200);
            expect(await selected.json()).toMatchObject({
              workedMinutes: 0,
              pending: { items: [{ status: "waiting-manager" }] },
            });
          } else {
            for (const path of paths) {
              const response = await get(path);
              if (mode === "setup" && path.startsWith("/api/")) {
                expect(response.status).toBe(200);
                expect(response.headers.get("content-type")).toContain("text/html");
              } else expect(response.status, path).toBe(404);
            }
            const response = await fetch(`${origin}/management-api/me/attendance/commands`, {
              ...tls?.via,
              method: "POST",
              headers: { cookie, "content-type": "application/json" },
              body: "{}",
            });
            expect(response.status).toBe(mode === "mirror" || mode === "fenced" ? 403 : 404);
            if (response.status === 403)
              expect(await response.json()).toMatchObject({ error: { code: "node.read_only" } });
          }
          if (!enabled)
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
        if (enabled) {
          const entries = await suite.db.select().from(timeEntries);
          expect(entries).toHaveLength(mode === "primary" ? 2 : 0);
          if (result) expect(entries.map((e) => e.id).sort()).toEqual([...result.entryIds].sort());
        }
      },
      60_000,
    );
  });
}

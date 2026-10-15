import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
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
import {
  hashSessionToken,
  managementSessions,
  persons,
  startManagementSession,
} from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { WorkforceBackend, timeEntries } from "@waitron/workforce";
import { jobOrigin } from "@waitron/shared";
import type {
  AttendanceCommandResult,
  AttendanceInbox,
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
  describe(`attendance response real boot workforce=${enabled}`, () => {
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
      "serves only the writable migrated attendance surface in %s mode",
      async (mode) => {
        beforeServerStarts();
        const venue = await createClockVenue(suite.db, () => new Date(), modules);
        const [manager] = await suite.db.select().from(persons).where(eq(persons.role, "admin"));
        const management = await withTransaction(suite.db, (tx) =>
          startManagementSession(tx, { personId: manager!.id }),
        );
        const managerCookie = `${MANAGEMENT_COOKIE}=${management.token}`;
        const oldSeenAt = new Date(Date.now() - 60_000).toISOString();
        await suite.db
          .update(managementSessions)
          .set({ lastSeenAt: oldSeenAt })
          .where(eq(managementSessions.tokenHash, hashSessionToken(management.token)));
        let targetId: string | undefined;
        if (enabled) {
          await withTransaction(suite.db, async (tx) => {
            const backend = new WorkforceBackend();
            const common = {
              ...venue.cfg,
              personId: venue.personId,
              origin: jobOrigin("dashboard"),
              offsetMinutes: 60,
            };
            await backend.clockIn(tx, { ...common, at: "2026-01-05T09:00:00Z" });
            await backend.clockOut(tx, { ...common, at: "2026-01-05T17:00:00Z" });
          });
          targetId = (await suite.db.select().from(timeEntries)).find(
            (e) => e.entryKind === "out",
          )!.id;
        }
        await stampDeployment(suite.db, "preproduction");
        if (mode === "mirror") {
          await setDeploymentMode(suite.db, venue.cfg.nodeId, "mirror");
          await writeMirrorConfig(suite.db, venue.cfg.nodeId, {
            relayUrl: "https://127.0.0.1:1/",
            boxHostname: "box.test",
            boxCaPem: "unused",
            originNodeId: venue.cfg.nodeId,
          });
        } else if (mode === "fenced") {
          await writeNodeMembership(
            suite.db,
            signedMembershipDoc(1, {
              signerNodeId: venue.cfg.nodeId,
              nodes: [
                { nodeId: venue.cfg.nodeId, contactUrl: "https://box.test", standing: "sell-only" },
              ],
            }),
          );
        } else if (mode === "secondary")
          await withTransaction(suite.db, (tx) =>
            setSingletonRoleTx(tx, venue.cfg.nodeId, "secondary"),
          );
        const scratch = await mkdtemp(join(tmpdir(), "waitron-response-boot-"));
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
        let resultIds: string[] = [];
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
          const get = (path: string, cookie: string, passive = false) =>
            fetch(`${origin}${path}`, {
              ...tls?.via,
              headers: { cookie, ...(passive ? { "x-waitron-live": "1" } : {}) },
            });
          const paths = [
            "/api/attendance/inbox",
            `/api/attendance/day?date=2026-01-05&locationId=${venue.cfg.locationId}`,
            `/api/attendance/commands/${crypto.randomUUID()}`,
            `/api/attendance/items/${crypto.randomUUID()}/approvers?action=approve`,
            "/management-api/attendance/lookups",
            `/management-api/attendance/queue?locationId=${venue.cfg.locationId}`,
            `/management-api/attendance/day?personId=${venue.personId}&locationId=${venue.cfg.locationId}&date=2026-01-05`,
            `/management-api/attendance/commands/${crypto.randomUUID()}`,
          ];
          if (enabled && mode === "primary") {
            const inboxResponse = await get(paths[0]!, venue.cookie);
            expect(inboxResponse.status).toBe(200);
            const inbox = (await inboxResponse.json()) as AttendanceInbox;
            expect(inbox).toMatchObject({ personId: venue.personId, prompts: [], items: [] });
            const beforePassive = statements.length;
            const lookup = await get("/management-api/attendance/lookups", managerCookie, true);
            expect(lookup.status).toBe(200);
            expect(await lookup.json()).toMatchObject({
              viewer: { personId: manager!.id, canSelfApprove: true },
            });
            expect(
              statements
                .slice(beforePassive)
                .filter((q) => /update\s+"management_sessions"/i.test(q)),
            ).toEqual([]);
            const body = {
              commandId: crypto.randomUUID(),
              expectedRevision: inbox.revision,
              action: "request",
              questionId: null,
              locationId: venue.cfg.locationId,
              changes: [
                { target: { entryId: targetId }, at: "2026-01-05T18:00:00Z", offsetMinutes: 60 },
              ],
              reason: "Worked late",
            };
            const write = await fetch(`${origin}/api/attendance/commands`, {
              method: "POST",
              headers: { cookie: venue.cookie, "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            expect(write.status).toBe(200);
            resultIds = ((await write.json()) as AttendanceCommandResult).entryIds;
            const beforeExplicit = statements.length;
            const queue = await get(
              `/management-api/attendance/queue?locationId=${venue.cfg.locationId}`,
              managerCookie,
            );
            expect(queue.status).toBe(200);
            expect(await queue.json()).toMatchObject({
              items: [{ id: resultIds[0], status: "waiting-manager" }],
            });
            expect(
              statements
                .slice(beforeExplicit)
                .some((q) => /update\s+"management_sessions"/i.test(q)),
            ).toBe(true);
          } else {
            for (const path of paths) {
              const response = await get(
                path,
                path.startsWith("/api/") ? venue.cookie : managerCookie,
              );
              if (mode === "setup" && path.startsWith("/api/")) {
                expect(response.status).toBe(200);
                expect(response.headers.get("content-type")).toContain("text/html");
                expect(await response.text()).toMatch(/set ?up/i);
              } else expect(response.status, path).toBe(404);
            }
            for (const path of [
              "/api/attendance/commands",
              "/management-api/attendance/commands",
            ]) {
              const response = await fetch(`${origin}${path}`, {
                ...tls?.via,
                method: "POST",
                headers: {
                  cookie: path.startsWith("/api/") ? venue.cookie : managerCookie,
                  "content-type": "application/json",
                },
                body: "{}",
              });
              expect(response.status).toBe(mode === "mirror" || mode === "fenced" ? 403 : 404);
              if (response.status === 403)
                expect(await response.json()).toMatchObject({ error: { code: "node.read_only" } });
            }
          }
          if (!enabled)
            expect(
              statements.filter((q) =>
                /\b(?:from|join|into|update)\s+["`[]?(?:attendance_\w*|time_entries|workforce_chains|shifts|roster_versions)\b/i.test(
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
        if (enabled && mode === "primary")
          expect(
            (
              await suite.db
                .select()
                .from(managementSessions)
                .where(eq(managementSessions.tokenHash, hashSessionToken(management.token)))
            )[0]!.lastSeenAt,
          ).not.toBe(oldSeenAt);
        if (enabled) {
          const rows = await suite.db.select().from(timeEntries);
          expect(rows).toHaveLength(mode === "primary" ? 3 : 2);
          if (resultIds.length)
            expect(rows.at(-1)).toMatchObject({
              id: resultIds[0],
              recordedByPersonId: venue.personId,
              capturedByDeviceId: venue.deviceId,
            });
        }
        expect((await suite.db.select().from(managementSessions)).length).toBeGreaterThan(0);
      },
      60_000,
    );
  });
}

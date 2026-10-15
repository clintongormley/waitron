import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  withTransaction,
  stampDeployment,
  setSingletonRoleTx,
  setDeploymentMode,
  writeMirrorConfig,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { jobOrigin } from "@waitron/shared";
import {
  WorkforceBackend,
  attendanceMail,
  attendanceQuestions,
  attendanceOperationFacts,
  attendanceSourceState,
  readChain,
  timeEntries,
} from "@waitron/workforce";
import { ALL_MODULES } from "./modules.js";
import type { StartedServer } from "./boot.js";
import { createClockVenue } from "./testing/clock-venue.js";
import { serverFixture } from "./testing/server-fixture.js";
import { copyMigrationsRoot, awaitListening } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { DEVICE_COOKIE } from "./device-session.js";
import * as discovery from "./attendance-discovery.js";
import * as attendance from "./attendance-loop.js";
import * as emailWorker from "./attendance-email-worker.js";
import * as email from "./attendance-email.js";
import * as mdns from "./mdns.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";

const { beforeServerStarts, startServer } = serverFixture();
const keyEnv = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const ring = loadKeyRing(keyEnv);
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
};

for (const enabled of [true, false]) {
  describe(`attendance boot with workforce ${enabled ? "enabled" : "never migrated"}`, () => {
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
    async function prepared() {
      beforeServerStarts();
      const venue = await createClockVenue(suite.db, () => new Date(), modules);
      const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-attendance-"));
      await copyMigrationsRoot(join(scratch, "migrations"));
      await writeFile(
        join(scratch, "modules.json"),
        JSON.stringify({ modules: Object.fromEntries([...disabled].map((name) => [name, false])) }),
      );
      const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
      const [port] = await freePorts(1);
      return {
        venue,
        scratch,
        port,
        env: {
          ...keyEnv,
          WAITRON_HTTP_LANDING_PORT: "0",
          WAITRON_HTTP_PORT: String(port),
          WAITRON_STATE_DIR: scratch,
          WAITRON_VENUE_DIR: dirname(database),
          WAITRON_TILL_NODE_ID: venue.cfg.nodeId,
          WAITRON_TILL_LOCATION_ID: venue.cfg.locationId,
          WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
          WAITRON_ENV: "preproduction",
        },
      };
    }
    it(
      enabled
        ? "starts both real duties, catches up, captures a real login and reopens with a new discovery generation"
        : "starts neither duty and makes no workforce SQL query on a real login",
      async () => {
        const f = await prepared();
        let server: StartedServer | undefined;
        const sender = vi.fn<email.AttendanceEmailSender>(async () => "sent");
        const sendSpy = vi.spyOn(email, "createAttendanceEmailSender").mockReturnValue(sender);
        const loopSpy = vi.spyOn(attendance, "runAttendanceLoop");
        const mailSpy = vi.spyOn(emailWorker, "runAttendanceEmailLoop");
        const discoverSpy = vi.spyOn(discovery, "beginAttendanceDiscovery");
        let other: string | undefined;
        if (enabled) {
          await withTransaction(suite.db, async (tx) => {
            const [person] = await tx
              .insert(persons)
              .values({
                displayName: "Missing worker",
                email: "missing@example.test",
                locale: "es-ES",
              })
              .returning();
            other = person!.id;
            await new WorkforceBackend().clockIn(tx, {
              nodeId: f.venue.cfg.nodeId,
              locationId: f.venue.cfg.locationId,
              personId: f.venue.personId,
              at: "2026-01-05T09:00:00Z",
              offsetMinutes: 60,
              origin: jobOrigin("dashboard"),
            });
            for (const personId of [f.venue.personId, other])
              await recordAttendanceFact(tx, {
                source: "order",
                key: `old-order:${personId}`,
                personId,
                locationId: f.venue.cfg.locationId,
                kind: "order",
                at: "2026-01-05T16:40:00Z",
                offsetMinutes: 60,
                outcome: "qualified",
              });
            await putCredential(tx, ring, {
              purpose: "email.smtp",
              value: { url: "smtp://127.0.0.1:1025", from: "venue@example.test" },
            });
          });
        }
        const statements: string[] = [],
          original = DatabaseSync.prototype.prepare;
        const sqlSpy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function (
          this: DatabaseSync,
          query: string,
        ) {
          statements.push(query);
          return original.call(this, query);
        });
        try {
          const started = await startServer(f.env).then(
            (server) => ({ server, error: null }),
            (error: unknown) => ({ server: undefined, error }),
          );
          expect(started.error).toBeNull();
          server = started.server!;
          await awaitListening(f.port);
          expect(loopSpy).toHaveBeenCalledTimes(enabled ? 1 : 0);
          expect(mailSpy).toHaveBeenCalledTimes(enabled ? 1 : 0);
          expect(discoverSpy).toHaveBeenCalledTimes(enabled ? 1 : 0);
          const deviceCookie = f.venue.cookie
            .split("; ")
            .find((cookie) => cookie.startsWith(`${DEVICE_COOKIE}=`))!;
          const login = await fetch(`http://127.0.0.1:${f.port}/api/session`, {
            method: "POST",
            headers: { cookie: deviceCookie, "Content-Type": "application/json" },
            body: JSON.stringify({ personId: f.venue.personId, pin: "5555" }),
          });
          expect(login.status).toBe(200);
          if (enabled) {
            await vi.waitFor(
              async () => {
                expect(await suite.db.select().from(timeEntries)).toMatchObject([
                  { entryKind: "in" },
                  {
                    entryKind: "out",
                    eventAt: "2026-01-05T16:40:00.000Z",
                    authorKind: "automatic",
                  },
                ]);
                expect(await suite.db.select().from(attendanceMail)).toMatchObject([
                  { status: "sent", recipient: "missing@example.test" },
                ]);
              },
              { timeout: 45_000, interval: 50 },
            );
            expect(sender).toHaveBeenCalledTimes(1);
            expect(sender.mock.calls[0]![0]).toMatchObject({
              recipient: "missing@example.test",
              locale: "es",
              businessDay: "2026-01-05",
              missingKinds: ["in", "out"],
            });
            expect(
              (await suite.db.select().from(attendanceOperationFacts)).some(
                (fact) => fact.source === "session" && fact.personId === f.venue.personId,
              ),
            ).toBe(true);
            expect(
              (await suite.db.select().from(attendanceQuestions)).some((q) => q.personId === other),
            ).toBe(true);
            await server.close();
            server = undefined;
            beforeServerStarts();
            const before = await readChain(suite.db, {
              nodeId: f.venue.cfg.nodeId,
              locationId: f.venue.cfg.locationId,
            });
            const generation = (await suite.db.select().from(attendanceSourceState)).find(
              (s) => s.recordKind === "scan",
            )!.generation;
            server = await startServer(f.env);
            await awaitListening(f.port);
            expect(discoverSpy).toHaveBeenCalledTimes(2);
            const reopened = (await suite.db.select().from(attendanceSourceState)).find(
              (s) => s.recordKind === "scan",
            )!.generation;
            expect(reopened).not.toBe(generation);
            await server.close();
            server = undefined;
            beforeServerStarts();
            expect(
              await readChain(suite.db, {
                nodeId: f.venue.cfg.nodeId,
                locationId: f.venue.cfg.locationId,
              }),
            ).toEqual(before);
            expect(sender).toHaveBeenCalledTimes(1);
          } else {
            const accesses = statements.filter((query) =>
              /\b(?:from|join|into|update)\s+["`[]?(?:attendance_\w*|time_entries|shifts|roster_versions)\b/i.test(
                query,
              ),
            );
            expect(accesses).toEqual([]);
            expect(sender).not.toHaveBeenCalled();
            expect(sendSpy).not.toHaveBeenCalled();
          }
        } finally {
          await server?.close();
          sqlSpy.mockRestore();
          sendSpy.mockRestore();
          loopSpy.mockRestore();
          mailSpy.mockRestore();
          discoverSpy.mockRestore();
          await rm(f.scratch, { recursive: true, force: true });
        }
      },
    );
    if (enabled) {
      it.each(["mirror", "fenced", "secondary", "setup"] as const)(
        "does not start attendance work in %s mode",
        async (mode) => {
          const f = await prepared();
          let server: StartedServer | undefined;
          await stampDeployment(suite.db, "preproduction");
          if (mode === "mirror") {
            await setDeploymentMode(suite.db, f.venue.cfg.nodeId, "mirror");
            await writeMirrorConfig(suite.db, f.venue.cfg.nodeId, {
              relayUrl: "https://127.0.0.1:1/",
              boxHostname: "box.test",
              boxCaPem: "unused",
              originNodeId: f.venue.cfg.nodeId,
            });
          } else if (mode === "fenced") {
            await writeNodeMembership(
              suite.db,
              signedMembershipDoc(1, {
                signerNodeId: f.venue.cfg.nodeId,
                nodes: [
                  {
                    nodeId: f.venue.cfg.nodeId,
                    contactUrl: "https://box.test",
                    standing: "sell-only",
                  },
                ],
              }),
            );
          } else if (mode === "secondary") {
            await withTransaction(suite.db, (tx) =>
              setSingletonRoleTx(tx, f.venue.cfg.nodeId, "secondary"),
            );
          }
          const loopSpy = vi.spyOn(attendance, "runAttendanceLoop"),
            mailSpy = vi.spyOn(emailWorker, "runAttendanceEmailLoop"),
            discoverSpy = vi.spyOn(discovery, "beginAttendanceDiscovery");
          try {
            server = await startServer(
              mode === "setup"
                ? { ...f.env, WAITRON_TILL_NODE_ID: undefined, WAITRON_TILL_LOCATION_ID: undefined }
                : f.env,
            );
            await awaitListening(f.port);
            expect(loopSpy).not.toHaveBeenCalled();
            expect(mailSpy).not.toHaveBeenCalled();
            expect(discoverSpy).not.toHaveBeenCalled();
          } finally {
            await server?.close();
            loopSpy.mockRestore();
            mailSpy.mockRestore();
            discoverSpy.mockRestore();
            await rm(f.scratch, { recursive: true, force: true });
          }
        },
      );
      it("normal close waits for both active duties before closing their database handle", async () => {
        const f = await prepared();
        const release = gate(),
          aborted = gate();
        let db: Database | undefined,
          aborts = 0,
          completed = false,
          server: StartedServer | undefined;
        const finished: string[] = [];
        const hold = (name: string) => async (deps: { db: Database; signal: AbortSignal }) => {
          db = deps.db;
          await new Promise<void>((resolve) =>
            deps.signal.addEventListener(
              "abort",
              () => {
                if (++aborts === 2) aborted.release();
                resolve();
              },
              { once: true },
            ),
          );
          await release.promise;
          expect(deps.db.all(sql`select 1 as alive`)).toEqual([{ alive: 1 }]);
          finished.push(name);
        };
        const loopSpy = vi.spyOn(attendance, "runAttendanceLoop").mockImplementation(hold("day"));
        const mailSpy = vi
          .spyOn(emailWorker, "runAttendanceEmailLoop")
          .mockImplementation(hold("mail"));
        let closing: Promise<void> | undefined;
        try {
          server = await startServer(f.env);
          await awaitListening(f.port);
          closing = server.close().then(() => {
            completed = true;
          });
          await aborted.promise;
          await new Promise<void>((resolve) => setImmediate(resolve));
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(completed).toBe(false);
          expect(finished).toEqual([]);
          expect(() => db!.all(sql`select 1 as alive`)).not.toThrow();
          release.release();
          await closing;
          server = undefined;
          expect(finished.sort()).toEqual(["day", "mail"]);
          expect(() => db!.all(sql`select 1 as alive`)).toThrow();
        } finally {
          release.release();
          await closing;
          await server?.close();
          loopSpy.mockRestore();
          mailSpy.mockRestore();
          await rm(f.scratch, { recursive: true, force: true });
        }
      });
      it("a failure creating the mail sender aborts and awaits the already-created day duty", async () => {
        const f = await prepared();
        const created = gate(),
          release = gate();
        let daySignal: AbortSignal | undefined,
          completed = false;
        const loopSpy = vi
          .spyOn(attendance, "runAttendanceLoop")
          .mockImplementation(async (deps) => {
            daySignal = deps.signal;
            await release.promise;
          });
        const mailSpy = vi.spyOn(emailWorker, "runAttendanceEmailLoop");
        const senderSpy = vi.spyOn(email, "createAttendanceEmailSender").mockImplementation(() => {
          created.release();
          throw new Error("creating mail sender");
        });
        const starting = startServer(f.env).then(
          () => {
            completed = true;
            return undefined;
          },
          (error: unknown) => {
            completed = true;
            return error;
          },
        );
        try {
          await created.promise;
          await vi.waitFor(() => expect(daySignal?.aborted).toBe(true));
          expect(completed).toBe(false);
          expect(mailSpy).not.toHaveBeenCalled();
          release.release();
          expect(await starting).toMatchObject({ message: "creating mail sender" });
        } finally {
          release.release();
          await starting;
          loopSpy.mockRestore();
          mailSpy.mockRestore();
          senderSpy.mockRestore();
          await rm(f.scratch, { recursive: true, force: true });
        }
      });
      it("failed startup aborts and awaits both duties before releasing the store", async () => {
        const f = await prepared();
        const signals: AbortSignal[] = [],
          finished: string[] = [];
        const hold = (name: string) => async (deps: { signal: AbortSignal }) => {
          signals.push(deps.signal);
          await new Promise<void>((resolve) =>
            deps.signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          await Promise.resolve();
          finished.push(name);
        };
        const loopSpy = vi.spyOn(attendance, "runAttendanceLoop").mockImplementation(hold("day"));
        const mailSpy = vi
          .spyOn(emailWorker, "runAttendanceEmailLoop")
          .mockImplementation(hold("mail"));
        const mdnsSpy = vi.spyOn(mdns, "startMdnsResponder").mockImplementation(() => {
          throw new Error("after attendance started");
        });
        try {
          await expect(startServer(f.env)).rejects.toThrow("after attendance started");
          expect(signals).toHaveLength(2);
          expect(signals.every((signal) => signal.aborted)).toBe(true);
          expect(finished.sort()).toEqual(["day", "mail"]);
          beforeServerStarts();
          expect((await suite.db.select().from(persons)).length).toBeGreaterThan(0);
        } finally {
          loopSpy.mockRestore();
          mailSpy.mockRestore();
          mdnsSpy.mockRestore();
          await rm(f.scratch, { recursive: true, force: true });
        }
      });
    }
  });
}

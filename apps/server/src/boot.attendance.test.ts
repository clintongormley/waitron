import { seedModuleSettings } from "../test/module-settings.js";
import { listAdminHolders } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { attendanceMailRows } from "@waitron/workforce/test/fixtures.js";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  type Database,
  stampDeployment,
  withNodeTransaction,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { setNodeMode, setSingletonRoleTx, writeMirrorLink } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { jobOrigin } from "@waitron/shared";
import {
  WorkforceBackend,
  attendanceQuestions,
  attendanceOperationFacts,
  attendanceSourceState,
  readChain,
  timeEntries,
} from "@waitron/workforce";
import { ALL_MODULES } from "./modules.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import type { StartedServer } from "./boot.js";
import { createClockVenue } from "./testing/clock-venue.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { copyMigrationsRoot, awaitListening } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { DEVICE_COOKIE } from "./device-session.js";
import * as discovery from "./attendance-discovery.js";
import * as attendance from "./attendance-loop.js";
import * as mailSender from "./mail-sender.js";
import type { MailTransport } from "./mail-sender.js";
import { attendanceReminderMessage } from "./attendance-email.js";
import * as smtpSend from "./smtp-send.js";
import * as mdns from "./mdns.js";
import * as deviceApi from "./device-api.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { establishNodeIdentity } from "./node-identity.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const { beforeServerStarts, startServer, httpPort } = ephemeralServerFixture();
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

describe("attendance boot with permanent workforce", () => {
  describe("real listener", () => {
    const disabled = new Set(["fiscal-none", "workforce-es"]);
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
      const administrator = (await listAdminHolders(suite.db))[0]!;
      const management = await withTransaction(suite.db, (tx) =>
        startManagementSession(tx, { personId: administrator.id }),
      );
      const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-attendance-"));
      await copyMigrationsRoot(join(scratch, "migrations"));
      await seedModuleSettings(
        suite.db,
        Object.fromEntries([...disabled].map((name) => [name, false])),
      );
      const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
      const [port] = await freePorts(1);
      return {
        venue,
        managementCookie: `${MANAGEMENT_COOKIE}=${management.token}`,
        scratch,
        port,
        env: {
          ...keyEnv,
          WAITRON_HTTP_LANDING_PORT: "0",
          WAITRON_HTTP_PORT: String(port),
          WAITRON_STATE_DIR: scratch,
          WAITRON_VENUE_DIR: dirname(database),
          WAITRON_NODE_ID: venue.cfg.nodeId,
          WAITRON_MIGRATIONS_DIR: join(scratch, "migrations"),
          WAITRON_ENV: "preproduction",
        },
      };
    }
    it("starts both real duties, catches up, captures a real login and reopens with retained discovery progress", async () => {
      const f = await prepared();
      let server: StartedServer | undefined;
      const sender = vi.fn<MailTransport>(async () => ({ status: "sent" }));
      const sendSpy = vi.spyOn(smtpSend, "sendSmtpMessage").mockImplementation(sender);
      const loopSpy = vi.spyOn(attendance, "runAttendanceLoop");
      const mailSpy = vi.spyOn(mailSender, "startMailSender");
      const discoverSpy = vi.spyOn(discovery, "beginAttendanceDiscovery");
      const deviceSpy = vi.spyOn(deviceApi, "mountDeviceApi");
      let other: string | undefined;
      {
        await withTransaction(suite.db, async (tx) => {
          const [person] = await seedPersons(tx, {
            displayName: "Missing worker",
            email: "missing@example.test",
            locale: "es-ES",
          });
          other = person!.id;
          await new WorkforceBackend().clockIn(tx, {
            nodeId: f.venue.cfg.nodeId,
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
      try {
        const started = await startServer(f.env).then(
          (server) => ({ server, error: null }),
          (error: unknown) => ({ server: undefined, error }),
        );
        expect(started.error).toBeNull();
        server = started.server!;
        await awaitListening(httpPort());
        const catalogue = await fetch(`http://127.0.0.1:${httpPort()}/management-api/modules`, {
          headers: { cookie: f.managementCookie },
        });
        expect(catalogue.status).toBe(200);
        const moduleRows = (await catalogue.json()) as { id: string; enabled: boolean }[];
        expect(moduleRows.find((row) => row.id === "workforce")).toBeUndefined();
        expect(loopSpy).toHaveBeenCalledTimes(1);
        expect(mailSpy).toHaveBeenCalledTimes(1);
        expect(
          mailSpy.mock.calls[0]![0].owners.some((owner) => owner.kind === "attendance_question"),
        ).toBe(true);
        expect(discoverSpy).toHaveBeenCalledTimes(1);
        const deviceDeps = deviceSpy.mock.calls[0]![1];
        expect(deviceDeps.attendance).toBe(recordAttendanceFact);
        expect(deviceDeps.attendanceClock).toBeDefined();
        const deviceCookie = f.venue.cookie
          .split("; ")
          .find((cookie) => cookie.startsWith(`${DEVICE_COOKIE}=`))!;
        const login = await fetch(`http://127.0.0.1:${httpPort()}/api/session`, {
          method: "POST",
          headers: { cookie: deviceCookie, "Content-Type": "application/json" },
          body: JSON.stringify({ personId: f.venue.personId, pin: "5555" }),
        });
        expect(login.status).toBe(200);
        {
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
              expect(await attendanceMailRows(suite.db)).toMatchObject([
                { status: "sent", recipient: "missing@example.test" },
              ]);
            },
            { timeout: 45_000, interval: 50 },
          );
          expect(sender).toHaveBeenCalledTimes(1);
          expect(sender.mock.calls[0]![1]).toEqual({
            to: "missing@example.test",
            ...attendanceReminderMessage({
              locale: "es",
              businessDay: "2026-01-05",
              venueName: "Clock venue",
              missingKinds: ["in", "out"],
            }),
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
          });
          const generation = (await suite.db.select().from(attendanceSourceState)).find(
            (s) => s.recordKind === "scan",
          )!.generation;
          const rotaScan = (await suite.db.select().from(attendanceSourceState)).find(
            (row) => row.recordKind === "scan" && row.source === "rota" && row.key === "shifts",
          )!;
          const storedVersions = (
            JSON.parse(JSON.parse(rotaScan.fingerprint!).store) as unknown[]
          )[3];
          expect(storedVersions).toEqual(
            Object.entries(
              await schemaVersionsByModule({ venue: suite.db, node: suite.node }, ALL_MODULES),
            ).sort(([a], [b]) => a.localeCompare(b)),
          );

          server = await startServer(f.env);
          await awaitListening(httpPort());
          expect(discoverSpy).toHaveBeenCalledTimes(2);
          const reopened = (await suite.db.select().from(attendanceSourceState)).find(
            (s) => s.recordKind === "scan",
          )!.generation;
          expect(reopened).toBe(generation);
          await server.close();
          server = undefined;
          beforeServerStarts();
          expect(
            await readChain(suite.db, {
              nodeId: f.venue.cfg.nodeId,
            }),
          ).toEqual(before);
          expect(sender).toHaveBeenCalledTimes(1);
        }
      } finally {
        await server?.close();
        sendSpy.mockRestore();
        loopSpy.mockRestore();
        mailSpy.mockRestore();
        discoverSpy.mockRestore();
        deviceSpy.mockRestore();
        await rm(f.scratch, { recursive: true, force: true });
      }
    });
    {
      it.each(["mirror", "fenced", "secondary", "setup"] as const)(
        "does not start attendance work in %s mode",
        async (mode) => {
          const f = await prepared();
          let server: StartedServer | undefined;
          await stampDeployment(suite.db, "preproduction");
          if (mode === "mirror") {
            await setNodeMode({ venue: suite.db, node: suite.node }, f.venue.cfg.nodeId, "mirror");
            await writeMirrorLink(suite.node, f.venue.cfg.nodeId, {
              originUrl: "https://127.0.0.1:1/",
              boxHostname: "box.test",
              boxCaPem: "unused",
              originNodeId: f.venue.cfg.nodeId,
            });
          } else if (mode === "fenced") {
            // A box its chart lists holds its signing key.
            await establishNodeIdentity(
              { ownerDb: suite.db, node: suite.node, ring },
              f.venue.cfg.nodeId,
            );
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
            await withNodeTransaction(suite.node, (tx) =>
              setSingletonRoleTx(tx, f.venue.cfg.nodeId, "secondary"),
            );
          }
          const loopSpy = vi.spyOn(attendance, "runAttendanceLoop"),
            mailSpy = vi.spyOn(mailSender, "startMailSender"),
            discoverSpy = vi.spyOn(discovery, "beginAttendanceDiscovery");
          try {
            server = await startServer(
              mode === "setup" ? { ...f.env, WAITRON_NODE_ID: undefined } : f.env,
            );
            await awaitListening(httpPort());
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
        const mailSpy = vi.spyOn(mailSender, "startMailSender").mockImplementation(hold("mail"));
        let closing: Promise<void> | undefined;
        try {
          server = await startServer(f.env);
          await awaitListening(httpPort());
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
        const senderSpy = vi.spyOn(mailSender, "startMailSender").mockImplementation(() => {
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
          release.release();
          expect(await starting).toMatchObject({ message: "creating mail sender" });
        } finally {
          release.release();
          await starting;
          loopSpy.mockRestore();
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
        const mailSpy = vi.spyOn(mailSender, "startMailSender").mockImplementation(hold("mail"));
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
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  CORE_MIGRATIONS,
  setDeploymentMode,
  stampDeployment,
  writeMirrorConfig,
  writeNodeMembership,
} from "@waitron/db";
import { Hono } from "hono";
import { locationId, nodeId } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import { ALL_MODULES } from "./modules.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import type { TillClockState } from "./till-clock-state.js";
import { timeEntries } from "@waitron/workforce";
import { createClockVenue } from "./testing/clock-venue.js";
import { awaitListening, copyMigrationsRoot } from "./testing/boot-harness.js";
import { freePorts } from "./testing/free-ports.js";
import { serverFixture } from "./testing/server-fixture.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { mountTillApi } from "./till-api.js";
import { makeFiscalBackend, systemClock } from "./till-backend.js";
import { serveRecovery } from "./node-entry.js";
import { recoveryApp } from "./recovery-surface.js";
import { FRESH } from "./recovery-state.js";

const { beforeServerStarts, startServer } = serverFixture();

it("the real recovery listener serves its recovery status and no clock routes", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "waitron-recovery-no-clock-"));
  const [port] = await freePorts(1);
  const app = recoveryApp({
    state: { ...FRESH, level: "recovery", failures: 3 },
    logDir: scratch,
    onRetry: async () => {},
  });
  const server = await serveRecovery(app, { stateDir: scratch, port, log: () => {} });
  try {
    const origin = `http://127.0.0.1:${port}`;
    const status = await fetch(`${origin}/recovery-api/status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ level: "recovery", failures: 3 });
    for (const path of ["state", "in", "out", "break-start", "break-end"])
      expect(
        (await fetch(`${origin}/api/clock/${path}`, { method: path === "state" ? "GET" : "POST" }))
          .status,
      ).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
    await rm(scratch, { recursive: true, force: true });
  }
});

describe("mounted till clock source", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  it("uses the injected server instant for own state and recorded clock events", async () => {
    const at = new Date("2030-02-05T09:00:00Z");
    const venue = await createClockVenue(suite.db, () => at);
    const app = new Hono();
    const system = systemClock();
    mountTillApi(
      app,
      {
        db: suite.db,
        cfg: venue.cfg,
        clock: { ...system, now: () => ({ ...system.now(), instant: at }) },
        backend: makeFiscalBackend(
          ALL_MODULES.filter((m) => m.name === "fiscal-none"),
          "none",
          suite.db,
          {},
        ),
        secureCookies: false,
        venueLocale: "en-GB",
        workforceEnabled: true,
      },
      () => {},
    );
    const read = await app.request("/api/clock/state", { headers: { cookie: venue.cookie } });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ businessDay: "2030-02-05", state: "out" });
    const written = await app.request("/api/clock/in", {
      method: "POST",
      headers: { cookie: venue.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedEntryId: null }),
    });
    expect(written.status).toBe(200);
    expect(await written.json()).toMatchObject({ businessDay: "2030-02-05", state: "working" });
    expect(await suite.db.select({ at: timeEntries.eventAt }).from(timeEntries)).toEqual([
      { at: at.toISOString() },
    ]);
  });
});

describe("clock handler absence with identity and workforce absent", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  it("a disabled direct mount serves no clock handler without querying either absent module", async () => {
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: suite.db,
        backend: makeFiscalBackend(
          ALL_MODULES.filter((m) => m.name === "fiscal-none"),
          "none",
          suite.db,
          {},
        ),
        clock: systemClock(),
        cfg: {
          nodeId: nodeId("10000000-0000-4000-8000-000000000001"),
          locationId: locationId("20000000-0000-4000-8000-000000000001"),
          locale: "en",
          invoiceLocales: ["en"],
          tipsEnabled: false,
          simplifiedInvoiceLimit: null,
        },
        secureCookies: false,
        venueLocale: "en-GB",
        workforceEnabled: false,
      },
      () => {},
    );
    for (const path of ["state", "in", "out", "break-start", "break-end"])
      expect(
        (await app.request(`/api/clock/${path}`, { method: path === "state" ? "GET" : "POST" }))
          .status,
      ).toBe(404);
    expect(
      suite.db.all(sql`select name from sqlite_schema where name in ('persons', 'time_entries')`),
    ).toEqual([]);
  });
});

describe("read-only real boot clocking", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
  it.each(["mirror", "fenced"] as const)(
    "a %s advertises no clocking and refuses clock writes",
    async (mode) => {
      beforeServerStarts();
      const venue = await createClockVenue(suite.db, () => new Date());
      await stampDeployment(suite.db, "preproduction");
      if (mode === "mirror") {
        await setDeploymentMode(suite.db, venue.cfg.nodeId, "mirror");
        await writeMirrorConfig(suite.db, venue.cfg.nodeId, {
          relayUrl: "https://127.0.0.1:1/",
          boxHostname: "box.test",
          boxCaPem: "unused",
          originNodeId: venue.cfg.nodeId,
        });
      } else {
        await writeNodeMembership(
          suite.db,
          signedMembershipDoc(1, {
            signerNodeId: venue.cfg.nodeId,
            nodes: [
              { nodeId: venue.cfg.nodeId, contactUrl: "https://box.test", standing: "sell-only" },
            ],
          }),
        );
      }
      const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-read-only-clock-"));
      let server: StartedServer | undefined;
      try {
        await copyMigrationsRoot(join(scratch, "migrations"));
        await writeFile(
          join(scratch, "modules.json"),
          JSON.stringify({ modules: { "fiscal-none": false } }),
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
        const origin = `http://127.0.0.1:${port}`;
        const boot = await fetch(`${origin}/api/till`, { headers: { cookie: venue.cookie } });
        expect(boot.status).toBe(200);
        expect(await boot.json()).toMatchObject({ clockingAvailable: false });
        for (const path of ["in", "out", "break-start", "break-end"]) {
          const response = await fetch(`${origin}/api/clock/${path}`, {
            method: "POST",
            headers: { cookie: venue.cookie, "Content-Type": "application/json" },
            body: JSON.stringify({ expectedEntryId: null }),
          });
          expect(response.status).toBe(403);
          expect(await response.json()).toEqual({ error: { code: "node.read_only", params: {} } });
        }
      } finally {
        await server?.close();
        await rm(scratch, { recursive: true, force: true });
      }
      beforeServerStarts();
      expect(suite.db.all(sql`select id from time_entries`)).toEqual([]);
    },
    60_000,
  );
});

for (const enabled of [true, false]) {
  describe(`real trading listener with workforce ${enabled ? "on" : "off"}`, () => {
    const disabled = new Set([
      "fiscal-none",
      "workforce-es",
      ...(enabled ? [] : ["workforce", "staffing"]),
    ]);
    const modules = ALL_MODULES.filter((m) => !disabled.has(m.name));
    const suite = useVenueDb({
      migrations: migrationOptionsFor(
        manifestSets().filter((s) => !disabled.has(s.name)),
        null,
      ),
    });

    it(
      enabled
        ? "clocks through the real login and all four writes without workforce-es"
        : "signs in normally without workforce tables and serves no clock routes",
      async () => {
        beforeServerStarts();
        const venue = await createClockVenue(suite.db, () => new Date(), modules);
        const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-till-clock-"));
        let server: StartedServer | undefined;
        try {
          await copyMigrationsRoot(join(scratch, "migrations"));
          await writeFile(
            join(scratch, "modules.json"),
            JSON.stringify({
              modules: Object.fromEntries([...disabled].map((name) => [name, false])),
            }),
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
          const origin = `http://127.0.0.1:${port}`;
          const deviceCookie = venue.cookie
            .split("; ")
            .find((cookie) => cookie.startsWith(`${DEVICE_COOKIE}=`))!;
          const login = await fetch(`${origin}/api/session`, {
            method: "POST",
            headers: { cookie: deviceCookie, "Content-Type": "application/json" },
            body: JSON.stringify({ personId: venue.personId, pin: "5555" }),
          });
          expect(login.status).toBe(200);
          expect(await login.json()).toMatchObject({ personId: venue.personId });
          const sessionCookie = login.headers
            .getSetCookie()
            .find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))!
            .split(";")[0]!;
          const cookie = `${deviceCookie}; ${sessionCookie}`;
          const boot = await fetch(`${origin}/api/till`, { headers: { cookie } });
          expect(boot.status).toBe(200);
          expect(await boot.json()).toMatchObject({ clockingAvailable: enabled });
          const read = async () => {
            const response = await fetch(`${origin}/api/clock/state`, { headers: { cookie } });
            expect(response.status).toBe(200);
            return (await response.json()) as TillClockState;
          };
          if (enabled) {
            let state = await read();
            expect(state).toMatchObject({
              personId: venue.personId,
              state: "out",
              lastEntryId: null,
              firstClockIn: true,
            });
            for (const [path, wanted] of [
              ["in", "working"],
              ["break-start", "on_break"],
              ["break-end", "working"],
              ["out", "out"],
            ] as const) {
              const response = await fetch(`${origin}/api/clock/${path}`, {
                method: "POST",
                headers: { cookie, "Content-Type": "application/json" },
                body: JSON.stringify({ expectedEntryId: state.lastEntryId }),
              });
              expect(response.status, path).toBe(200);
              state = (await response.json()) as TillClockState;
              expect(state).toMatchObject({
                personId: venue.personId,
                state: wanted,
                firstClockIn: false,
              });
            }
            expect(await read()).toEqual(state);
          } else {
            for (const path of ["state", "in", "out", "break-start", "break-end"]) {
              const response = await fetch(`${origin}/api/clock/${path}`, {
                method: path === "state" ? "GET" : "POST",
                headers: { cookie },
              });
              expect(response.status, path).toBe(404);
            }
          }
        } finally {
          await server?.close();
          await rm(scratch, { recursive: true, force: true });
        }
        beforeServerStarts();
        expect(
          suite.db.all(
            sql`select name from sqlite_schema where type = 'table' and name = 'time_entries'`,
          ),
        ).toHaveLength(enabled ? 1 : 0);
        expect(
          suite.db.all(
            sql`select name from sqlite_schema where type = 'table' and name = 'convenio_config'`,
          ),
        ).toHaveLength(0);
      },
      60_000,
    );
  });
}

import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Agent } from "undici";
import { describe, expect, it, vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applicationVersion } from "@waitron/db";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { createClockVenue } from "./testing/clock-venue.js";
import { mountTillApi } from "./till-api.js";
import { makeFiscalBackend, systemClock } from "./till-backend.js";
import { ALL_MODULES } from "./modules.js";
import { requestIdMiddleware } from "./request-id.js";
import { buildHeaderMiddleware } from "./build-header.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

const terminators = ["%0A", "%0D", "%E2%80%A8", "%E2%80%A9"];
const { startServer, httpPort } = ephemeralServerFixture();

it("keeps setup boot's request identification and reset refusal on encoded line terminators", async () => {
  const root = await mkdtemp(join(tmpdir(), "waitron-router-boundary-"));
  try {
    const migrations = join(root, "migrations");
    for (const [index, set] of manifestSets().entries()) {
      await cp(
        migrationOptionsFor(manifestSets(), null)[index]!.migrationsFolder,
        join(migrations, set.name),
        {
          recursive: true,
        },
      );
    }
    const state = join(root, "state");
    const server = await startServer({
      WAITRON_VENUE_DIR: join(root, "venue"),
      WAITRON_STATE_DIR: state,
      WAITRON_HTTP_PORT: "3000",
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MIGRATIONS_DIR: migrations,
      WAITRON_ENV: "preproduction",
    });
    try {
      const client = new Agent({ connect: { ca: await readFile(join(state, "tls", "ca.crt")) } });
      const via = { dispatcher: client } as RequestInit & { dispatcher: Agent };
      try {
        const base = `https://127.0.0.1:${httpPort()}`;
        const status = await fetch(`${base}/setup-api/status`, via);
        expect(status.status).toBe(200);
        expect(await status.json()).toMatchObject({ provisioned: false });
        for (const suffix of ["missing", ...terminators]) {
          const requestId = `setup-boundary-${terminators.indexOf(suffix) + 1}`;
          const response = await fetch(`${base}/management-api/${suffix}`, {
            ...via,
            headers: { "x-request-id": requestId },
          });
          expect(response.status).toBe(404);
          expect.soft(response.headers.get("x-request-id"), suffix).toBe(requestId);
          expect
            .soft(response.headers.get("x-waitron-build"), suffix)
            .toBe(applicationVersion(process.env));
          expect
            .soft(await response.text(), suffix)
            .toBe(JSON.stringify({ error: { code: "node.reset", params: {} } }));
        }
      } finally {
        await client.close();
      }
    } finally {
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe("the real till routes over HTTP", () => {
  const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

  it("retains till session checks and request headers for malformed clock paths", async () => {
    const at = new Date("2030-02-05T09:00:00Z");
    const venue = await createClockVenue(suite.db, () => at);
    const app = new Hono();
    app.use(
      "*",
      requestIdMiddleware(
        () => {},
        () => at,
      ),
    );
    app.use("*", buildHeaderMiddleware("router-boundary-build"));
    const clock = systemClock();
    mountTillApi(
      app,
      {
        admission: testTradingAdmission(),
        db: suite.db,
        cfg: venue.cfg,
        clock: { ...clock, now: () => ({ ...clock.now(), instant: at }) },
        backend: makeFiscalBackend(
          ALL_MODULES.filter((module) => module.name === "fiscal-none"),
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
    const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
    try {
      if (!server.listening) await once(server, "listening");
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const denied = await fetch(`${base}/api/clock/state`);
      expect(denied.status).toBe(401);
      expect(await denied.json()).toMatchObject({ error: { code: "session.required" } });
      const allowed = await fetch(`${base}/api/clock/state`, {
        headers: { cookie: venue.cookie },
      });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({ state: "out" });
      for (const suffix of ["missing", ...terminators]) {
        const response = await fetch(`${base}/api/clock/${suffix}`, {
          method: "POST",
          headers: { "x-request-id": "till-boundary" },
        });
        expect(response.status).toBe(404);
        expect(response.headers.get("x-request-id"), suffix).toBe("till-boundary");
        expect(response.headers.get("x-waitron-build"), suffix).toBe("router-boundary-build");
        await response.body?.cancel();
      }
      const unchanged = await fetch(`${base}/api/clock/state`, {
        headers: { cookie: venue.cookie },
      });
      expect(await unchanged.json()).toMatchObject({ state: "out" });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

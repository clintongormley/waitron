import {
  agreeInternet,
  archiveCommand,
  archiveHost,
  bucketCommand,
  node,
  recordedRecoveryRows,
  recoveryInvoices,
  suite,
} from "../test/hour-recovery-host.js";
import { once } from "node:events";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Agent } from "undici";
import { eq, ne } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";
import {
  incidents,
  locations,
  nodes,
  openVenueDatabase,
  readVenueHolder,
  withTransaction,
} from "@waitron/db";
import { hashPassword, persons } from "@waitron/identity";
import { runRestore } from "./restore-command.js";
import { runEntry } from "./node-entry.js";
import { loadBoxEnv } from "./box-env.js";
import { readRecoveryState, writeRecoveryState } from "./recovery-state.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { serverFixture } from "./testing/server-fixture.js";
import { TRADING_STATE_DIR, withMockedKill } from "./testing/boot-harness.js";
import { runPendingCardLoop } from "./pending-card-recovery.js";
import { runAttendanceLoop } from "./attendance-loop.js";
import type { StartedServer } from "./boot.js";

const listener = vi.hoisted(() => ({
  current: undefined as ReturnType<typeof import("@hono/node-server").serve> | undefined,
}));
vi.mock("@hono/node-server", async (load) => {
  const actual = await load<typeof import("@hono/node-server")>();
  return {
    ...actual,
    serve: vi.fn((options, onListen) => {
      listener.current = actual.serve({ ...options, port: 0 }, onListen);
      return listener.current;
    }),
  };
});
vi.mock("./pending-card-recovery.js", async (load) => {
  const a = await load<typeof import("./pending-card-recovery.js")>();
  return { ...a, runPendingCardLoop: vi.fn(a.runPendingCardLoop) };
});
vi.mock("./attendance-loop.js", async (load) => {
  const a = await load<typeof import("./attendance-loop.js")>();
  return { ...a, runAttendanceLoop: vi.fn(a.runAttendanceLoop) };
});

afterAll(async () => {
  if (TRADING_STATE_DIR !== undefined)
    await rm(TRADING_STATE_DIR, { recursive: true, force: true });
});

it.each(["archive", "bucket"] as const)(
  "%s restores an invalid zone before real entry/boot repair and restart",
  async (kind) => {
    await withTransaction(suite.db, async (tx) => {
      await tx.delete(nodes).where(ne(nodes.locationId, node.locationId));
      await tx.delete(locations).where(ne(locations.id, node.locationId));
    });
    await recoveryInvoices();
    await suite.db
      .update(locations)
      .set({ timeZone: "Invalid/Zone" })
      .where(eq(locations.id, node.locationId));
    const password = "SyntheticRestorePassword123";
    await suite.db.insert(persons).values({
      displayName: "Restore manager",
      role: "manager",
      email: "restore@example.test",
      passwordHash: hashPassword(password),
    });
    let token = "";
    const before = await recordedRecoveryRows(suite.db);
    const source = kind === "archive" ? await archiveHost() : await bucketCommand();
    const command = "restore" in source ? await archiveCommand(source) : source.deps;
    const roots = "restore" in source ? source.roots : source.f.roots;
    agreeInternet();
    const output: string[] = [];
    expect(
      await runRestore({ ...command, out: (line) => output.push(line) }),
      output.join("\n"),
    ).toBe(0);
    const tls = await ensureBoxSecrets({
      stateDir: roots.stateDir,
      hostnames: ["localhost"],
      listIpv4: () => ["127.0.0.1"],
      now: () => new Date(),
    });
    const agent = new Agent({ connect: { ca: await readFile(tls.caCertFile, "utf8") } });
    const origin = "https://localhost:32123";
    const env = {
      ...command.env,
      WAITRON_ENV: "preproduction",
      WAITRON_HTTP_PORT: "32123",
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_MANAGEMENT_ORIGIN: origin,
      WAITRON_ACCOUNT_KEY: Buffer.alloc(32, 11).toString("base64"),
      WAITRON_TLS_CERT_FILE: tls.certFile,
      WAITRON_TLS_KEY_FILE: tls.keyFile,
      WAITRON_LOG_DIR: join(roots.stateDir, "logs"),
    };
    await mkdir(env.WAITRON_LOG_DIR, { recursive: true });
    const fixture = serverFixture();
    let server: StartedServer | undefined;
    let url: string;
    const entry = async () => {
      await runEntry({
        args: [],
        baseEnv: env,
        ...roots,
        migrationsRoot: command.env.WAITRON_MIGRATIONS_DIR!,
        loadBoxEnv,
        readRecoveryState,
        writeRecoveryState,
        startServer: async (loaded, base) => (server = await fixture.startServer(loaded, base)),
        serveRecovery: async () => {
          throw new Error("unexpected diagnostic recovery");
        },
        installShutdownHandlers: () => {},
        scheduleStayedUp: () => {},
        log: () => {},
      });
      expect(server).toBeDefined();
      if (!listener.current!.listening) await once(listener.current!, "listening");
      url = `https://127.0.0.1:${(listener.current!.address() as AddressInfo).port}`;
    };
    const request = (path: string, method = "GET", body?: unknown) =>
      fetch(`${url}${path}`, {
        method,
        dispatcher: agent,
        headers: {
          cookie: `waitron_management_session=${token}`,
          origin,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      } as RequestInit);
    try {
      vi.mocked(runPendingCardLoop).mockClear();
      vi.mocked(runAttendanceLoop).mockClear();
      await entry();
      const login = await request("/management-api/session", "POST", {
        email: "restore@example.test",
        password,
      });
      expect(login.status).toBe(200);
      token = login.headers.get("set-cookie")!.split(";", 1)[0]!.split("=", 2)[1]!;
      await login.body?.cancel();
      expect(await (await request("/api/node")).json()).toEqual({ acceptingSales: false });
      expect(await (await request("/health")).json()).toEqual({
        ok: true,
        tradingAvailable: false,
      });
      const path = "/management-api/venue-details/time-zone-repair";
      expect(await (await request(path)).json()).toMatchObject({
        eligible: true,
        category: "invalid",
        nodeId: node.nodeId,
      });
      expect(runPendingCardLoop).not.toHaveBeenCalled();
      expect(runAttendanceLoop).not.toHaveBeenCalled();
      await withMockedKill(async (kills) => {
        const response = await request(path, "POST", {
          timeZone: "Europe/Madrid",
          expectedClockRevision: 0,
          confirmed: true,
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          repaired: true,
          clockRevision: 1,
          admission: "restart_required",
        });
        await vi.waitFor(() => expect(kills).toEqual([{ pid: process.pid, signal: "SIGTERM" }]));
        expect(await (await request("/api/node")).json()).toEqual({ acceptingSales: false });
        await server!.close();
        server = undefined;
      });
      expect(readVenueHolder(roots.venueDir)).toBeNull();
      const placed = await openVenueDatabase(roots.venueDir);
      try {
        expect(await recordedRecoveryRows(placed.venue)).toEqual(before);
        expect((await placed.venue.select().from(locations))[0]!.timeZone).toBe("Europe/Madrid");
        expect(
          await placed.venue
            .select()
            .from(incidents)
            .where(eq(incidents.code, "venue.time_zone_repaired")),
        ).toHaveLength(1);
      } finally {
        await placed.close();
      }
      await entry();
      expect((await (await request("/api/node")).json()).acceptingSales).toBe(true);
      expect(runPendingCardLoop).toHaveBeenCalledOnce();
      expect(runAttendanceLoop).toHaveBeenCalledOnce();
    } finally {
      await server?.close();
      await agent.close();
    }
    expect(readVenueHolder(roots.venueDir)).toBeNull();
  },
);

import { probeNetwork } from "@waitron/print-agent-app/tcp-probe.js";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { enqueuePrintJob, esc } from "@waitron/printing";
import { FakeSink, NetworkTcpTransport, RoutingTransport, createAgent } from "@waitron/print-agent";
import { fakeHost } from "@waitron/print-agent/testing/fake-host.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountPrintApi } from "./print-api.js";
import { mountJoinApi } from "./join-api.js";
import { mountNodeApi } from "./node-api.js";
import { createPairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

// The whole print-agent path in one process with no real hardware: the real routes driven by the real
// agent loop, whose fetch is routed into `app.request`. It lives in apps/server because packages never
// import apps, so the agent package cannot reach the routes it must be proven against.
const noopLog: Logger = () => {};

const BASE = "http://waitron.e2e";

// Reported in every pull's inventory and registered as the usb printer's `local_key`; the two must
// match for the server to judge the usb job eligible for this box.
const USB_SERIAL = "USB-SN-E2E";

let locationId: string;
let cfg: TillConfig;
let managerCookie: string;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    await seedTenant(db);
    // Through the table definition: `locations.id` is a `$defaultFn` generator a raw insert never
    // reaches.
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    locationId = loc!.id;
    // Knock and accept must share this one cfg: every join-request statement filters by node.
    cfg = {
      tillId: brandTillId(randomUUID()),
      nodeId: brandNodeId(randomUUID()),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(locationId),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      tipsEnabled: false,
      orderFlow: "ticket_then_pay",
    };
    const managerSid = await withTransaction(db, async (tx) => {
      const [mgr] = await tx
        .insert(persons)
        .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
        .returning({ id: persons.id });
      const session = await startManagementSession(tx, { personId: mgr!.id });
      return session.token;
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
  },
});

interface LoopbackPrinter {
  host: string;
  port: number;
  firstConnection: Promise<Buffer>;
  close(): Promise<void>;
}

async function startLoopbackPrinter(): Promise<LoopbackPrinter> {
  let resolveBytes!: (bytes: Buffer) => void;
  const firstConnection = new Promise<Buffer>((resolve) => {
    resolveBytes = resolve;
  });
  const server = net.createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    // NetworkTcpTransport half-closes after flushing, so `end` marks the full payload in.
    socket.on("end", () => resolveBytes(Buffer.concat(chunks)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;
  return {
    host: "127.0.0.1",
    port: address.port,
    firstConnection,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function send(
  app: Hono,
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie !== undefined) headers["cookie"] = opts.cookie;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

async function jobStatus(jobId: string): Promise<string> {
  const { rows } = await suite.db.execute<{ status: string }>(
    sql`select status from print_jobs where id = ${jobId}`,
  );
  return rows[0]!.status;
}

let printer: LoopbackPrinter | undefined;

beforeEach(async () => {
  printer = await startLoopbackPrinter();
});

afterEach(async () => {
  if (printer !== undefined) await printer.close();
  printer = undefined;
});

describe("print-agent end to end", () => {
  it("checks a requested address through an accepted agent and makes it available to Add without sending bytes", async () => {
    const loopback = printer!;
    const app = new Hono();
    const pairingMode = createPairingMode();
    pairingMode.open();
    mountPrintApi(
      app,
      { db: suite.db, cfg, pairingMode, readMembership: async () => null, venueLocale: "es-ES" },
      noopLog,
    );
    mountJoinApi(app, { db: suite.db, cfg, pairingMode }, noopLog);
    mountNodeApi(
      app,
      {
        nodeId: cfg.nodeId,
        acceptingSales: true,
        environment: "preproduction",
        readMembership: async () => null,
      },
      noopLog,
    );
    const host = fakeHost({
      config: { serverUrl: BASE, name: "Address agent" },
      probeNetwork,
      fetch: (input, init) => Promise.resolve(app.request(input, init)),
    });
    host.now = Date.now;
    const agent = createAgent({ host });
    await agent.runOnce();
    const joinId = (await host.token())!.split(".")[0]!;
    const choice = host.statuses.find(
      (status) => status.verificationCode !== undefined,
    )!.verificationCode;
    expect(
      (
        await send(app, "POST", `/management-api/print-agent-join-requests/${joinId}/accept`, {
          cookie: managerCookie,
          body: { choice },
        })
      ).status,
    ).toBe(204);
    const requested = await send(app, "POST", "/management-api/printer-discovery/probe", {
      cookie: managerCookie,
      body: { host: loopback.host, port: loopback.port },
    });
    expect(requested.status).toBe(200);
    const target = (await requested.json()) as { requestedAt: number };
    await agent.runOnce();
    await agent.runOnce();
    expect(await loopback.firstConnection).toEqual(Buffer.alloc(0));
    const discovery = await send(app, "GET", "/management-api/discovered-printers", {
      cookie: managerCookie,
    });
    const rows = (await discovery.json()) as Array<{
      host: string;
      port: number;
      lastSeenAt: string;
    }>;
    expect(rows).toEqual([
      expect.objectContaining({
        host: loopback.host,
        port: loopback.port,
        transport: "network_tcp",
        alreadyRegistered: false,
      }),
    ]);
    expect(Date.parse(rows[0]!.lastSeenAt)).toBeGreaterThanOrEqual(target.requestedAt);
    expect(
      (
        await send(app, "POST", "/management-api/printers", {
          cookie: managerCookie,
          body: {
            name: "Known address",
            transport: "network_tcp",
            host: loopback.host,
            port: loopback.port,
          },
        })
      ).status,
    ).toBe(201);
  });

  it("joins, is accepted, pulls with inventory, delivers a network + a usb job, marks both done — then revoke halts it", async () => {
    const loopback = printer!;

    // `/api/node` must answer an accepting primary in the agent's environment, or the agent's router
    // will not talk to the configured address.
    const app = new Hono();
    const pairingMode = createPairingMode();
    pairingMode.open();
    mountPrintApi(
      app,
      { db: suite.db, cfg, pairingMode, readMembership: async () => null, venueLocale: "es-ES" },
      noopLog,
    );
    mountJoinApi(app, { db: suite.db, cfg, pairingMode }, noopLog);
    mountNodeApi(
      app,
      {
        nodeId: cfg.nodeId,
        acceptingSales: true,
        environment: "preproduction",
        readMembership: async () => null,
      },
      noopLog,
    );

    const usbSink = new FakeSink();
    const transport = new RoutingTransport({
      network_tcp: new NetworkTcpTransport(),
      usb: usbSink,
      bluetooth: new FakeSink(),
    });
    const host = fakeHost({
      config: { serverUrl: BASE, name: "e2e" },
      transport,
      visibleDevices: async () => [{ transport: "usb", localKey: USB_SERIAL }],
      fetch: (input, init) => Promise.resolve(app.request(input, init)),
    });
    const agent = createAgent({ host });

    await agent.runOnce();
    expect(agent.status.phase).toBe("pending");
    const verificationNumber = [...host.statuses]
      .reverse()
      .find((s) => s.verificationCode !== undefined)?.verificationCode;
    expect(verificationNumber).toMatch(/^\d{2}$/);
    // The bearer is `${joinId}.${secret}`.
    const token = await host.token();
    expect(token).not.toBeNull();
    const joinId = token!.slice(0, token!.indexOf("."));

    // The pending list must not carry the verification number; `toEqual` refuses any extra field.
    const listRes = await send(app, "GET", "/management-api/join-requests?kind=print_agent", {
      cookie: managerCookie,
    });
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual([
      { id: joinId, kind: "print_agent", label: "e2e", createdAt: expect.any(String) },
    ]);

    const challengeRes = await send(
      app,
      "GET",
      `/management-api/join-requests/${joinId}/challenge`,
      {
        cookie: managerCookie,
      },
    );
    expect(challengeRes.status).toBe(200);
    const { choices } = (await challengeRes.json()) as { choices: string[] };
    expect(choices).toContain(verificationNumber);

    const acceptRes = await send(
      app,
      "POST",
      `/management-api/print-agent-join-requests/${joinId}/accept`,
      { cookie: managerCookie, body: { choice: verificationNumber } },
    );
    expect(acceptRes.status).toBe(204);

    // Neither printer carries an agent binding: which box serves it is derived at pull time.
    const printerRes = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "Cocina",
        transport: "network_tcp",
        host: loopback.host,
        port: loopback.port,
      },
    });
    expect(printerRes.status).toBe(201);
    const printerId = ((await printerRes.json()) as { id: string }).id;

    const usbPrinterRes = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: { name: "Barra USB", transport: "usb", localKey: USB_SERIAL },
    });
    expect(usbPrinterRes.status).toBe(201);
    const usbPrinterId = ((await usbPrinterRes.json()) as { id: string }).id;

    await agent.runOnce();
    expect(agent.status.phase).toBe("running");

    const networkPayload = esc().text("Mesa 4").cut().bytes();
    const usbPayload = esc().text("Barra 2").cut().bytes();
    const { jobId } = await withTransaction(suite.db, async (tx) => {
      return enqueuePrintJob(tx, { locationId }, printerId, networkPayload);
    });
    const { jobId: usbJobId } = await withTransaction(suite.db, async (tx) => {
      return enqueuePrintJob(tx, { locationId }, usbPrinterId, usbPayload);
    });

    await agent.runOnce();
    expect(agent.status.phase).toBe("running");
    const received = await loopback.firstConnection;
    expect(received.equals(Buffer.from(networkPayload))).toBe(true);
    expect(usbSink.written).toHaveLength(1);
    expect(usbSink.written[0]!.printerId).toBe(usbPrinterId);
    expect(Buffer.from(usbSink.written[0]!.bytes).equals(Buffer.from(usbPayload))).toBe(true);
    expect(await jobStatus(jobId)).toBe("done");
    expect(await jobStatus(usbJobId)).toBe("done");

    const revokeRes = await send(app, "POST", `/management-api/print-agents/${joinId}/revoke`, {
      cookie: managerCookie,
    });
    expect(revokeRes.status).toBe(204);

    await agent.runOnce();
    expect(agent.status.phase).toBe("unauthorized");
    expect(await host.token()).toBeNull();

    const enqueuedAfterRevoke = await withTransaction(suite.db, async (tx) => {
      return enqueuePrintJob(tx, { locationId }, printerId, esc().text("Ignored").bytes());
    });
    await agent.runOnce();
    expect(agent.status.phase).toBe("unauthorized");
    expect(await jobStatus(enqueuedAfterRevoke.jobId)).toBe("queued");
  });
});

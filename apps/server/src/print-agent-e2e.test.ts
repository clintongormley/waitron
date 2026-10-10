import { probeNetwork } from "@waitron/print-agent-app/tcp-probe.js";
import { createLinuxDevices } from "@waitron/print-agent-app/linux-devices.js";
import net from "node:net";
import type { Server as HttpServer } from "node:http";
import { serve, type ServerType } from "@hono/node-server";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, locations, printJobs, printers, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  MAX_DELIVERY_ATTEMPTS,
  PRINTER_DELETED,
  endDeletedPrinterJobs,
  enqueuePrintJob,
  esc,
} from "@waitron/printing";
import {
  FakeSink,
  NetworkTcpTransport,
  RoutingTransport,
  createAgent,
  type PrinterTarget,
} from "@waitron/print-agent";
import { fakeHost } from "@waitron/print-agent/testing/fake-host.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountPrintApi } from "./print-api.js";
import { mountJoinApi } from "./join-api.js";
import { mountNodeApi } from "./node-api.js";
import { createPairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import { freePorts } from "./testing/free-ports.js";
import "./errors.js";

// The whole print-agent path in one process with no real hardware: the real routes driven by the real
// agent loop. Every case but the real-HTTP one at the end routes the agent's fetch into
// `app.request`. It lives in apps/server because packages never
// import apps, so the agent package cannot reach the routes it must be proven against.
const noopLog: Logger = () => {};
/** A setting to draw opaque job payloads at; the agent never reads them. */
const WIDE = { paperWidth: "80mm", resolution: "180dpi" } as const;

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
      nodeId: brandNodeId(randomUUID()),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(locationId),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      tipsEnabled: false,
      simplifiedInvoiceLimit: null,
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
    mountJoinApi(
      app,
      { db: suite.db, cfg, pairingMode, deviceAddress: "https://waitron.local" },
      noopLog,
    );
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
    mountJoinApi(
      app,
      { db: suite.db, cfg, pairingMode, deviceAddress: "https://waitron.local" },
      noopLog,
    );
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

    const networkPayload = esc(WIDE).line("Mesa 4").cut().bytes();
    const usbPayload = esc(WIDE).line("Barra 2").cut().bytes();
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
      return enqueuePrintJob(tx, { locationId }, printerId, esc(WIDE).line("Ignored").bytes());
    });
    await agent.runOnce();
    expect(agent.status.phase).toBe("unauthorized");
    expect(await jobStatus(enqueuedAfterRevoke.jobId)).toBe("queued");
  });

  it("prints a Bluetooth calibration print through the box's own device layer, and ends it done", async () => {
    const MAC = "5A:4A:45:D4:FB:BC";
    const app = new Hono();
    const pairingMode = createPairingMode();
    pairingMode.open();
    mountPrintApi(
      app,
      { db: suite.db, cfg, pairingMode, readMembership: async () => null, venueLocale: "es-ES" },
      noopLog,
    );
    mountJoinApi(
      app,
      { db: suite.db, cfg, pairingMode, deviceAddress: "https://waitron.local" },
      noopLog,
    );
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
    // The radio is faked and no USB printer is attached; the Bluetooth device path is the production one.
    const sysfsRoot = await mkdtemp(join(tmpdir(), "print-agent-e2e-bt-"));
    try {
      const devices = createLinuxDevices({
        sysfsRoot,
        bluetooth: {
          scan: async () => [],
          pair: async () => ({ ok: false, error: "no fake" }),
          paired: async () => [{ mac: MAC, name: "BlueTooth Printer" }],
          forget: async () => ({ ok: false, error: "no fake" }),
        },
      });
      const radio = new FakeSink();
      const host = fakeHost({
        config: { serverUrl: BASE, name: "Bluetooth printing agent" },
        transport: new RoutingTransport({
          network_tcp: new FakeSink(),
          usb: new FakeSink(),
          bluetooth: radio,
        }),
        visibleDevices: () => devices.visibleDevices(),
        pairedBluetooth: () => devices.pairedBluetooth(),
        bluetoothPrinting: () => devices.bluetoothPrinting(),
        resolve: (job) => devices.resolve(job),
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
      const created = await send(app, "POST", "/management-api/printers", {
        cookie: managerCookie,
        body: { name: "Barra Bluetooth impresora", transport: "bluetooth", localKey: MAC },
      });
      expect(created.status).toBe(201);
      const printerId = ((await created.json()) as { id: string }).id;
      const test = await send(app, "POST", `/management-api/printers/${printerId}/test-print`, {
        cookie: managerCookie,
      });
      expect(test.status).toBe(202);
      const { jobId } = (await test.json()) as { jobId: string };

      await agent.runOnce();
      await agent.runOnce();

      expect(await jobStatus(jobId)).toBe("done");
      const { rows } = await suite.db.execute<{ payload: Uint8Array }>(
        sql`select payload from print_jobs where id = ${jobId}`,
      );
      expect(radio.written).toHaveLength(1);
      expect(radio.written[0]!.printerId).toBe(printerId);
      expect(Buffer.from(radio.written[0]!.bytes).equals(Buffer.from(rows[0]!.payload))).toBe(true);
    } finally {
      await rm(sysfsRoot, { recursive: true, force: true });
    }
  });

  it("ends a Bluetooth calibration print failed, with its reason, when the agent has the printer paired but cannot print to it", async () => {
    const MAC = "5A:4A:45:D4:FB:BB";
    const app = new Hono();
    const pairingMode = createPairingMode();
    pairingMode.open();
    mountPrintApi(
      app,
      { db: suite.db, cfg, pairingMode, readMembership: async () => null, venueLocale: "es-ES" },
      noopLog,
    );
    mountJoinApi(
      app,
      { db: suite.db, cfg, pairingMode, deviceAddress: "https://waitron.local" },
      noopLog,
    );
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
    // The box's own device layer, with the radio faked and no USB printer attached, behind a host
    // that reports it cannot print over Bluetooth.
    const sysfsRoot = await mkdtemp(join(tmpdir(), "print-agent-e2e-bt-"));
    try {
      const devices = createLinuxDevices({
        sysfsRoot,
        bluetooth: {
          scan: async () => [],
          pair: async () => ({ ok: false, error: "no fake" }),
          paired: async () => [{ mac: MAC, name: "BlueTooth Printer" }],
          forget: async () => ({ ok: false, error: "no fake" }),
        },
      });
      const radio = new FakeSink();
      const host = fakeHost({
        config: { serverUrl: BASE, name: "Bluetooth agent" },
        transport: new RoutingTransport({
          network_tcp: new FakeSink(),
          usb: new FakeSink(),
          bluetooth: radio,
        }),
        visibleDevices: () => devices.visibleDevices(),
        pairedBluetooth: () => devices.pairedBluetooth(),
        bluetoothPrinting: () => false,
        resolve: (job) => devices.resolve(job),
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
      const created = await send(app, "POST", "/management-api/printers", {
        cookie: managerCookie,
        body: { name: "Barra Bluetooth", transport: "bluetooth", localKey: MAC },
      });
      expect(created.status).toBe(201);
      const printerId = ((await created.json()) as { id: string }).id;
      const test = await send(app, "POST", `/management-api/printers/${printerId}/test-print`, {
        cookie: managerCookie,
      });
      expect(test.status).toBe(202);
      const { jobId } = (await test.json()) as { jobId: string };

      await agent.runOnce();
      await agent.runOnce();

      const jobs = (await (
        await send(app, "GET", "/management-api/print-jobs", { cookie: managerCookie })
      ).json()) as Array<{
        id: string;
        status: string;
        lastError: string | null;
        attempts: number;
      }>;
      expect(jobs.find(({ id }) => id === jobId)).toMatchObject({
        status: "failed",
        lastError: "printer.bluetooth_printing_unavailable",
        attempts: MAX_DELIVERY_ATTEMPTS,
      });
      const printers = (await (
        await send(app, "GET", "/management-api/printers", { cookie: managerCookie })
      ).json()) as Array<{ id: string; pendingJobs: number }>;
      expect(printers.find(({ id }) => id === printerId)?.pendingJobs).toBe(0);
      expect(radio.written).toEqual([]);
    } finally {
      await rm(sysfsRoot, { recursive: true, force: true });
    }
  });
});

/** The box's usblp sysfs shape, as `apps/print-agent/src/usb.test.ts` writes it. */
async function addUsbPrinter(root: string, lp: string, serial: string): Promise<void> {
  const bus = `1-${lp}`;
  const path = ["devices", "pci0000:00", "0000:00:14.0", "usb1", bus];
  const deviceDir = join(root, ...path);
  await mkdir(join(deviceDir, `${bus}:1.0`, "usbmisc", lp), { recursive: true });
  await writeFile(join(deviceDir, "serial"), `${serial}\n`);
  const classDir = join(root, "class", "usbmisc");
  await mkdir(classDir, { recursive: true });
  await symlink(join("..", "..", ...path, `${bus}:1.0`, "usbmisc", lp), join(classDir, lp));
}

describe("a printer deleted while its agent is sending", () => {
  it.each([
    ["usb", "done"],
    ["usb", "failed"],
    ["bluetooth", "done"],
    ["bluetooth", "failed"],
    ["network_tcp", "done"],
    ["network_tcp", "failed"],
  ] as const)(
    "keeps a %s job ended when its %s result arrives after the delete, and pulls it no more",
    async (transport, outcome) => {
      const n = randomUUID().replaceAll("-", "").toUpperCase();
      const serial = `USB-DEL-${n.slice(0, 8)}`;
      const keepSerial = `USB-KEEP-${n.slice(0, 8)}`;
      const mac = `5A:4A:${n.slice(0, 2)}:${n.slice(2, 4)}:${n.slice(4, 6)}:${n.slice(6, 8)}`;
      const app = new Hono();
      const pairingMode = createPairingMode();
      pairingMode.open();
      mountPrintApi(
        app,
        { db: suite.db, cfg, pairingMode, readMembership: async () => null, venueLocale: "es-ES" },
        noopLog,
      );
      mountJoinApi(
        app,
        { db: suite.db, cfg, pairingMode, deviceAddress: "https://waitron.local" },
        noopLog,
      );
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
      const sysfsRoot = await mkdtemp(join(tmpdir(), "print-agent-e2e-delete-"));
      try {
        await addUsbPrinter(sysfsRoot, "lp0", serial);
        await addUsbPrinter(sysfsRoot, "lp1", keepSerial);
        const devRoot = join(sysfsRoot, "devroot");
        const devices = createLinuxDevices({
          sysfsRoot,
          devRoot,
          bluetooth: {
            scan: async () => [],
            pair: async () => ({ ok: false, error: "no fake" }),
            paired: async () => [{ mac, name: "Bluetooth receipt" }],
            forget: async () => ({ ok: false, error: "no fake" }),
          },
        });

        let targetId = "";
        let signalSending!: () => void;
        const sending = new Promise<void>((resolve) => {
          signalSending = resolve;
        });
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        const sent: PrinterTarget[] = [];
        const results = new Map<string, number>();
        const host = fakeHost({
          config: { serverUrl: BASE, name: `Delete ${transport} ${outcome}` },
          transport: {
            async send(target) {
              sent.push(target);
              if (target.id !== targetId) return;
              signalSending();
              await released;
              if (outcome === "failed") throw new Error("paper out");
            },
          },
          visibleDevices: () => devices.visibleDevices(),
          pairedBluetooth: () => devices.pairedBluetooth(),
          bluetoothPrinting: () => devices.bluetoothPrinting(),
          resolve: (job) => devices.resolve(job),
          fetch: async (input, init) => {
            const response = await app.request(input, init);
            const path = typeof input === "string" ? input : input.toString();
            const match = /\/print-api\/agent\/jobs\/([^/]+)\/result$/.exec(path);
            if (match !== null) results.set(match[1]!, response.status);
            return response;
          },
        });
        host.now = Date.now;
        const agent = createAgent({ host });
        await agent.runOnce();
        const agentId = (await host.token())!.split(".")[0]!;
        const choice = host.statuses.find(
          (status) => status.verificationCode !== undefined,
        )!.verificationCode;
        expect(
          (
            await send(app, "POST", `/management-api/print-agent-join-requests/${agentId}/accept`, {
              cookie: managerCookie,
              body: { choice },
            })
          ).status,
        ).toBe(204);
        const create = async (body: Record<string, unknown>) => {
          const response = await send(app, "POST", "/management-api/printers", {
            cookie: managerCookie,
            body,
          });
          expect(response.status).toBe(201);
          return ((await response.json()) as { id: string }).id;
        };
        targetId = await create(
          transport === "usb"
            ? { name: `Deleted ${n}`, transport, localKey: serial }
            : transport === "bluetooth"
              ? { name: `Deleted ${n}`, transport, localKey: mac }
              : { name: `Deleted ${n}`, transport, host: "printer.e2e", port: 9101 },
        );
        const keepId = await create({ name: `Kept ${n}`, transport: "usb", localKey: keepSerial });
        await agent.runOnce();
        const enqueue = (printerId: string) =>
          withTransaction(suite.db, (tx) =>
            enqueuePrintJob(tx, { locationId }, printerId, esc(WIDE).line(n).cut().bytes()),
          );
        const { jobId } = await enqueue(targetId);
        const { jobId: keepJobId } = await enqueue(keepId);

        const tick = agent.runOnce();
        await sending;
        await withTransaction(suite.db, async (tx) => {
          await endDeletedPrinterJobs(tx, targetId);
          await tx
            .update(printers)
            .set({ active: false, deletedAt: new Date().toISOString() })
            .where(eq(printers.id, targetId));
        });
        release();
        await tick;

        expect(results.get(jobId)).toBe(204);
        expect(results.get(keepJobId)).toBe(204);
        const [ended] = await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId));
        expect(ended).toMatchObject({
          status: "failed",
          attempts: MAX_DELIVERY_ATTEMPTS,
          lastError: PRINTER_DELETED,
          claimedBy: agentId,
          deliveredAt: null,
        });
        expect(await jobStatus(keepJobId)).toBe("done");
        expect(sent.filter((target) => target.id === targetId)).toEqual([
          transport === "usb"
            ? {
                id: targetId,
                transport,
                host: null,
                port: null,
                devicePath: join(devRoot, "usb", "lp0"),
              }
            : transport === "bluetooth"
              ? { id: targetId, transport, host: null, port: null, devicePath: mac }
              : { id: targetId, transport, host: "printer.e2e", port: 9101, devicePath: null },
        ]);
        expect(sent.filter((target) => target.id === keepId)).toEqual([
          {
            id: keepId,
            transport: "usb",
            host: null,
            port: null,
            devicePath: join(devRoot, "usb", "lp1"),
          },
        ]);

        await agent.runOnce();
        expect(sent.filter((target) => target.id === targetId)).toHaveLength(1);
        expect((await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId)))[0]).toEqual(
          ended,
        );
      } finally {
        await rm(sysfsRoot, { recursive: true, force: true });
      }
    },
  );
});

/** A network printer on a fixed loopback port that keeps every connection's bytes; a discovery
 * probe connects and sends nothing. */
async function startRecordingPrinter(port: number) {
  const printed: Buffer[] = [];
  const waiting: Array<{ count: number; resolve: () => void }> = [];
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    const chunks: Buffer[] = [];
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => {
      const bytes = Buffer.concat(chunks);
      if (bytes.length > 0) printed.push(bytes);
      for (const wait of waiting.filter((entry) => printed.length >= entry.count)) wait.resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return {
    printed,
    /** Resolves once `count` payloads have arrived in all. */
    received: (count: number) =>
      printed.length >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiting.push({ count, resolve })),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      }),
  };
}

/** Fails naming `step` if `wait` has not settled within `ms`, well inside the test's own timeout,
 * so a stalled step still reaches the test's `finally`. */
async function within<T>(step: string, wait: Promise<T>, ms = 10_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${step}`)), ms);
  });
  try {
    return await Promise.race([wait, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

function listen(app: Hono, port: number): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => resolve(server));
    server.once("error", reject);
  });
}

describe("a printer deleted over real HTTP", () => {
  it("serves create, impact, delete, the late result, history, discovery and a replacement to a real agent and client", async () => {
    const [httpPort, printerPort] = await freePorts(2);
    const base = `http://127.0.0.1:${httpPort}`;
    const app = new Hono();
    const pairingMode = createPairingMode();
    pairingMode.open();
    mountPrintApi(
      app,
      { db: suite.db, cfg, pairingMode, readMembership: async () => null, venueLocale: "es-ES" },
      noopLog,
    );
    mountJoinApi(
      app,
      { db: suite.db, cfg, pairingMode, deviceAddress: "https://waitron.local" },
      noopLog,
    );
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
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          cookie: managerCookie,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    };
    let signalSending!: () => void;
    const sending = new Promise<void>((resolve) => {
      signalSending = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const servers: ServerType[] = [];
    let sink: Awaited<ReturnType<typeof startRecordingPrinter>> | undefined;
    let agent: ReturnType<typeof createAgent> | undefined;
    try {
      sink = await startRecordingPrinter(printerPort!);
      servers.push(await listen(app, httpPort!));

      const tcp = new NetworkTcpTransport();
      let holdPrinter: string | null = null;
      const results = new Map<string, number>();
      const host = fakeHost({
        config: { serverUrl: base, name: "Real HTTP agent" },
        probeNetwork,
        transport: {
          async send(target, bytes) {
            if (target.id === holdPrinter) {
              signalSending();
              await released;
            }
            await tcp.send(target, bytes);
          },
        },
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const path = input instanceof Request ? input.url : input.toString();
          const match = /\/print-api\/agent\/jobs\/([^/]+)\/result$/.exec(path);
          if (match !== null) results.set(match[1]!, response.status);
          return response;
        },
      });
      host.now = Date.now;
      agent = createAgent({ host });
      await agent.runOnce();
      const joinId = (await host.token())!.split(".")[0]!;
      const choice = host.statuses.find(
        (status) => status.verificationCode !== undefined,
      )!.verificationCode;
      expect(
        (
          await call("POST", `/management-api/print-agent-join-requests/${joinId}/accept`, {
            choice,
          })
        ).status,
      ).toBe(204);

      const created = await call("POST", "/management-api/printers", {
        name: "Old kitchen",
        transport: "network_tcp",
        host: "127.0.0.1",
        port: printerPort,
      });
      expect(created.status).toBe(201);
      const oldId = (created.body as { id: string }).id;
      const enqueue = async (printerId: string, text: string) => {
        const payload = esc(WIDE).line(text).cut().bytes();
        const { jobId } = await withTransaction(suite.db, (tx) =>
          enqueuePrintJob(tx, { locationId }, printerId, payload),
        );
        return { jobId, payload: Buffer.from(payload) };
      };

      // An undeleted printer prints: the control for everything after the delete.
      const before = await enqueue(oldId, "Before the delete");
      await agent.runOnce();
      await within("the first print", sink.received(1));
      expect(sink.printed).toEqual([before.payload]);
      expect(await jobStatus(before.jobId)).toBe("done");

      const waiting = await enqueue(oldId, "Waiting at the impact read");
      const impact = await call("GET", `/management-api/printers/${oldId}/delete-impact`);
      expect(impact.status).toBe(200);
      expect(impact.body).toMatchObject({
        target: { id: oldId, name: "Old kitchen" },
        refusals: [],
        ends: [{ key: "print_jobs", count: 1, targets: [] }],
      });

      // New work queued after the impact read, then claimed and held mid-send while the delete runs.
      const later = await enqueue(oldId, "Queued after the impact read");
      holdPrinter = oldId;
      const tick = agent.runOnce();
      await within("the held send to start", sending);
      const deleted = await call("DELETE", `/management-api/printers/${oldId}`);
      expect(deleted.status).toBe(200);
      expect(deleted.body).toMatchObject({
        target: { id: oldId, name: "Old kitchen" },
        ends: [{ key: "print_jobs", count: 2, targets: [] }],
      });
      release();
      await within("the held tick to finish", tick);
      holdPrinter = null;

      for (const { jobId } of [waiting, later]) {
        expect(results.get(jobId)).toBe(204);
        expect(
          (await suite.db.select().from(printJobs).where(eq(printJobs.id, jobId)))[0],
        ).toMatchObject({
          status: "failed",
          attempts: MAX_DELIVERY_ATTEMPTS,
          lastError: PRINTER_DELETED,
          deliveredAt: null,
        });
      }
      const ended = await suite.db.select().from(printJobs).where(eq(printJobs.printerId, oldId));
      const sentAfterDelete = sink.printed.length;
      await agent.runOnce();
      expect(sink.printed).toHaveLength(sentAfterDelete);
      expect(await suite.db.select().from(printJobs).where(eq(printJobs.printerId, oldId))).toEqual(
        ended,
      );

      const jobs = (await call("GET", "/management-api/print-jobs")).body as Array<{
        id: string;
        printerName: string;
        canResend: boolean;
      }>;
      expect(
        [before, waiting, later].map(({ jobId }) => jobs.find((row) => row.id === jobId)),
      ).toEqual(
        [before, waiting, later].map(({ jobId }) =>
          expect.objectContaining({ id: jobId, printerName: "Old kitchen", canResend: false }),
        ),
      );
      const listed = (await call("GET", "/management-api/printers")).body as Array<{ id: string }>;
      expect(listed.map((row) => row.id)).not.toContain(oldId);

      const discovered = async () => {
        expect(
          (
            await call("POST", "/management-api/printer-discovery/probe", {
              host: "127.0.0.1",
              port: printerPort,
            })
          ).status,
        ).toBe(200);
        await agent!.runOnce();
        await agent!.runOnce();
        const rows = (await call("GET", "/management-api/discovered-printers")).body as Array<{
          host: string | null;
          port: number | null;
          alreadyRegistered: boolean;
          printerId: string | null;
        }>;
        return rows.find((row) => row.host === "127.0.0.1" && row.port === printerPort);
      };
      expect(await discovered()).toMatchObject({ alreadyRegistered: false, printerId: null });

      const replaced = await call("POST", "/management-api/printers", {
        name: "New kitchen",
        transport: "network_tcp",
        host: "127.0.0.1",
        port: printerPort,
      });
      expect(replaced.status).toBe(201);
      const newId = (replaced.body as { id: string }).id;
      expect(newId).not.toBe(oldId);
      expect(await discovered()).toMatchObject({ alreadyRegistered: true, printerId: newId });
      const onReplacement = await enqueue(newId, "On the replacement");
      await agent.runOnce();
      await within("the replacement's print", sink.received(sentAfterDelete + 1));
      expect(sink.printed.at(-1)).toEqual(onReplacement.payload);
      expect(await jobStatus(onReplacement.jobId)).toBe("done");

      // Disable is not Delete: a switched-off printer keeps its match and comes back as itself.
      expect((await call("POST", `/management-api/printers/${newId}/deactivate`)).status).toBe(204);
      expect(await discovered()).toMatchObject({ alreadyRegistered: true, printerId: newId });
      expect(
        (await call("PATCH", `/management-api/printers/${newId}`, { active: true })).status,
      ).toBe(204);
      const reEnabled = await enqueue(newId, "After Enable");
      await agent.runOnce();
      await within("the print after Enable", sink.received(sentAfterDelete + 2));
      expect(sink.printed.at(-1)).toEqual(reEnabled.payload);
      expect(await jobStatus(reEnabled.jobId)).toBe("done");

      const [tombstone] = await suite.db.select().from(printers).where(eq(printers.id, oldId));
      expect(tombstone).toMatchObject({ name: "Old kitchen", active: false });
      expect(tombstone!.deletedAt).not.toBeNull();
    } finally {
      release();
      agent?.stop();
      for (const server of servers) {
        (server as HttpServer).closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
      await sink?.close();
    }
  });
});

import net from "node:net";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { enqueuePrintJob, esc } from "@waitron/printing";
import { FakeSink, NetworkTcpTransport, RoutingTransport, createAgent } from "@waitron/print-agent";
import { fakeHost } from "@waitron/print-agent/testing/fake-host.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { Logger } from "./logger.js";
import { mountPrintApi } from "./print-api.js";
import { mountJoinApi } from "./join-api.js";
import { mountNodeApi } from "./node-api.js";
import { createPairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

// The whole print-agent path, in one process and with no real hardware: the REAL server routes
// (mountPrintApi + mountJoinApi, on PGlite) driven by the REAL agent loop (createAgent) whose fetch is
// routed into `app.request`, over a REAL RoutingTransport that dispatches by transport — a real
// NetworkTcpTransport to a loopback TCP listener for the network_tcp printer, and a FakeSink standing
// in for the local device node of the usb printer. The fake `Host` reports the usb serial in its
// `visibleDevices` inventory (the eligibility key the server matches, §5) and `resolve`s a claimed
// job's `localKey` to a device target. This lives in apps/server because packages never import apps —
// the agent package cannot reach the routes it must be proven against, so the wiring that joins them
// is proven here. PGlite (not real Postgres) is enough: this asserts the request/response flow and the
// byte path (register → pull-with-inventory → deliver → done → revoke-halts); grants and the derived
// authorization boundary are proven as `app_user` on real Postgres in `print-api.pg.test.ts` and
// `packages/printing`'s `runtime.eligibility.test.ts`.
const noopLog: Logger = () => {};

// A fixed http origin the agent is configured against and the fake fetch strips before handing the
// path to `app.request` (Hono routes on the pathname, so the origin is arbitrary).
const BASE = "http://waitron.e2e";

// The usb printer's stable local handle (a device serial). The agent reports it in every pull's
// `visible` inventory, and it is the `local_key` the usb printer is registered under — the two must
// match for the server to judge the usb job eligible for this box (§5).
const USB_SERIAL = "USB-SN-E2E";

let tenantId: string;
let locationId: string;
let cfg: TillConfig;
let managerCookie: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  timeoutMs: 60_000,
  setup: async (db) => {
    tenantId = await seedTenant(db);
    const loc = await db.execute<{ id: string }>(sql`
      insert into locations (tenant_id, name, invoice_locales, operation_description)
      values (${tenantId}, 'Barra', array['es-ES'], 'Venta en establecimiento') returning id`);
    locationId = loc.rows[0]!.id;
    // The full TillConfig the print/join verbs are typed on. The routes read only tenantId/locationId
    // and echo nodeId on the pull; the fiscal ids are unused here, so a branded random uuid stands in —
    // and nodeId needs no `nodes` row, exactly as `print-api.test.ts` seeds none.
    cfg = {
      tenantId: brandTenantId(tenantId),
      tillId: brandTillId(randomUUID()),
      nodeId: brandNodeId(randomUUID()),
      seriesId: brandSeriesId(randomUUID()),
      locationId: brandLocationId(locationId),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      cardProvider: "none",
      tipsEnabled: false,
      orderFlow: "ticket_then_pay",
    };
    const managerSid = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      const mgr = await tx.execute<{ id: string }>(sql`
        insert into persons (tenant_id, display_name, pin_hash, role)
        values (${tenantId}, 'The Manager', ${hashPin("1234")}, 'manager') returning id`);
      // A `manager` role carries `printer.manage`, the permission the shared list, the challenge and
      // the print-agent accept are gated on.
      const session = await startManagementSession(tx, { tenantId, personId: mgr.rows[0]!.id });
      return session.id;
    });
    managerCookie = `${MANAGEMENT_COOKIE}=${managerSid}`;
  },
});

/** A loopback TCP server that captures every byte one connection delivers, resolving `firstConnection`
 * with the accumulated payload when the agent half-closes its write side. */
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
    socket.on("data", (chunk) => chunks.push(chunk));
    // The agent's NetworkTcpTransport half-closes after flushing, so `end` marks the full payload in.
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

/** JSON request helper — `cookie` sends the manager session; the agent's own calls go through the
 * fake host's routed fetch, not this. */
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
  it("joins, is accepted, pulls with inventory, delivers a network + a usb job, marks both done — then revoke halts it", async () => {
    const loopback = printer!;

    // 1. One app carrying both surfaces, sharing ONE pairing window (the venue's one window). Open it,
    //    or the agent's knock is refused. `readMembership` returns null → the pull echoes no extra
    //    servers, so the agent's router follows only its configured address (hermetic, no phantom probe
    //    chasing a real host). The `/api/node` probe is mounted too and answers an accepting primary in
    //    the agent's environment, so the router marks the configured address `primary` and the loop is
    //    allowed to talk to it (CLAUDE.md §5 — the loop refuses a non-accepting or wrong-env server).
    const app = new Hono();
    const pairingMode = createPairingMode();
    pairingMode.open();
    mountPrintApi(
      app,
      { db: suite.db, cfg, pairingMode, readMembership: async () => null },
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

    // 3. The agent: config against BASE, a real routing transport (a real TCP adapter for network_tcp,
    //    a byte-capturing FakeSink standing in for the usb device node), a `visibleDevices` inventory
    //    reporting the usb serial the box "sees" (the eligibility key the server matches for a usb job),
    //    and a fetch that routes every wire call into the server under test. `resolve` is the fake host's
    //    default passthrough: it maps a claimed job's `localKey` to the target's `devicePath`, which the
    //    FakeSink ignores while recording the exact bytes — so the usb byte path is asserted without a
    //    real device node. The network_tcp job carries no `localKey` and reaches the real TCP adapter.
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

    // 4. First tick JOINS (window open) → phase `pending`, with the verification number the admin reads.
    await agent.runOnce();
    expect(agent.status.phase).toBe("pending");
    const verificationNumber = [...host.statuses]
      .reverse()
      .find((s) => s.verificationCode !== undefined)?.verificationCode;
    expect(verificationNumber).toMatch(/^\d{2}$/);
    // The bearer is `${joinId}.${secret}`, and joinId is the id the accept/revoke routes address.
    const token = await host.token();
    expect(token).not.toBeNull();
    const joinId = token!.slice(0, token!.indexOf("."));

    // 5. Admin: the shared pending list must NOT carry the number beside the question — `toEqual` pins
    //    the exact shape, so any number field would fail it.
    const listRes = await send(app, "GET", "/management-api/join-requests?kind=print_agent", {
      cookie: managerCookie,
    });
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual([
      { id: joinId, kind: "print_agent", label: "e2e", createdAt: expect.any(String) },
    ]);

    // The challenge offers three numbers, one of them the agent's — the admin picks it.
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

    // The matching number accepts the print-agent join (204).
    const acceptRes = await send(
      app,
      "POST",
      `/management-api/print-agent-join-requests/${joinId}/accept`,
      { cookie: managerCookie, body: { choice: verificationNumber } },
    );
    expect(acceptRes.status).toBe(204);

    // 2. Register the two printers at this venue — a network_tcp one at the loopback's host:port and a
    //    usb one keyed on the serial the agent reports. Neither carries an agent binding: which box
    //    serves a printer is DERIVED at pull time from the venue (network_tcp) and the reported visible
    //    keys (usb), never stored (design §3).
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

    // 6. Next tick sees `approved` and pulls — but there is no job yet: phase `running`, no bytes.
    await agent.runOnce();
    expect(agent.status.phase).toBe("running");

    // 7. Enqueue one job per printer; the next tick claims BOTH (the pull carries the visible usb serial,
    //    so the usb job is eligible for this box; the network_tcp job is eligible by venue), pushes each
    //    through its adapter — the network bytes to the loopback socket, the usb bytes to the FakeSink —
    //    and reports both `done`.
    const networkPayload = esc().text("Mesa 4").cut().bytes();
    const usbPayload = esc().text("Barra 2").cut().bytes();
    const { jobId } = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return enqueuePrintJob(tx, { tenantId, locationId }, printerId, networkPayload);
    });
    const { jobId: usbJobId } = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return enqueuePrintJob(tx, { tenantId, locationId }, usbPrinterId, usbPayload);
    });

    await agent.runOnce();
    expect(agent.status.phase).toBe("running");
    // The network_tcp bytes reach the real loopback listener verbatim.
    const received = await loopback.firstConnection;
    expect(received.equals(Buffer.from(networkPayload))).toBe(true);
    // The usb bytes reach the fake device sink verbatim, addressed to the usb printer's id (the
    // RoutingTransport dispatched by transport, `resolve` mapped the serial to the target).
    expect(usbSink.written).toHaveLength(1);
    expect(usbSink.written[0]!.printerId).toBe(usbPrinterId);
    expect(Buffer.from(usbSink.written[0]!.bytes).equals(Buffer.from(usbPayload))).toBe(true);
    // Both jobs are marked done.
    expect(await jobStatus(jobId)).toBe("done");
    expect(await jobStatus(usbJobId)).toBe("done");

    // 8. Revoke the agent; the next tick's pull is 401 → phase `unauthorized`, token cleared.
    const revokeRes = await send(app, "POST", `/management-api/print-agents/${joinId}/revoke`, {
      cookie: managerCookie,
    });
    expect(revokeRes.status).toBe(204);

    await agent.runOnce();
    expect(agent.status.phase).toBe("unauthorized");
    expect(await host.token()).toBeNull();

    // A further tick is halted: it claims nothing (no new job appears, the printed one stays done).
    const enqueuedAfterRevoke = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return enqueuePrintJob(
        tx,
        { tenantId, locationId },
        printerId,
        esc().text("Ignored").bytes(),
      );
    });
    await agent.runOnce();
    expect(agent.status.phase).toBe("unauthorized");
    // The halted agent never claimed the post-revoke job — it is still queued, never printed.
    expect(await jobStatus(enqueuedAfterRevoke.jobId)).toBe("queued");
  });
});

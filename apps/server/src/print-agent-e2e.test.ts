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
import {
  BluetoothTransport,
  NetworkTcpTransport,
  RoutingTransport,
  UsbTransport,
  createAgent,
} from "@waitron/print-agent";
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
// routed into `app.request`, through a REAL NetworkTcpTransport to a loopback TCP listener standing in
// for the printer. This lives in apps/server because packages never import apps — the agent package
// cannot reach the routes it must be proven against, so the wiring that joins them is proven here.
// PGlite (not real Postgres) is enough: this asserts the request/response flow and the byte path, not
// grants or concurrency, which `print-api.pg.test.ts` covers as `app_user`.
const noopLog: Logger = () => {};

// A fixed http origin the agent is configured against and the fake fetch strips before handing the
// path to `app.request` (Hono routes on the pathname, so the origin is arbitrary).
const BASE = "http://waitron.e2e";

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
  it("joins, is accepted, pulls a job, prints bytes, marks it done — then revoke halts it", async () => {
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

    // 3. The agent: config against BASE, a real routing transport over a real TCP adapter, and a fetch
    //    that routes every wire call into the server under test.
    const transport = new RoutingTransport({
      network_tcp: new NetworkTcpTransport(),
      usb: new UsbTransport(),
      bluetooth: new BluetoothTransport(),
    });
    const host = fakeHost({
      config: { serverUrl: BASE, name: "e2e" },
      transport,
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

    // 2. Register the network_tcp printer at the loopback's host:port, bound to this agent.
    const printerRes = await send(app, "POST", "/management-api/printers", {
      cookie: managerCookie,
      body: {
        name: "Cocina",
        transport: "network_tcp",
        agentId: joinId,
        host: loopback.host,
        port: loopback.port,
      },
    });
    expect(printerRes.status).toBe(201);
    const printerId = ((await printerRes.json()) as { id: string }).id;

    // 6. Next tick sees `approved` and pulls — but there is no job yet: phase `running`, no bytes.
    await agent.runOnce();
    expect(agent.status.phase).toBe("running");

    // 7. Enqueue one job; the next tick claims it, sends the bytes to the loopback, reports `done`.
    const payload = esc().text("Mesa 4").cut().bytes();
    const { jobId } = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return enqueuePrintJob(tx, { tenantId, locationId }, printerId, payload);
    });

    await agent.runOnce();
    expect(agent.status.phase).toBe("running");
    const received = await loopback.firstConnection;
    expect(received.equals(Buffer.from(payload))).toBe(true);
    expect(await jobStatus(jobId)).toBe("done");

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

import { printOverIpp } from "@waitron/print-agent-app/ipp-print.js";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  deviceProfiles,
  invoiceDeliveries,
  invoiceSeries,
  locations,
  pagePrinters,
  tenants,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { hashPin, persons, startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { recordSale } from "@waitron/core";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import type { TrustedClock } from "@waitron/fiscal";
import { createAgent, createClient, type PageJob } from "@waitron/print-agent";
import { fakeHost } from "@waitron/print-agent/testing/fake-host.js";
import {
  jobOrigin,
  locationId as brandLocation,
  nodeId as brandNode,
  seriesId as brandSeries,
  workingOrderId as brandWorkingOrder,
} from "@waitron/shared";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { ALL_MODULES } from "./modules.js";
import { venueModuleConfig } from "./provision.js";
import { INVOICE_DELIVERY_LEASE_MS, reserveInvoiceDelivery } from "./invoice-delivery.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { mountPrintApi } from "./print-api.js";
import { mountJoinApi } from "./join-api.js";
import { mountNodeApi } from "./node-api.js";
import { createPairingMode } from "./pairing-mode.js";
import type { TillConfig } from "./till-config.js";
import { createZone } from "./testing/service-zone.js";
import { mountTillApi } from "./till-api.js";
import { createOpenOrder } from "./working-order.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { listInvoicePrinter } from "./testing/invoice-printer.js";
import { DEVICE_COOKIE } from "./device-session.js";
import "./errors.js";

// The A4 invoice path in one process: the real routes, the real agent loop, the real IPP client and
// a fake IPP printer on loopback. Packages never import apps, so this proof lives here.

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const BASE = "http://waitron.e2e";
const clock: TrustedClock = {
  now: () => ({
    instant: new Date(),
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("Unused anchor");
  },
  currentAnchor: () => null,
};

// The fake IPP printer reads and writes IPP with code independent of the agent's own.

const PRINT_JOB = 0x0002;
const GET_JOB_ATTRIBUTES = 0x0009;
const GET_PRINTER_ATTRIBUTES = 0x000b;
const PROCESSING = 5;
const PROCESSING_STOPPED = 6;
const COMPLETED = 9;
const PRINTER_IDLE = 3;
const PRINTER_STOPPED = 5;

type IppRequest = {
  operation: number;
  documentFormat: string | undefined;
  printerUri: string | undefined;
  media: string | undefined;
  url?: string;
  data: Buffer;
};

function decodeIpp(body: Buffer): IppRequest {
  let offset = 8;
  let name = "";
  let documentFormat: string | undefined;
  let printerUri: string | undefined;
  let media: string | undefined;
  for (;;) {
    const tag = body[offset++]!;
    if (tag === 0x03) break;
    if (tag < 0x10) continue;
    const n = body.readUInt16BE(offset);
    offset += 2;
    if (n > 0) name = body.toString("utf8", offset, offset + n);
    offset += n;
    const length = body.readUInt16BE(offset);
    offset += 2;
    if (name === "document-format") documentFormat = body.toString("utf8", offset, offset + length);
    if (name === "printer-uri") printerUri = body.toString("utf8", offset, offset + length);
    if (name === "media") media = body.toString("utf8", offset, offset + length);
    offset += length;
  }
  return {
    operation: body.readUInt16BE(2),
    documentFormat,
    printerUri,
    media,
    data: body.subarray(offset),
  };
}

function ippAttribute(tag: number, name: string, value: string | Buffer): Buffer {
  const n = Buffer.from(name);
  const v = Buffer.from(value);
  const head = Buffer.alloc(3);
  head[0] = tag;
  head.writeUInt16BE(n.length, 1);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(v.length);
  return Buffer.concat([head, n, length, v]);
}

function int32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}

/** A keyword attribute: the first value carries the name, each further one an empty name. */
function keywords(name: string, values: string[]): Buffer[] {
  return values.map((value, i) => ippAttribute(0x44, i === 0 ? name : "", value));
}

function ippReply(
  requestId: number,
  status: number,
  jobState?: number,
  jobReasons: string[] = [],
): Buffer {
  return ippAnswer(
    requestId,
    status,
    jobState === undefined
      ? []
      : [
          Buffer.from([0x02]),
          ippAttribute(0x21, "job-id", int32(7)),
          ippAttribute(0x23, "job-state", int32(jobState)),
          ...keywords("job-state-reasons", jobReasons),
        ],
  );
}

function printerReply(requestId: number, state: number, reasons: string[]): Buffer {
  return ippAnswer(requestId, 0x0000, [
    Buffer.from([0x04]),
    ippAttribute(0x23, "printer-state", int32(state)),
    ...keywords("printer-state-reasons", reasons),
  ]);
}

function ippAnswer(requestId: number, status: number, groups: Buffer[]): Buffer {
  const header = Buffer.alloc(8);
  header[0] = 2;
  header.writeUInt16BE(status, 2);
  header.writeUInt32BE(requestId, 4);
  return Buffer.concat([
    header,
    Buffer.from([0x01]),
    ippAttribute(0x47, "attributes-charset", "utf-8"),
    ippAttribute(0x48, "attributes-natural-language", "en"),
    ...groups,
    Buffer.from([0x03]),
  ]);
}

interface FakeIppPrinter {
  port: number;
  tray: { empty: boolean };
  requests: IppRequest[];
  printJobs: () => IppRequest[];
  close(): Promise<void>;
}

/**
 * Accepts a Print-Job as processing; the first Get-Job-Attributes finds it completed. While
 * `tray.empty` is set it answers as the owner's HP did with an empty tray: the job
 * `processing-stopped` for `printer-stopped`, the printer `stopped` for
 * `media-empty-error, media-needed`.
 */
async function startFakeIppPrinter(tray = { empty: false }): Promise<FakeIppPrinter> {
  const requests: IppRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const request = decodeIpp(body);
      request.url = req.url;
      requests.push(request);
      const requestId = body.readUInt32BE(4);
      const reply =
        request.operation === PRINT_JOB
          ? ippReply(requestId, 0x0000, PROCESSING)
          : request.operation === GET_JOB_ATTRIBUTES
            ? tray.empty
              ? ippReply(requestId, 0x0000, PROCESSING_STOPPED, ["printer-stopped"])
              : ippReply(requestId, 0x0000, COMPLETED)
            : request.operation === GET_PRINTER_ATTRIBUTES
              ? tray.empty
                ? printerReply(requestId, PRINTER_STOPPED, ["media-empty-error", "media-needed"])
                : printerReply(requestId, PRINTER_IDLE, ["none"])
              : ippReply(requestId, 0x0501);
      res.writeHead(200, { "content-type": "application/ipp" });
      res.end(reply);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    tray,
    requests,
    printJobs: () => requests.filter((r) => r.operation === PRINT_JOB),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

let ipp: FakeIppPrinter | undefined;
let more: FakeIppPrinter[] = [];

afterEach(async () => {
  await ipp?.close();
  ipp = undefined;
  await Promise.all(more.map((printer) => printer?.close()));
  more = [];
});

type Venue = Awaited<ReturnType<typeof venue>>;

async function venue() {
  ipp = await startFakeIppPrinter();
  await seedTenant(suite.db);
  await suite.db.update(tenants).set({ taxpayerDomicile: "Saved domicile" });
  const [location] = await suite.db
    .insert(locations)
    .values({ name: "Bar", invoiceLocales: ["es-ES"], operationDescription: "Sale on premises" })
    .returning({ id: locations.id });
  const locationId = location!.id;
  const nodeId = await seedNode(suite.db, brandLocation(locationId));
  const [series] = await suite.db
    .insert(invoiceSeries)
    .values({ nodeId, code: "F", purpose: "full" })
    .returning();
  const backend = fiscalSlot(
    enabledModules(ALL_MODULES, venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat")),
    null,
  ).makeBackend({ db: suite.db, clock, environment: "preproduction" });
  const cfg: TillConfig = {
    nodeId: brandNode(nodeId),
    locationId: brandLocation(locationId),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const { managerCookie, staffId, zoneId } = await withTransaction(suite.db, async (tx) => {
    const [manager] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const [staff] = await tx
      .insert(persons)
      .values({ displayName: "Staff one", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    const session = await startManagementSession(tx, { personId: manager!.id });
    const zone = await createZone(tx, cfg, { name: "Bar" });
    return {
      managerCookie: `${MANAGEMENT_COOKIE}=${session.token}`,
      staffId: staff!.id,
      zoneId: zone.id,
    };
  });
  // The server's clock runs ahead of the wall clock by `ahead`, so a lease can lapse without waiting.
  const serverClock = { ahead: 0 };
  const app = new Hono();
  const pairingMode = createPairingMode();
  pairingMode.open();
  mountPrintApi(
    app,
    {
      db: suite.db,
      cfg,
      pairingMode,
      readMembership: async () => null,
      venueLocale: "es-ES",
      now: () => new Date(Date.now() + serverClock.ahead),
      readInvoiceDocument: (tx, saleId) => readInvoiceDocument(backend, tx, cfg, saleId),
    },
    () => {},
  );
  mountJoinApi(
    app,
    { db: suite.db, cfg, pairingMode, deviceAddress: "https://waitron.local" },
    () => {},
  );
  mountTillApi(
    app,
    { db: suite.db, backend, clock, cfg, secureCookies: false, venueLocale: "es-ES" },
    () => {},
  );
  mountNodeApi(
    app,
    {
      nodeId: cfg.nodeId,
      acceptingSales: true,
      environment: "preproduction",
      readMembership: async () => null,
    },
    () => {},
  );
  return {
    app,
    cfg,
    backend,
    locationId,
    nodeId,
    seriesId: series!.id,
    zoneId,
    managerCookie,
    ...(await tillSession(cfg, app, staffId)),
    serverClock,
  };
}

/** A staff member signed in on a till whose profile may print receipts. */
async function tillSession(
  cfg: TillConfig,
  app: Hono,
  personId: string,
): Promise<{ tillCookie: string; tillProfileId: string }> {
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "Till", formFactor: "till", capabilities: [...CAPABILITY_FLAGS] })
    .returning({ id: deviceProfiles.id });
  const device = await enrolDeviceForTest(suite.db, cfg, { name: "Till", profileId: profile!.id });
  const login = await app.request("/api/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    },
    body: JSON.stringify({ personId, pin: "5555" }),
  });
  expect(login.status).toBe(200);
  return {
    tillCookie: login.headers.get("set-cookie")!.split(";")[0]!,
    tillProfileId: profile!.id,
  };
}

function request(v: Venue, method: "POST" | "PATCH", path: string, body: unknown) {
  return v.app.request(path, {
    method,
    headers: { "content-type": "application/json", cookie: v.managerCookie },
    body: JSON.stringify(body),
  });
}

type PrintPage = NonNullable<ReturnType<typeof fakeHost>["printPage"]>;

/** Prints over IPP exactly as the agent's own host does (`apps/print-agent/src/host.ts`). */
const printOverIppAsHost: PrintPage = (target, bytes, format, media, signal, onHold) =>
  printOverIpp({ ...target, documentFormat: format, media }, bytes, { signal, onHold });

/** As the host prints, polling every 20 ms so a held job's answers arrive without waiting 10 s. */
const printWithQuickPolls: PrintPage = (target, bytes, format, media, signal, onHold) =>
  printOverIpp({ ...target, documentFormat: format, media }, bytes, {
    signal,
    onHold,
    pollIntervalMs: 20,
    heldPollIntervalMs: 20,
  });

interface RunningAgent {
  agent: ReturnType<typeof createAgent>;
  host: ReturnType<typeof fakeHost>;
  claims: PageJob[];
  /** The page runner's claims and reports, in the order the server answered them. */
  pageEvents: ("claimed" | "none" | "reported")[];
  /** Once set, the agent's process is gone: nothing it holds sends or sleeps again. */
  stopped: { now: boolean };
}

function runAgent(
  v: Venue,
  opts: {
    printPage?: (agent: RunningAgent) => PrintPage;
    saved?: { config: Awaited<ReturnType<RunningAgent["host"]["config"]>>; token: string };
  } = {},
): RunningAgent {
  const stopped = { now: false };
  const never = new Promise<never>(() => {});
  const claims: PageJob[] = [];
  const pageEvents: RunningAgent["pageEvents"] = [];
  const running = { claims, pageEvents, stopped } as RunningAgent;
  const host = fakeHost({
    config: opts.saved?.config ?? { serverUrl: BASE, name: "Back office agent" },
    token: opts.saved?.token ?? null,
    fetch: async (input, init) => {
      if (stopped.now) return never;
      const response = await v.app.request(input, init);
      if (String(input).endsWith("/print-api/agent/page-jobs/claim")) {
        if (response.status === 200) pageEvents.push("claimed");
        if (response.status === 204) pageEvents.push("none");
        if (response.status === 200) claims.push((await response.clone().json()) as PageJob);
      }
      if (String(input).endsWith("/result")) pageEvents.push("reported");
      return response;
    },
    // Real waits, capped at 20 ms so no test waits out a 20 s renewal interval.
    sleep: (ms) =>
      stopped.now ? never : new Promise((resolve) => setTimeout(resolve, Math.min(ms, 20))),
    printPage: (...args) => (opts.printPage?.(running) ?? printOverIppAsHost)(...args),
  });
  host.now = Date.now;
  running.host = host;
  running.agent = createAgent({ host });
  return running;
}

/** Joins a new agent and accepts it through the manager's route. */
async function joinedAgent(v: Venue, printPage?: (agent: RunningAgent) => PrintPage) {
  const running = runAgent(v, printPage === undefined ? {} : { printPage });
  await running.agent.runOnce();
  const agentId = (await running.host.token())!.split(".")[0]!;
  const choice = running.host.statuses.find(
    (status) => status.verificationCode !== undefined,
  )!.verificationCode;
  const accepted = await request(
    v,
    "POST",
    `/management-api/print-agent-join-requests/${agentId}/accept`,
    { choice },
  );
  expect(accepted.status).toBe(204);
  return { running, agentId };
}

async function until(what: string, done: () => boolean | Promise<boolean>, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** One poll, then waits until every job the agent claimed is reported and, after the last report,
 * the page runner has asked for work and been told none is due. The agent starts each claimed job
 * without waiting for it, so a "none" can arrive while a job is still printing. */
async function pollUntilIdle(running: RunningAgent): Promise<void> {
  const start = running.pageEvents.length;
  await running.agent.runOnce();
  expect(running.agent.status.phase).toBe("running");
  await until("the page runner to go idle", () => {
    const events = running.pageEvents;
    const claimed = events.filter((event) => event === "claimed").length;
    const reported = events.filter((event) => event === "reported").length;
    const lastNone = events.lastIndexOf("none");
    return reported === claimed && lastNone >= start && lastNone > events.lastIndexOf("reported");
  });
}

async function officePrinter(
  v: Venue,
  agentId: string,
  printer: FakeIppPrinter = ipp!,
  name = "Back office",
): Promise<string> {
  const [row] = await suite.db
    .insert(pagePrinters)
    .values({
      locationId: v.locationId,
      name,
      host: "127.0.0.1",
      port: printer.port,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 300,
      agentId,
      invoiceDefault: printer === ipp,
    })
    .returning({ id: pagePrinters.id });
  if (printer === ipp)
    await withTransaction(suite.db, (tx) =>
      listInvoicePrinter(tx, {
        profileId: v.tillProfileId,
        pagePrinterId: row!.id,
        isDefault: true,
      }),
    );
  return row!.id;
}

/** A synthetic F1 for working order `orderId`, written through the core as part 1's delivery
 * suites do. */
async function fullInvoice(v: Venue, orderId: string = randomUUID()): Promise<string> {
  const sale = await withTransaction(suite.db, async (tx) => {
    await createOpenOrder(
      tx,
      { ...v.cfg, origin: jobOrigin("operator_script") },
      orderId,
      [],
      null,
      { zoneId: v.zoneId },
    );
    return recordSale(tx, v.backend, {
      origin: jobOrigin("operator_script"),
      nodeId: brandNode(v.nodeId),
      seriesId: brandSeries(v.seriesId),
      workingOrderId: brandWorkingOrder(orderId),
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name: "Coffee",
          descriptions: { "es-ES": "Coffee" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "0",
          lineTotal: "1.00",
        },
      ],
      clock,
      settlement: { kind: "deferred" },
      counterparty: { taxId: "12345678Z", legalName: "Saved customer", countryCode: "ES" },
      recipientAddress: "Saved address",
    });
  });
  return sale.saleId;
}

async function printOnA4(saleId: string, pagePrinterId: string) {
  return withTransaction(suite.db, (tx) =>
    reserveInvoiceDelivery(tx, saleId, {
      requestKey: randomUUID(),
      personId: "staff-one",
      medium: "a4",
      pagePrinterId,
    }),
  );
}

/** Staff ask the till to print the invoice again on the printer it offers. */
async function retryOnA4(v: Venue, orderId: string) {
  const offered = (await tillStatus(v, orderId)).actions.print!.printers;
  expect(offered).toHaveLength(1);
  const answer = await v.app.request(`/api/sales/${orderId}/deliveries`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: v.tillCookie },
    body: JSON.stringify({ medium: "print", printerId: offered[0]!.id, requestKey: randomUUID() }),
  });
  expect(answer.status).toBe(200);
  return row(((await answer.json()) as { id: string }).id);
}

/** The delivery status the till reads for working order `orderId`. */
async function tillStatus(v: Venue, orderId: string) {
  const answer = await v.app.request(`/api/sales/${orderId}/deliveries`, {
    headers: { cookie: v.tillCookie },
  });
  expect(answer.status).toBe(200);
  return (await answer.json()) as {
    current: { id: string; status: string; printerHold: string | null } | null;
    actions: { print: { printers: { id: string }[] } | null };
  };
}

async function row(id: string) {
  const [found] = await suite.db
    .select()
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.id, id));
  return found!;
}

async function originalPdf(v: Venue, saleId: string): Promise<Buffer> {
  const document = await withTransaction(suite.db, (tx) =>
    readInvoiceDocument(v.backend, tx, v.cfg, saleId),
  );
  return renderInvoicePdf({ ...document, duplicate: false });
}

/**
 * The agent claims the original and its process stops before it reaches the printer; the server's
 * clock then passes the lease, and the agent's restarted process polls, which ends the claim.
 */
async function lapsedOriginal(v: Venue) {
  let reachedPrinter!: () => void;
  const reached = new Promise<void>((resolve) => (reachedPrinter = resolve));
  const { running: first, agentId } = await joinedAgent(v, (running) => async () => {
    running.stopped.now = true;
    running.agent.stop();
    reachedPrinter();
    return new Promise<never>(() => {});
  });
  const office = await officePrinter(v, agentId);
  const orderId = randomUUID();
  const saleId = await fullInvoice(v, orderId);
  const original = await printOnA4(saleId, office);
  await first.agent.runOnce();
  await reached;
  expect(first.claims.map((job) => job.id)).toEqual([original.id]);
  expect(await row(original.id)).toMatchObject({ status: "sending", claimedBy: agentId });

  v.serverClock.ahead = INVOICE_DELIVERY_LEASE_MS + 1_000;
  const restarted = runAgent(v, {
    saved: { config: await first.host.config(), token: (await first.host.token())! },
  });
  await pollUntilIdle(restarted);
  expect(restarted.claims).toEqual([]);
  return { first, restarted, orderId, saleId, original };
}

describe("an A4 invoice through the real agent loop and a fake IPP printer", () => {
  it("A576 registers two queues on one HTTP server and sends each its own document", async () => {
    const v = await venue();
    const { running, agentId } = await joinedAgent(v);
    const endpoints = [
      {
        path: "/printers/kitchen",
        name: "Kitchen A4",
        media: "iso_a4_210x297mm",
        resolutionDpi: 300,
      },
      {
        path: "/printers/reception",
        name: "Reception A4",
        media: "na_letter_8.5x11in",
        resolutionDpi: 600,
      },
    ];
    const report = await v.app.request("/print-api/agent/jobs", {
      method: "POST",
      headers: {
        authorization: `Bearer ${await running.host.token()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        scanned: endpoints.map((e) => ({
          transport: "network_tcp",
          host: "127.0.0.1",
          port: ipp!.port,
          name: e.name,
          ippOnly: true,
          ipp: { port: ipp!.port, resourcePath: e.path },
          office: {
            port: ipp!.port,
            resourcePath: e.path,
            printable: true,
            documentFormat: "application/pdf",
            supportedFormats: ["application/pdf"],
            media: e.media,
            resolutionDpi: e.resolutionDpi,
          },
        })),
      }),
    });
    expect(report.status).toBe(200);
    const ids: string[] = [];
    const sales: string[] = [];
    const deliveries: string[] = [];
    for (const endpoint of endpoints) {
      const added = await request(v, "POST", "/management-api/page-printers", {
        agentId,
        host: "127.0.0.1",
        port: ipp!.port,
        path: endpoint.path,
        name: endpoint.name,
      });
      expect(added.status).toBe(201);
      const { id } = (await added.json()) as { id: string };
      ids.push(id);
      const saleId = await fullInvoice(v);
      sales.push(saleId);
      deliveries.push((await printOnA4(saleId, id)).id);
    }
    expect(new Set(ids).size).toBe(2);
    await pollUntilIdle(running);
    for (const [i, endpoint] of endpoints.entries()) {
      const jobs = ipp!.printJobs().filter((job) => job.url === endpoint.path);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.printerUri).toBe(`ipp://127.0.0.1:${ipp!.port}${endpoint.path}`);
      expect(jobs[0]!.documentFormat).toBe("application/pdf");
      expect(jobs[0]!.media).toBe(endpoint.media);
      expect(jobs[0]!.data.equals(await originalPdf(v, sales[i]!))).toBe(true);
      expect(
        ipp!.requests.filter((r) => r.operation === GET_JOB_ATTRIBUTES && r.url === endpoint.path)
          .length,
      ).toBeGreaterThan(0);
      expect(await row(deliveries[i]!)).toMatchObject({ status: "sent", pagePrinterId: ids[i] });
    }
    expect(ipp!.printJobs()[0]!.data.equals(ipp!.printJobs()[1]!.data)).toBe(false);
  });

  it("A576 saved single-queue printer prints without rediscovery", async () => {
    const v = await venue();
    const { running, agentId } = await joinedAgent(v);
    const id = await officePrinter(v, agentId);
    const [before] = await suite.db.select().from(pagePrinters).where(eq(pagePrinters.id, id));
    const sale = await fullInvoice(v);
    const delivery = await printOnA4(sale, id);
    await pollUntilIdle(running);
    expect(await row(delivery.id)).toMatchObject({ status: "sent", pagePrinterId: id });
    const [after] = await suite.db.select().from(pagePrinters).where(eq(pagePrinters.id, id));
    expect(after).toEqual(before);
    expect(ipp!.printJobs()[0]!.url).toBe("/ipp/print");
    expect(ipp!.printJobs()[0]!.data.equals(await originalPdf(v, sale))).toBe(true);
  });

  it("prints a synthetic F1's original on the office printer and ends it sent", async () => {
    const v = await venue();
    const { running, agentId } = await joinedAgent(v);
    const office = await officePrinter(v, agentId);
    const saleId = await fullInvoice(v);
    const delivery = await printOnA4(saleId, office);
    expect(delivery).toMatchObject({ status: "queued", designation: "original" });

    await pollUntilIdle(running);

    expect(running.claims.map((job) => job.id)).toEqual([delivery.id]);
    expect(await row(delivery.id)).toMatchObject({
      status: "sent",
      designation: "original",
      generation: 1,
      attempts: 1,
      failureCode: null,
      reportedOutcome: "sent",
      completedAt: expect.any(String),
    });
    const [printed, ...more] = ipp!.printJobs();
    expect(more).toEqual([]);
    expect(printed!.documentFormat).toBe("application/pdf");
    expect(printed!.data.equals(await originalPdf(v, saleId))).toBe(true);
  });

  it.each([
    ["through the manager's route", "route"],
    ["behind the route's back, so the claim itself refuses it", "row"],
  ] as const)(
    "ends an A4 for a printer disabled %s failed, and the printer is sent nothing",
    async (_how, how) => {
      const v = await venue();
      const { running, agentId } = await joinedAgent(v);
      const office = await officePrinter(v, agentId);
      const saleId = await fullInvoice(v);
      const delivery = await printOnA4(saleId, office);
      if (how === "route") {
        const disabled = await request(v, "PATCH", `/management-api/page-printers/${office}`, {
          active: false,
        });
        expect(disabled.status).toBe(204);
      } else {
        await suite.db
          .update(pagePrinters)
          .set({ active: false, invoiceDefault: false })
          .where(eq(pagePrinters.id, office));
        expect(await row(delivery.id)).toMatchObject({ status: "queued" });
      }

      await pollUntilIdle(running);

      expect(running.claims).toEqual([]);
      expect(await row(delivery.id)).toMatchObject({
        status: "failed",
        failureCode: "printer_disabled",
        attempts: 0,
        claimedBy: null,
        completedAt: null,
      });
      expect(ipp!.requests).toEqual([]);
    },
  );

  it("lets a stopped agent's claim lapse into unknown, then an explicit retry prints as original", async () => {
    const v = await venue();
    const { restarted, orderId, saleId, original } = await lapsedOriginal(v);
    expect(await row(original.id)).toMatchObject({
      status: "unknown",
      failureCode: "timeout",
      expiredAt: expect.any(String),
      reportedAt: null,
      completedAt: null,
    });
    expect(ipp!.requests).toEqual([]);

    const retry = await retryOnA4(v, orderId);
    expect(retry).toMatchObject({ status: "queued", designation: "original", generation: 2 });
    await pollUntilIdle(restarted);

    expect(restarted.claims.map((job) => job.id)).toEqual([retry.id]);
    expect(await row(retry.id)).toMatchObject({
      status: "sent",
      designation: "original",
      completedAt: expect.any(String),
    });
    expect(await row(original.id)).toMatchObject({ status: "unknown", failureCode: "timeout" });
    const [printed, ...more] = ipp!.printJobs();
    expect(more).toEqual([]);
    expect(printed!.data.equals(await originalPdf(v, saleId))).toBe(true);
  });

  it("records an old claim's late success after the retry as history only", async () => {
    const v = await venue();
    const { first, restarted, orderId, original } = await lapsedOriginal(v);
    const retry = await retryOnA4(v, orderId);
    await pollUntilIdle(restarted);
    const retryBefore = await row(retry.id);
    expect(retryBefore).toMatchObject({ status: "sent", designation: "original" });

    // The first process's report, arriving over the real client after all.
    const late = await createClient({
      fetch: (input, init) => Promise.resolve(v.app.request(input, init)),
    }).reportPageJob(BASE, (await first.host.token())!, first.claims[0]!, { status: "sent" });

    expect(late.ok).toBe(true);
    expect(await row(original.id)).toMatchObject({
      status: "unknown",
      failureCode: "timeout",
      completedAt: null,
      reportedOutcome: "sent",
      reportedAt: expect.any(String),
    });
    expect(await row(retry.id)).toEqual(retryBefore);
    expect(ipp!.printJobs()).toHaveLength(1);
  });

  it("keeps a job the printer holds for paper, shows the hold at the till, and prints it once paper goes in", async () => {
    const v = await venue();
    const { running, agentId } = await joinedAgent(v, () => printWithQuickPolls);
    try {
      const office = await officePrinter(v, agentId);
      const kitchen = await startFakeIppPrinter();
      more.push(kitchen);
      const kitchenOffice = await officePrinter(v, agentId, kitchen, "Kitchen office");
      ipp!.tray.empty = true;
      const orderId = randomUUID();
      const saleId = await fullInvoice(v, orderId);
      const held = await printOnA4(saleId, office);

      await running.agent.runOnce();
      // Only a renewal writes the hold, so seeing it at the till means one arrived.
      await until("the till to show the hold", async () => {
        return (await tillStatus(v, orderId)).current?.printerHold === "paper_out";
      });
      expect(await tillStatus(v, orderId)).toMatchObject({
        current: { id: held.id, status: "sending", printerHold: "paper_out" },
        originalCompleted: false,
        actions: { retryOriginal: null, print: null, receiptInstead: null },
      });

      const other = await printOnA4(await fullInvoice(v), kitchenOffice);
      await running.agent.runOnce();
      await until("the kitchen office's invoice to be sent", async () => {
        return (await row(other.id)).status === "sent";
      });
      expect(kitchen.printJobs()).toHaveLength(1);
      expect(await row(held.id)).toMatchObject({ status: "sending", printerHold: "paper_out" });
      expect(ipp!.printJobs()).toHaveLength(1);

      ipp!.tray.empty = false;
      await until("the held invoice to be sent", async () => {
        return (await row(held.id)).status === "sent";
      });
      await pollUntilIdle(running);

      expect(running.claims.map((job) => job.id)).toEqual([held.id, other.id]);
      expect(await row(held.id)).toMatchObject({
        status: "sent",
        designation: "original",
        attempts: 1,
        failureCode: null,
      });
      expect(await tillStatus(v, orderId)).toMatchObject({
        current: { id: held.id, status: "sent", printerHold: null },
        originalCompleted: true,
      });
      const [printed, ...again] = ipp!.printJobs();
      expect(again).toEqual([]);
      expect(printed!.data.equals(await originalPdf(v, saleId))).toBe(true);
    } finally {
      running.stopped.now = true;
    }
  });
});

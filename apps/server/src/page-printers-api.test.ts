import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  locations,
  pagePrinters,
  printAgents,
  stationPrinters,
  withTransaction,
} from "@waitron/db";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import { VENUE_SERVICE_MIGRATIONS } from "@waitron/venue-service";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, hashPin, persons, startManagementSession } from "@waitron/identity";
import { locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { createStation } from "./kitchen.js";
import { acceptPrintAgentJoinRequest } from "./join-requests.js";
import type { Logger } from "./logger.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountPrintApi } from "./print-api.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: [
    CORE_MIGRATIONS,
    IDENTITY_MIGRATIONS,
    CATALOGUE_MIGRATIONS,
    VENUE_SERVICE_MIGRATIONS,
  ],
  timeoutMs: 60_000,
});

const noopLog: Logger = () => {};
const PRINTABLE = {
  port: 631,
  resourcePath: "/ipp/print",
  printable: true,
  documentFormat: "application/pdf",
  media: "iso_a4_210x297mm",
  resolutionDpi: 600,
  supportedFormats: ["application/pdf", "image/urf"],
} as const;
const UNANSWERED = {
  port: 631,
  resourcePath: "/ipp/print",
  printable: false,
  reason: "invalid_reply",
  supportedFormats: [],
} as const;
/** Text the printer announced; none of it may reach a response or a stored name. */
const ANNOUNCED = { make: "HP", model: "LaserJet Pro M404dn", name: "HP LaserJet secret-floor-3" };

let cfg: TillConfig;
let managerCookie: string;
let staffCookie: string;

beforeEach(async () => {
  await seedTenant(suite.db);
  const [loc] = await suite.db
    .insert(locations)
    .values({ name: "Barra", invoiceLocales: ["es-ES"], operationDescription: "Venta" })
    .returning({ id: locations.id });
  cfg = {
    nodeId: brandNodeId(randomUUID()),
    locationId: brandLocationId(loc!.id),
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const sessions = await withTransaction(suite.db, async (tx) => {
    const [mgr] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const [stf] = await tx
      .insert(persons)
      .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
      .returning({ id: persons.id });
    return {
      manager: (await startManagementSession(tx, { personId: mgr!.id })).token,
      staff: (await startManagementSession(tx, { personId: stf!.id })).token,
    };
  });
  managerCookie = `${MANAGEMENT_COOKIE}=${sessions.manager}`;
  staffCookie = `${MANAGEMENT_COOKIE}=${sessions.staff}`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mountApp(): Hono {
  const app = new Hono();
  const pairingMode = createPairingMode();
  pairingMode.open();
  mountPrintApi(
    app,
    {
      db: suite.db,
      cfg,
      pairingMode,
      readMembership: async () => signedMembershipDoc(1, { signerNodeId: "box", nodes: [] }),
      readInvoiceDocument: () => Promise.reject(new Error("No invoice is read here")),
      venueLocale: "es-ES",
    },
    noopLog,
  );
  return app;
}

async function send(
  app: Hono,
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  opts: { body?: unknown; cookie?: string; bearer?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie !== undefined) headers["cookie"] = opts.cookie;
  if (opts.bearer !== undefined) headers["authorization"] = `Bearer ${opts.bearer}`;
  return app.request(path, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

async function joinAgent(app: Hono, label: string): Promise<{ agentId: string; token: string }> {
  const res = await send(app, "POST", "/print-api/agent/join", { body: { name: label } });
  expect(res.status).toBe(201);
  const { token, verificationNumber } = (await res.json()) as {
    token: string;
    verificationNumber: string;
  };
  const agentId = token.slice(0, token.indexOf("."));
  await withTransaction(suite.db, async (tx) => {
    const result = await acceptPrintAgentJoinRequest(tx, cfg, agentId, {
      choice: verificationNumber,
    });
    expect(result.ok).toBe(true);
  });
  return { agentId, token };
}

async function scan(app: Hono, token: string, scanned: unknown[]): Promise<void> {
  const res = await send(app, "POST", "/print-api/agent/jobs", {
    bearer: token,
    body: { visible: [], scanned },
  });
  expect(res.status).toBe(200);
}

function officeEntry(host: string, office: unknown = PRINTABLE) {
  return { transport: "network_tcp", host, port: 9100, pagePrinter: true, office, ...ANNOUNCED };
}

function target(agentId: string, host: string, extra: Record<string, unknown> = {}) {
  return { agentId, host, port: PRINTABLE.port, path: PRINTABLE.resourcePath, ...extra };
}

async function register(app: Hono, body: unknown, cookie = managerCookie): Promise<Response> {
  return send(app, "POST", "/management-api/page-printers", { cookie, body });
}

async function registered(app: Hono, body: unknown): Promise<{ id: string; outcome: string }> {
  const res = await register(app, body);
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  return (await res.json()) as { id: string; outcome: string };
}

async function list(app: Hono): Promise<Record<string, unknown>[]> {
  const res = await send(app, "GET", "/management-api/page-printers", { cookie: managerCookie });
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>[];
}

async function stored(id: string) {
  const [row] = await suite.db.select().from(pagePrinters).where(eq(pagePrinters.id, id));
  return row;
}

it("A576 creates enables and repoints only the selected queue", async () => {
  const app = mountApp();
  const a = await joinAgent(app, "Office agent");
  const host = "10.61.20.1";
  const queue = (path: string, report: unknown = { ...PRINTABLE, resourcePath: path }) => ({
    ...officeEntry(host, report),
    port: 631,
    ippOnly: true,
    ipp: { port: 631, resourcePath: path },
  });
  await scan(app, a.token, [queue("/printers/kitchen"), queue("/printers/reception")]);
  const kitchen = await registered(
    app,
    target(a.agentId, host, { path: "/printers/kitchen", name: "Kitchen A4" }),
  );
  const reception = await registered(
    app,
    target(a.agentId, host, { path: "/printers/reception", name: "Reception A4" }),
  );
  expect(kitchen.id).not.toBe(reception.id);
  const disabled = await send(app, "PATCH", `/management-api/page-printers/${kitchen.id}`, {
    cookie: managerCookie,
    body: { active: false },
  });
  expect(disabled.status).toBe(204);
  expect(await stored(reception.id)).toMatchObject({ active: true, agentId: a.agentId });
  expect(
    await registered(app, target(a.agentId, host, { path: "/printers/kitchen", name: "Ignored" })),
  ).toEqual({ id: kitchen.id, outcome: "enabled" });
  const keptKitchen = await stored(kitchen.id);
  const b = await joinAgent(app, "Second agent");
  await scan(app, b.token, [
    queue("/printers/reception", {
      ...PRINTABLE,
      resourcePath: "/printers/reception",
      resolutionDpi: 600,
    }),
  ]);
  expect(
    await registered(
      app,
      target(b.agentId, host, { path: "/printers/reception", name: "Ignored" }),
    ),
  ).toEqual({ id: reception.id, outcome: "repointed" });
  expect(await stored(kitchen.id)).toEqual(keptKitchen);
  expect(await stored(reception.id)).toMatchObject({
    name: "Reception A4",
    agentId: b.agentId,
    resourcePath: "/printers/reception",
    resolutionDpi: 600,
  });
});

/** One agent, one fresh printable office entry at `host`, registered as "Oficina". */
async function onePrinter(app: Hono, host = "10.61.0.1") {
  const agent = await joinAgent(app, "Office agent");
  await scan(app, agent.token, [officeEntry(host)]);
  const { id } = await registered(app, target(agent.agentId, host, { name: "Oficina" }));
  return { ...agent, id, host };
}

describe("page-printer management routes", () => {
  it("refuses every route to a role without printer.manage, and serves a manager", async () => {
    const app = mountApp();
    const { agentId, id, host } = await onePrinter(app);
    const routes: { method: "GET" | "POST" | "PATCH"; path: string; body?: unknown }[] = [
      { method: "GET", path: "/management-api/page-printers" },
      { method: "POST", path: "/management-api/page-printers", body: target(agentId, host) },
      { method: "PATCH", path: `/management-api/page-printers/${id}`, body: { name: "Renamed" } },
    ];
    for (const route of routes) {
      const refused = await send(app, route.method, route.path, {
        cookie: staffCookie,
        body: route.body,
      });
      expect(refused.status, `${route.method} ${route.path}`).toBe(403);
      expect(await refused.json()).toMatchObject({
        error: { code: "authorization.not_permitted" },
      });
    }
    expect(await stored(id)).toMatchObject({ name: "Oficina" });

    for (const route of routes) {
      const served = await send(app, route.method, route.path, {
        cookie: managerCookie,
        body: route.body,
      });
      expect(served.status, `${route.method} ${route.path}`).toBeLessThan(300);
    }
    expect(await stored(id)).toMatchObject({ name: "Renamed" });
  });

  it("registers from a fresh entry, taking the capabilities from the agent's report, never the body", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    await scan(app, agent.token, [officeEntry("10.61.1.1")]);

    const res = await register(
      app,
      target(agent.agentId, "10.61.1.1", {
        name: "  Oficina  ",
        documentFormat: "image/urf",
        supportedFormats: ["image/urf"],
        media: "na_letter_8.5x11in",
        resolutionDpi: 300,
        active: false,
      }),
    );
    expect(res.status).toBe(201);
    const { id, outcome } = (await res.json()) as { id: string; outcome: string };
    expect(outcome).toBe("created");
    expect(await stored(id)).toMatchObject({
      name: "Oficina",
      host: "10.61.1.1",
      port: 631,
      resourcePath: "/ipp/print",
      documentFormat: "application/pdf",
      supportedFormats: ["application/pdf", "image/urf"],
      media: "iso_a4_210x297mm",
      resolutionDpi: 600,
      active: true,
      agentId: agent.agentId,
    });
  });

  it("names the printer after its host when the manager gives no name, never after its announcement", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    await scan(app, agent.token, [officeEntry("hp-office.local"), officeEntry("10.61.2.2")]);
    const unnamed = await registered(app, target(agent.agentId, "hp-office.local"));
    const blank = await registered(app, target(agent.agentId, "10.61.2.2", { name: "   " }));
    expect((await stored(unnamed.id))!.name).toBe("hp-office.local");
    expect((await stored(blank.id))!.name).toBe("10.61.2.2");
  });

  it("refuses a register with no matching fresh entry as page_printer.not_found", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    const other = await joinAgent(app, "Other agent");
    await scan(app, agent.token, [officeEntry("10.61.3.1")]);
    const misses = [
      target(agent.agentId, "10.61.3.9"),
      target(other.agentId, "10.61.3.1"),
      target(agent.agentId, "10.61.3.1", { port: 632 }),
      target(agent.agentId, "10.61.3.1", { path: "/ipp/other" }),
      target(randomUUID(), "10.61.3.1"),
    ];
    for (const body of misses) {
      const res = await register(app, body);
      expect(res.status, JSON.stringify(body)).toBe(404);
      expect(await res.json()).toEqual({ error: { code: "page_printer.not_found", params: {} } });
    }
    expect(await suite.db.select().from(pagePrinters)).toEqual([]);
  });

  it("matches the entry's host without regard to case", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    await scan(app, agent.token, [officeEntry("HP-Office.local")]);
    const { outcome } = await registered(app, target(agent.agentId, "hp-office.LOCAL"));
    expect(outcome).toBe("created");
  });

  it("refuses an entry just past the discovered list's bound, and serves one at it", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    const reportedAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(reportedAt);
    await scan(app, agent.token, [officeEntry("10.61.4.1")]);

    vi.spyOn(Date, "now").mockReturnValue(reportedAt + 15_001);
    const stale = await register(app, target(agent.agentId, "10.61.4.1"));
    expect(stale.status).toBe(404);
    expect(await stale.json()).toEqual({ error: { code: "page_printer.not_found", params: {} } });

    vi.spyOn(Date, "now").mockReturnValue(reportedAt + 15_000);
    expect((await registered(app, target(agent.agentId, "10.61.4.1"))).outcome).toBe("created");
  });

  it("keeps an entry listed for the longer bound while a discovery window is open", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    const start = await send(app, "POST", "/management-api/printer-discovery/start", {
      cookie: managerCookie,
    });
    expect(start.status).toBe(200);
    const reportedAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(reportedAt);
    await scan(app, agent.token, [officeEntry("10.61.4.2")]);
    vi.spyOn(Date, "now").mockReturnValue(reportedAt + 30_000);
    expect((await registered(app, target(agent.agentId, "10.61.4.2"))).outcome).toBe("created");
  });

  it("refuses an entry whose printer cannot print an invoice as page_printer.not_printable", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    await scan(app, agent.token, [officeEntry("10.61.5.1", UNANSWERED)]);
    const res = await register(app, target(agent.agentId, "10.61.5.1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: "page_printer.not_printable", params: {} },
    });
    expect(await suite.db.select().from(pagePrinters)).toEqual([]);
  });

  it("takes a printable report over an unprintable one the same agent sent for the same queue", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    await scan(app, agent.token, [
      { ...officeEntry("10.61.5.2", UNANSWERED), port: 631, ippOnly: true },
      officeEntry("10.61.5.2"),
      { ...officeEntry("10.61.5.2", UNANSWERED), port: 9101 },
    ]);
    expect((await registered(app, target(agent.agentId, "10.61.5.2"))).outcome).toBe("created");
  });

  it("takes the agent's latest report for a queue over an older printable one", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    const first = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(first);
    await scan(app, agent.token, [officeEntry("10.61.5.3")]);
    vi.spyOn(Date, "now").mockReturnValue(first + 1_000);
    await scan(app, agent.token, [{ ...officeEntry("10.61.5.3", UNANSWERED), port: 631 }]);
    const res = await register(app, target(agent.agentId, "10.61.5.3"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "page_printer.not_printable" } });
  });

  it("refuses a malformed register body, storing nothing", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    await scan(app, agent.token, [officeEntry("10.61.6.1")]);
    const cases: [Record<string, unknown>, string][] = [
      [{ agentId: "not-a-uuid" }, "agentId"],
      [{ host: 7 }, "host"],
      [{ host: "  " }, "host"],
      [{ port: "631" }, "port"],
      [{ port: 6.5 }, "port"],
      [{ path: null }, "path"],
      [{ name: 3 }, "name"],
    ];
    for (const [change, field] of cases) {
      const res = await register(app, { ...target(agent.agentId, "10.61.6.1"), ...change });
      expect(res.status, field).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    expect(await suite.db.select().from(pagePrinters)).toEqual([]);
  });

  it("lists each page printer with its recorded agent's id and name, and no announced text", async () => {
    const app = mountApp();
    const { agentId, id } = await onePrinter(app, "10.61.7.1");
    const [orphan] = await suite.db
      .insert(pagePrinters)
      .values({
        locationId: cfg.locationId,
        name: "Sin agente",
        host: "10.61.7.2",
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "image/pwg-raster",
        supportedFormats: ["image/pwg-raster"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 300,
      })
      .returning({ id: pagePrinters.id });

    const res = await send(app, "GET", "/management-api/page-printers", { cookie: managerCookie });
    const text = await res.text();
    for (const announced of Object.values(ANNOUNCED)) expect(text).not.toContain(announced);
    expect(JSON.parse(text)).toEqual([
      {
        id,
        name: "Oficina",
        host: "10.61.7.1",
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf", "image/urf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 600,
        active: true,
        agentId,
        agentName: "Office agent",
      },
      {
        id: orphan!.id,
        name: "Sin agente",
        host: "10.61.7.2",
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "image/pwg-raster",
        supportedFormats: ["image/pwg-raster"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 300,
        active: true,
        agentId: null,
        agentName: null,
      },
    ]);
  });

  it("re-points an active printer to a new agent's fresh entry at its address, under the same id", async () => {
    const app = mountApp();
    const { id, host } = await onePrinter(app, "10.61.8.1");
    const second = await joinAgent(app, "Second agent");
    await scan(app, second.token, [officeEntry(host)]);

    const res = await register(app, target(second.agentId, host, { name: "Ignored" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, outcome: "repointed" });
    expect((await list(app))[0]).toMatchObject({
      id,
      name: "Oficina",
      agentId: second.agentId,
      agentName: "Second agent",
    });
  });

  it("refuses a re-point from a new agent's entry just past the bound, keeping the recorded agent", async () => {
    const app = mountApp();
    const { id, host, agentId } = await onePrinter(app, "10.61.8.2");
    const second = await joinAgent(app, "Second agent");
    const reportedAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(reportedAt);
    await scan(app, second.token, [officeEntry(host)]);
    vi.spyOn(Date, "now").mockReturnValue(reportedAt + 15_001);

    const res = await register(app, target(second.agentId, host));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "page_printer.not_found", params: {} } });
    expect((await stored(id))!.agentId).toBe(agentId);
  });

  it("renames, disables, and re-enables only through a fresh entry", async () => {
    const app = mountApp();
    const { id, host, agentId } = await onePrinter(app, "10.61.9.1");

    const renamed = await send(app, "PATCH", `/management-api/page-printers/${id}`, {
      cookie: managerCookie,
      body: { name: "  Recepción  " },
    });
    expect(renamed.status).toBe(204);
    expect((await stored(id))!.name).toBe("Recepción");

    const disabled = await send(app, "PATCH", `/management-api/page-printers/${id}`, {
      cookie: managerCookie,
      body: { active: false },
    });
    expect(disabled.status).toBe(204);
    expect((await stored(id))!.active).toBe(false);

    const enable = await send(app, "PATCH", `/management-api/page-printers/${id}`, {
      cookie: managerCookie,
      body: { name: "Otra", active: true },
    });
    expect(enable.status).toBe(409);
    expect(await enable.json()).toEqual({
      error: { code: "page_printer.rediscover", params: {} },
    });
    expect(await stored(id)).toMatchObject({ name: "Recepción", active: false });

    const res = await register(app, target(agentId, host, { name: "Ignored" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, outcome: "enabled" });
    expect(await stored(id)).toMatchObject({ name: "Recepción", active: true });
  });

  it("renames and disables in one request", async () => {
    const app = mountApp();
    const { id } = await onePrinter(app, "10.61.9.2");
    const res = await send(app, "PATCH", `/management-api/page-printers/${id}`, {
      cookie: managerCookie,
      body: { name: "Vieja", active: false },
    });
    expect(res.status).toBe(204);
    expect(await stored(id)).toMatchObject({ name: "Vieja", active: false });
  });

  it("refuses a malformed or empty PATCH, and an unknown id", async () => {
    const app = mountApp();
    const { id } = await onePrinter(app, "10.61.9.3");
    const cases: [unknown, string][] = [
      [{}, "name"],
      [{ name: "  " }, "name"],
      [{ name: 4 }, "name"],
      [{ active: "false" }, "active"],
    ];
    for (const [body, field] of cases) {
      const res = await send(app, "PATCH", `/management-api/page-printers/${id}`, {
        cookie: managerCookie,
        body,
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: "management.request_invalid", params: { field } },
      });
    }
    expect(await stored(id)).toMatchObject({ name: "Oficina", active: true });

    const malformed = await send(app, "PATCH", "/management-api/page-printers/nope", {
      cookie: managerCookie,
      body: { name: "X" },
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "shared.invalid_id" } });
    for (const body of [{ name: "X" }, { active: false }]) {
      const unknown = await send(app, "PATCH", `/management-api/page-printers/${randomUUID()}`, {
        cookie: managerCookie,
        body,
      });
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({
        error: { code: "page_printer.not_found", params: {} },
      });
    }
  });

  it("serves no location-wide invoice printer route", async () => {
    const app = mountApp();
    const { id } = await onePrinter(app, "10.61.10.1");
    const res = await send(app, "PUT", "/management-api/page-printers/invoice-printer", {
      cookie: managerCookie,
      body: { pagePrinterId: id },
    });
    expect(res.status).toBe(404);
    expect((await list(app))[0]).not.toHaveProperty("invoicePrinter");
  });
});

describe("a page printer is never a receipt printer", () => {
  it("is never listed by GET /management-api/printers", async () => {
    const app = mountApp();
    await onePrinter(app, "10.61.11.1");
    const res = await send(app, "GET", "/management-api/printers", { cookie: managerCookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("is refused by the receipt printer's PATCH and by a station's attach, by domain code", async () => {
    const app = mountApp();
    const { id } = await onePrinter(app, "10.61.11.2");
    const patch = await send(app, "PATCH", `/management-api/printers/${id}`, {
      cookie: managerCookie,
      body: { name: "Receipts", active: true },
    });
    expect(patch.status).toBe(404);
    expect(await patch.json()).toMatchObject({ error: { code: "printer.not_found" } });

    const station = await withTransaction(suite.db, (tx) =>
      createStation(tx, cfg, { name: "Grill" }),
    );
    const attach = await send(
      app,
      "POST",
      `/management-api/stations/${station.id}/printers/${id}`,
      { cookie: managerCookie },
    );
    expect(attach.status).toBe(404);
    expect(await attach.json()).toMatchObject({ error: { code: "printer.not_found" } });
    expect(await suite.db.select().from(stationPrinters)).toEqual([]);
    expect(await stored(id)).toMatchObject({ name: "Oficina", active: true });
  });

  it("refuses an entry reported by an agent of another location", async () => {
    const app = mountApp();
    const agent = await joinAgent(app, "Office agent");
    await scan(app, agent.token, [officeEntry("10.61.12.1")]);
    const [elsewhere] = await suite.db
      .insert(locations)
      .values({ name: "Terraza", invoiceLocales: ["es-ES"], operationDescription: "Venta" })
      .returning({ id: locations.id });
    await suite.db
      .update(printAgents)
      .set({ locationId: elsewhere!.id })
      .where(eq(printAgents.id, agent.agentId));
    const res = await register(app, target(agent.agentId, "10.61.12.1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "page_printer.not_found", params: {} } });
  });
});

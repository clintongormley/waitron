import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { recordIncident } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, startManagementSession, type BuiltInRoleKey } from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { MANAGEMENT_COOKIE, type Logger } from "@waitron/server-kit";
import { AppError, jobOrigin, type ErrorCode, type ErrorParams } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { steadyClock } from "../test/write-path-fixtures.js";
import { readFilingOverview } from "./filing-overview.js";
import { readFilingWarnings } from "./filing-warnings.js";
import { FISCAL_ROUTES } from "./routes.js";
import { appendToChain } from "./chain.js";
import { altaFor, seedNode, seedSale } from "./testing/seed.js";

vi.mock("./filing-overview.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./filing-overview.js")>();
  return { ...actual, readFilingOverview: vi.fn(actual.readFilingOverview) };
});

vi.mock("./filing-warnings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./filing-warnings.js")>();
  return { ...actual, readFilingWarnings: vi.fn(actual.readFilingWarnings) };
});

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const PATH = "/management-api/fiscal-filing";

async function sessionCookie(role: BuiltInRoleKey): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const [person] = await seedPersons(tx, { displayName: role, pinHash: hashPin("1234"), role });
    const session = await startManagementSession(tx, { personId: person!.id });
    return `${MANAGEMENT_COOKIE}=${session.token}`;
  });
}

function mount(
  drain?: ModuleRouteContext["fiscalDrain"],
  recordGeneration?: ModuleRouteContext["recordGeneration"],
  log: Logger = () => {},
): Hono {
  const ctx: ModuleRouteContext = {
    db: suite.db,
    cfg: {},
    core: {} as ModuleRouteContext["core"],
    ...(drain === undefined ? {} : { fiscalDrain: drain }),
    ...(recordGeneration === undefined ? {} : { recordGeneration }),
  };
  const app = new Hono();
  FISCAL_ROUTES.mount(app, ctx, log);
  return app;
}

beforeEach(() => {
  vi.mocked(readFilingOverview).mockClear();
  vi.mocked(readFilingWarnings).mockClear();
});

it("answers a manager with the overview, not cached, on a box without a submission loop", async () => {
  const res = await mount().request(PATH, { headers: { cookie: await sessionCookie("manager") } });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toMatchObject({ filing: false, awaitingCertificate: false });
  expect(readFilingOverview).toHaveBeenCalledWith(expect.anything(), {
    nodeId: null,
    limit: 200,
  });
});

it("reads the conflicts of the box that issues records here", async () => {
  const nodeId = "44444444-4444-4444-8444-444444444444";
  const app = mount(undefined, {
    nodeId,
  } as unknown as NonNullable<ModuleRouteContext["recordGeneration"]>);
  const res = await app.request(PATH, { headers: { cookie: await sessionCookie("manager") } });
  expect(res.status).toBe(200);
  expect(readFilingOverview).toHaveBeenCalledWith(expect.anything(), { nodeId, limit: 200 });
});

it("answers the box's own day and the venue's offset, as a replacement issued now is dated", async () => {
  const node = await seedNode(suite.db);
  // 23:30 in UTC on 28 February is already 00:30 on 1 March in Madrid, the venue's zone. The
  // clock's own offset says UTC, so only the venue's zone can give 1 March.
  const instant = new Date("2026-02-28T23:30:00Z");
  const app = mount(undefined, {
    nodeId: node.nodeId,
    clock: { ...steadyClock, now: () => ({ ...steadyClock.now(), instant, offsetMinutes: 0 }) },
  } as unknown as NonNullable<ModuleRouteContext["recordGeneration"]>);
  const res = await app.request(PATH, { headers: { cookie: await sessionCookie("manager") } });
  expect(res.status).toBe(200);
  expect((await res.json()).today).toEqual({ day: "2026-03-01", offsetMinutes: 60 });
});

it("answers no day on a box that issues no records here, or whose node the venue does not list", async () => {
  const cookie = await sessionCookie("manager");
  const none = await mount().request(PATH, { headers: { cookie } });
  expect(await none.json()).toMatchObject({ today: null });
  const unknown = mount(undefined, {
    nodeId: "44444444-4444-4444-8444-444444444444",
    clock: steadyClock,
  } as unknown as NonNullable<ModuleRouteContext["recordGeneration"]>);
  const res = await unknown.request(PATH, { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ today: null });
});

it("answers no day, and logs why, when the venue's zone cannot place the box's clock", async () => {
  const node = await seedNode(suite.db);
  const log = vi.fn<Logger>();
  const app = mount(
    undefined,
    {
      nodeId: node.nodeId,
      clock: { ...steadyClock, now: () => ({ ...steadyClock.now(), instant: new Date(NaN) }) },
    } as unknown as NonNullable<ModuleRouteContext["recordGeneration"]>,
    log,
  );
  const res = await app.request(PATH, { headers: { cookie: await sessionCookie("manager") } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ today: null });
  expect(log).toHaveBeenCalledWith("warn", "fiscal.filing_day_unread", {
    errorCode: "venue.time_zone_conversion_failed",
    reason: "invalid_instant",
  });
});

it("logs a day-read failure's own log-only reason as logReason, beside its params", async () => {
  const node = await seedNode(suite.db);
  const log = vi.fn<Logger>();
  const app = mount(
    undefined,
    {
      nodeId: node.nodeId,
      clock: {
        ...steadyClock,
        now: () => {
          throw new AppError("venue.not_found", {}, { reason: "no business day row" });
        },
      },
    } as unknown as NonNullable<ModuleRouteContext["recordGeneration"]>,
    log,
  );
  const res = await app.request(PATH, { headers: { cookie: await sessionCookie("manager") } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ today: null });
  expect(log).toHaveBeenCalledWith("warn", "fiscal.filing_day_unread", {
    errorCode: "venue.not_found",
    logReason: "no business day row",
  });
});

it.each([
  new AppError("venue.time_zone_invalid", { reason: "missing" }),
  new AppError("venue.time_zone_target_invalid", { reason: "mismatch" }),
  new AppError("venue.time_zone_conversion_failed", { reason: "unreadable_offset" }),
  new AppError("venue.not_found", {}),
  new AppError("settings.invalid", { module: "venue", field: "timeZone" }),
])("answers no day, rather than fail the page, on %s", async (refusal) => {
  const node = await seedNode(suite.db);
  const log = vi.fn<Logger>();
  const app = mount(
    undefined,
    {
      nodeId: node.nodeId,
      clock: {
        ...steadyClock,
        now: () => {
          throw refusal;
        },
      },
    } as unknown as NonNullable<ModuleRouteContext["recordGeneration"]>,
    log,
  );
  const res = await app.request(PATH, { headers: { cookie: await sessionCookie("manager") } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ today: null });
  expect(log).toHaveBeenCalledWith("warn", "fiscal.filing_day_unread", {
    errorCode: refusal.code,
    ...refusal.params,
  });
});

it("fails the read on a Waitron error that is not about the venue's zone, venue or settings", async () => {
  const node = await seedNode(suite.db);
  const log = vi.fn<Logger>();
  const app = mount(
    undefined,
    {
      nodeId: node.nodeId,
      clock: {
        ...steadyClock,
        now: () => {
          throw new AppError("storage.disk_full", {});
        },
      },
    } as unknown as NonNullable<ModuleRouteContext["recordGeneration"]>,
    log,
  );
  const res = await app.request(PATH, { headers: { cookie: await sessionCookie("manager") } });
  expect(res.status).toBe(507);
  expect((await res.json()).error.code).toBe("storage.disk_full");
  expect(log).not.toHaveBeenCalledWith("warn", "fiscal.filing_day_unread", expect.anything());
});

it("fails the read, rather than answer a day, when the clock fails with an error that is not Waitron's", async () => {
  const node = await seedNode(suite.db);
  const app = mount(undefined, {
    nodeId: node.nodeId,
    clock: {
      ...steadyClock,
      now: () => {
        throw new Error("clock broken");
      },
    },
  } as unknown as NonNullable<ModuleRouteContext["recordGeneration"]>);
  const res = await app.request(PATH, { headers: { cookie: await sessionCookie("manager") } });
  expect(res.status).toBe(500);
});

it("reports the submission loop's state beside the overview", async () => {
  const app = mount({ filing: () => true, awaitingCertificate: () => true, wake: () => {} });
  const res = await app.request(PATH, { headers: { cookie: await sessionCookie("manager") } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ filing: true, awaitingCertificate: true });
});

it("refuses a supervisor, who may view reports but not export them", async () => {
  const res = await mount().request(PATH, {
    headers: { cookie: await sessionCookie("supervisor") },
  });
  expect(res.status).toBe(403);
  expect(await res.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
  expect(readFilingOverview).not.toHaveBeenCalled();
  expect(readFilingWarnings).not.toHaveBeenCalled();
});

it("refuses a request with no management session", async () => {
  const res = await mount().request(PATH);
  expect(res.status).toBe(401);
  expect(await res.json()).toMatchObject({ error: { code: "management_session.required" } });
});

it("reads every open case when asked for all of them, and ignores any other value", async () => {
  const cookie = await sessionCookie("manager");
  const app = mount();
  expect((await app.request(`${PATH}?cases=all`, { headers: { cookie } })).status).toBe(200);
  expect((await app.request(`${PATH}?cases=some`, { headers: { cookie } })).status).toBe(200);
  expect(vi.mocked(readFilingOverview).mock.calls.map(([, scope]) => scope.limit)).toEqual([
    null,
    200,
  ]);
});

it("answers the open warnings beside the overview, and reads every one when asked for all", async () => {
  const node = await seedNode(suite.db);
  const saleId = await seedSale(suite.db, node, 1);
  const alta = altaFor(node, saleId, 1, 1);
  const ipsiLine = { ...alta.input.Desglose[0]!, Impuesto: "02" as const };
  delete ipsiLine.ClaveRegimen;
  await withTransaction(suite.db, (tx) =>
    appendToChain(tx, node.nodeId, { ...alta, input: { ...alta.input, Desglose: [ipsiLine] } }),
  );
  const cookie = await sessionCookie("manager");
  const app = mount();

  const res = await app.request(PATH, { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { warnings: unknown }).warnings).toEqual({
    replyMismatches: [],
    recordWarnings: [
      {
        detectedAt: alta.input.generadoEn.toISOString(),
        kind: "flagged",
        fields: ["Desglose[0].ClaveRegimen"],
        codes: ["CLAVE_REGIMEN_REQUIRED"],
        record: {
          numSerieFactura: "A/1",
          fechaExpedicionFactura: "2026-07-20",
          tipoRegistro: "alta",
          estado: null,
        },
      },
    ],
    total: 1,
  });
  expect((await app.request(`${PATH}?cases=all`, { headers: { cookie } })).status).toBe(200);
  expect(vi.mocked(readFilingWarnings).mock.calls.map(([, scope]) => scope.limit)).toEqual([
    200,
    null,
  ]);
});

it("still answers the whole page when an open warning's stored details are not in their usual shape", async () => {
  // Two sources, as an open alert of one code from one source is recorded once.
  const malformed: ["dashboard" | "fiscal_filing", ErrorCode, Record<string, unknown>][] = [
    ["fiscal_filing", "fiscal.respuesta_descuadrada", {}],
    ["dashboard", "fiscal.respuesta_descuadrada", { lineasRespuesta: "none", csv: 7 }],
    ["fiscal_filing", "fiscal.record_flagged", {}],
    ["fiscal_filing", "fiscal.record_totals_disagree", { fields: "ImporteTotal", codes: null }],
  ];
  await withTransaction(suite.db, async (tx) => {
    for (const [index, [source, code, params]] of malformed.entries())
      await recordIncident(tx, {
        origin: jobOrigin(source),
        error: new AppError(code, params as ErrorParams[typeof code]),
        severity: "warning",
        detectedAt: new Date(Date.UTC(2026, 6, 20, 10, index)),
      });
  });

  const res = await mount().request(PATH, {
    headers: { cookie: await sessionCookie("manager") },
  });

  expect(res.status).toBe(200);
  const answer = (await res.json()) as { warnings: unknown; progress: unknown };
  expect(answer.progress).toBeDefined();
  expect(answer.warnings).toEqual({
    replyMismatches: [
      { detectedAt: "2026-07-20T10:01:00.000Z", csv: null, sent: [], lines: [] },
      { detectedAt: "2026-07-20T10:00:00.000Z", csv: null, sent: [], lines: [] },
    ],
    recordWarnings: [
      {
        detectedAt: "2026-07-20T10:03:00.000Z",
        kind: "totals",
        fields: [],
        codes: [],
        record: null,
      },
      {
        detectedAt: "2026-07-20T10:02:00.000Z",
        kind: "flagged",
        fields: [],
        codes: [],
        record: null,
      },
    ],
    total: 4,
  });
});

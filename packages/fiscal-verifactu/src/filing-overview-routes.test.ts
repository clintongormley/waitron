import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, startManagementSession, type BuiltInRoleKey } from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { readFilingOverview } from "./filing-overview.js";
import { FISCAL_ROUTES } from "./routes.js";

vi.mock("./filing-overview.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./filing-overview.js")>();
  return { ...actual, readFilingOverview: vi.fn(actual.readFilingOverview) };
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
): Hono {
  const ctx: ModuleRouteContext = {
    db: suite.db,
    cfg: {},
    core: {} as ModuleRouteContext["core"],
    ...(drain === undefined ? {} : { fiscalDrain: drain }),
    ...(recordGeneration === undefined ? {} : { recordGeneration }),
  };
  const app = new Hono();
  FISCAL_ROUTES.mount(app, ctx, () => {});
  return app;
}

beforeEach(() => {
  vi.mocked(readFilingOverview).mockClear();
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

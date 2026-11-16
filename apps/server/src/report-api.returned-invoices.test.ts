import { Hono } from "hono";
import { beforeEach, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { startManagementSession } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedVenueWithSeries } from "@waitron/reporting/test/fixtures.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { mountReportApi } from "./report-api.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const path = "/management-api/reports/returned-invoices";
const reader = vi.fn();
let app: Hono;
let cookie: string;
let staffCookie: string;
let nodeId: string;
beforeEach(async () => {
  nodeId = (await seedVenueWithSeries(suite.db)).nodeId;
  await withTransaction(suite.db, async (tx) => {
    for (const role of ["supervisor", "staff"] as const) {
      const [person] = await seedPersons(tx, {
        displayName: role,
        role,
        pinHash: fixturePinHash("1234"),
      });
      const session = await startManagementSession(tx, {
        method: "password",
        personId: person!.id,
      });
      if (role === "supervisor") cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
      else staffCookie = `${MANAGEMENT_COOKIE}=${session.token}`;
    }
  });
  reader.mockReset().mockResolvedValue({ rows: [], total: 0, page: 0, pageSize: 50 });
  app = new Hono();
  mountReportApi(
    app,
    { db: suite.db, cfg: { nodeId }, venueLocale: "en-GB", returnedInvoices: reader },
    () => {},
  );
});
it("returns the backend's corrected page with totals and keeps it out of caches", async () => {
  const result = { rows: [{ recordId: "returned" }], page: 2, total: 101, pageSize: 50 };
  reader.mockResolvedValue(result);
  const response = await app.request(
    path + "?page=20&search=A%2F42%20&sortKey=receivedAt&sortDirection=ascending",
    { headers: { cookie } },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ ...result, timeZone: "Europe/Madrid" });
  expect(reader.mock.calls[0]![1]).toEqual({
    page: 20,
    search: "A/42 ",
    sortKey: "receivedAt",
    sortDirection: "ascending",
  });
});
it("defaults to the first page and ends an empty or unsupported list", async () => {
  let response = await app.request(path, { headers: { cookie } });
  const empty = { rows: [], total: 0, page: 0, pageSize: 50, timeZone: "Europe/Madrid" };
  expect(await response.json()).toEqual(empty);
  expect(reader.mock.calls[0]![1]).toEqual({
    page: 0,
    search: "",
    sortKey: "",
    sortDirection: "descending",
  });
  const unsupported = new Hono();
  mountReportApi(unsupported, { db: suite.db, cfg: { nodeId }, venueLocale: "en-GB" }, () => {});
  response = await unsupported.request(path, { headers: { cookie } });
  expect(await response.json()).toEqual(empty);
});
it.each([
  ["page", ""],
  ["page", "-1"],
  ["page", "1.5"],
  ["page", "NaN"],
  ["page", "1e2"],
  ["page", "9007199254740992"],
  ["page", "180143985094820"],
  ["sortKey", "source"],
  ["sortDirection", ""],
  ["sortDirection", "sideways"],
  ["offset", "0"],
  ["limit", "50"],
  ["pageSize", "50"],
])("refuses invalid %s=%s before reading", async (field, value) => {
  const response = await app.request(path + "?" + field + "=" + value, { headers: { cookie } });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field } },
  });
  expect(reader).not.toHaveBeenCalled();
});
it.each(["none", "staff"])(
  "requires report.view before reading fiscal records (%s)",
  async (actor) => {
    const response = await app.request(path, {
      headers: actor === "none" ? {} : { cookie: staffCookie },
    });
    expect(response.status).toBe(actor === "none" ? 401 : 403);
    expect(reader).not.toHaveBeenCalled();
  },
);

it("refuses a search beyond the shared 100-character bound before reading", async () => {
  const response = await app.request(path + "?search=" + "x".repeat(101), { headers: { cookie } });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: { code: "management.request_invalid", params: { field: "search" } },
  });
  expect(reader).not.toHaveBeenCalled();
});
it("accepts 100 search characters and preserves trailing word completion", async () => {
  const search = "x".repeat(100) + " ";
  const response = await app.request(path + "?" + new URLSearchParams({ search }), {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  expect(reader.mock.calls[0]![1].search).toBe(search);
});

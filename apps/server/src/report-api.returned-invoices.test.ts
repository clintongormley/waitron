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
      const session = await startManagementSession(tx, { personId: person!.id });
      if (role === "supervisor") cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
      else staffCookie = `${MANAGEMENT_COOKIE}=${session.token}`;
    }
  });
  reader.mockReset().mockResolvedValue([]);
  app = new Hono();
  mountReportApi(
    app,
    { db: suite.db, cfg: { nodeId }, venueLocale: "en-GB", returnedInvoices: reader },
    () => {},
  );
});
it("pages 100 records and keeps the read out of caches", async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ recordId: String(i) }));
  reader.mockResolvedValue(rows);
  const response = await app.request(path + "?offset=200", { headers: { cookie } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    records: rows.slice(0, 100),
    nextOffset: 300,
    timeZone: "Europe/Madrid",
  });
  expect(reader.mock.calls[0]![1]).toEqual({ offset: 200, limit: 101 });
});
it("defaults to the first page and ends an empty or unsupported list", async () => {
  let response = await app.request(path, { headers: { cookie } });
  expect(await response.json()).toEqual({
    records: [],
    nextOffset: null,
    timeZone: "Europe/Madrid",
  });
  expect(reader.mock.calls[0]![1]).toEqual({ offset: 0, limit: 101 });
  const unsupported = new Hono();
  mountReportApi(unsupported, { db: suite.db, cfg: { nodeId }, venueLocale: "en-GB" }, () => {});
  response = await unsupported.request(path, { headers: { cookie } });
  expect(await response.json()).toEqual({
    records: [],
    nextOffset: null,
    timeZone: "Europe/Madrid",
  });
});
it.each(["", "-1", "1.5", "NaN", "1e2", "9007199254740992"])(
  "refuses malformed offsets (%s)",
  async (offset) => {
    const response = await app.request(path + "?offset=" + offset, { headers: { cookie } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "management.request_invalid", params: { field: "offset" } },
    });
    expect(reader).not.toHaveBeenCalled();
  },
);
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

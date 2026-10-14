import { beforeEach, expect, it } from "vitest";
import { invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { TENANT_A, seedTenants } from "../test/fixtures.js";
import { liveSeriesBases } from "./reserved-series.js";
import { validateVenueFiscalFields } from "./venue-fields.js";

const venue = {
  legalName: "Waitron SL",
  seriesCode: "FS",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "FR",
  operationDescription: "Venta en establecimiento",
};

it.each(["seriesCode", "fullSeriesCode", "rectificativeSeriesCode"] as const)(
  "accepts a 21-character %s and refuses 22 before setup",
  (field) => {
    expect(() =>
      validateVenueFiscalFields({ ...venue, [field]: "ABCDEFGHIJKLMNOPQRSTU" }),
    ).not.toThrow();
    expect(() =>
      validateVenueFiscalFields({ ...venue, [field]: "ABCDEFGHIJKLMNOPQRSTUV" }),
    ).toThrow(expect.objectContaining({ code: "setup.request_invalid", params: { field } }));
  },
);

const suite = useVenueDb({ migrations: [...TEST_MIGRATIONS] });
beforeEach(() => seedTenants(suite.db));

it("returns a 21-character live base for allocation", async () => {
  await suite.db.insert(invoiceSeries).values({
    nodeId: TENANT_A.nodeId,
    code: "ABCDEFGHIJKLMNOPQRSTU",
    purpose: "standard",
  });
  expect(await withTransaction(suite.db, (tx) => liveSeriesBases(tx, TENANT_A))).toEqual([
    { code: "ABCDEFGHIJKLMNOPQRSTU", purpose: "standard" },
  ]);
});

it("refuses a 22-character live base before reservation or recovery", async () => {
  await suite.db.insert(invoiceSeries).values({
    nodeId: TENANT_A.nodeId,
    code: "ABCDEFGHIJKLMNOPQRSTUV",
    purpose: "standard",
  });
  await expect(
    withTransaction(suite.db, (tx) => liveSeriesBases(tx, TENANT_A)),
  ).rejects.toMatchObject({
    code: "series.code_too_long",
    params: { code: "ABCDEFGHIJKLMNOPQRSTUV" },
  });
});

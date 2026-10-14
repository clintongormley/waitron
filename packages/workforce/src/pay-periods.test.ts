import { expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import * as api from "./index.js";
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, api.WORKFORCE_MIGRATIONS],
});
it("reads monthly settings when no row has been written", async () => {
  expect(await api.readPayPeriodSettings(suite.db)).toEqual({
    frequency: "monthly",
    anchorDate: null,
  });
});
it.each([
  ["2024-02-29", { start: "2024-02-01", end: "2024-03-01" }],
  ["2026-12-31", { start: "2026-12-01", end: "2027-01-01" }],
])("resolves calendar month for %s", (date, period) => {
  expect(api.resolvePayPeriod({ frequency: "monthly", anchorDate: null }, date)).toEqual(period);
});
it.each([
  ["2026-10-12", { start: "2026-10-12", end: "2026-10-19" }],
  ["2026-10-18", { start: "2026-10-12", end: "2026-10-19" }],
  ["2026-10-19", { start: "2026-10-19", end: "2026-10-26" }],
])("resolves the Monday-start week for %s", (date, period) => {
  expect(api.resolvePayPeriod({ frequency: "weekly", anchorDate: null }, date)).toEqual(period);
});
it.each([
  ["2026-10-11", { start: "2026-09-28", end: "2026-10-12" }],
  ["2026-10-12", { start: "2026-10-12", end: "2026-10-26" }],
  ["2026-10-25", { start: "2026-10-12", end: "2026-10-26" }],
  ["2026-10-26", { start: "2026-10-26", end: "2026-11-09" }],
])("resolves a fortnight on either side of its anchor for %s", (date, period) => {
  expect(
    api.resolvePayPeriod({ frequency: "fortnightly", anchorDate: "2026-10-12" }, date),
  ).toEqual(period);
});
it("replaces one settings row and reads the saved cadence", async () => {
  await withTransaction(suite.db, (tx) =>
    api.setPayPeriodSettings(tx, { frequency: "weekly", anchorDate: null }),
  );
  expect(await api.readPayPeriodSettings(suite.db)).toEqual({
    frequency: "weekly",
    anchorDate: null,
  });
  await withTransaction(suite.db, (tx) =>
    api.setPayPeriodSettings(tx, { frequency: "fortnightly", anchorDate: "2026-10-12" }),
  );
  expect(await suite.db.select().from(api.payPeriodSettings)).toEqual([
    { id: 1, frequency: "fortnightly", anchorDate: "2026-10-12" },
  ]);
});
it.each([
  null,
  {},
  { frequency: null, anchorDate: null },
  { frequency: [], anchorDate: null },
  { frequency: "daily", anchorDate: null },
  { frequency: "monthly", anchorDate: "2026-10-12" },
  { frequency: "weekly", anchorDate: "" },
  { frequency: "fortnightly", anchorDate: null },
  { frequency: "fortnightly", anchorDate: "2026-10-13" },
  { frequency: "fortnightly", anchorDate: "2026-02-30" },
])("refuses malformed settings %j before storing them", async (settings) => {
  const before = await suite.db.select().from(api.payPeriodSettings);
  await expect(
    withTransaction(suite.db, (tx) =>
      api.setPayPeriodSettings(tx, settings as Parameters<typeof api.setPayPeriodSettings>[1]),
    ),
  ).rejects.toMatchObject({ code: "pay_period.invalid" });
  expect(await suite.db.select().from(api.payPeriodSettings)).toEqual(before);
});
it.each(["bad", "2026-02-30", null])("refuses malformed local date %s", (date) => {
  expect(() =>
    api.resolvePayPeriod({ frequency: "monthly", anchorDate: null }, date as string),
  ).toThrow(expect.objectContaining({ code: "pay_period.invalid" }));
});

import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { describe, expect, it } from "vitest";
import { checkTimeHealth, type CommandRunner } from "./time-health.js";

const runnerReturning =
  (stdout: string): CommandRunner =>
  async () => ({ stdout });
const runnerThrowing = (): CommandRunner => async () => {
  const err = new Error("spawn timedatectl ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  throw err;
};

describe("checkTimeHealth", () => {
  it("reports synced when timedatectl says NTPSynchronized=yes", async () => {
    const health = await checkTimeHealth({ run: runnerReturning("yes\n") });
    expect(health).toEqual({ synced: true, source: "timedatectl", warn: false });
  });

  it("warns when timedatectl says NTPSynchronized=no", async () => {
    const health = await checkTimeHealth({ run: runnerReturning("no\n") });
    expect(health).toEqual({ synced: false, source: "timedatectl", warn: true });
  });

  it("degrades to unavailable without warning when timedatectl is absent", async () => {
    const health = await checkTimeHealth({ run: runnerThrowing() });
    expect(health).toEqual({ synced: false, source: "unavailable", warn: false });
  });
});

it("warns from a measured authority comparison without treating missing time as zero drift", async () => {
  const module = await import("./time-health.js");
  const monitor = module.createAuthorityClockStatus?.();
  expect(monitor?.read()).toEqual({ state: "unknown" });
  monitor?.observe({
    authorityTimestamp: "2026-10-05T12:00:00Z",
    sentAt: new Date("2026-10-06T12:00:00Z"),
    receivedAt: new Date("2026-10-06T12:00:00Z"),
  });
  expect(monitor?.read()).toEqual({
    state: "warning",
    driftSeconds: 86400,
    measuredAt: "2026-10-06T12:00:00.000Z",
  });
  monitor?.observe({ authorityTimestamp: null, sentAt: new Date(), receivedAt: new Date() });
  expect(monitor?.read()).toEqual({ state: "unknown" });
});

it.each([
  ["2026-10-05T12:01:00Z", "2026-10-05T12:01:00Z", "ok"],
  ["2026-10-05T11:59:00Z", "2026-10-05T11:59:00Z", "ok"],
  ["2026-10-05T12:01:00.001Z", "2026-10-05T12:01:00.001Z", "warning"],
  ["2026-10-05T11:58:59.999Z", "2026-10-05T11:58:59.999Z", "warning"],
  ["2026-10-05T12:00:00Z", "2026-10-05T12:05:00Z", "unknown"],
])("uses the one-minute boundary and request interval %s to %s", async (sent, received, state) => {
  const module = await import("./time-health.js");
  const monitor = module.createAuthorityClockStatus?.();
  monitor?.observe({
    authorityTimestamp: "2026-10-05T12:00:00Z",
    sentAt: new Date(sent),
    receivedAt: new Date(received),
  });
  expect(monitor?.read().state).toBe(state);
});

it.each([null, "invalid", "2026-10-05T12:00:00", "2026-02-30T12:00:00Z"])(
  "keeps unusable authority time %s unknown",
  async (timestamp) => {
    const module = await import("./time-health.js");
    const monitor = module.createAuthorityClockStatus?.();
    monitor?.observe({ authorityTimestamp: timestamp, sentAt: new Date(), receivedAt: new Date() });
    expect(monitor?.read()).toEqual({ state: "unknown" });
  },
);

it("raises a clock alert only for measured drift and clears it when the source is unavailable", async () => {
  const module = await import("./time-health.js");
  const monitor = module.createAuthorityClockStatus();
  const source = module.authorityClockAlertSource?.(monitor.read);
  expect(await source?.read({} as never)).toEqual([]);
  monitor.observe({
    authorityTimestamp: "2026-10-05T12:00:00Z",
    sentAt: new Date("2026-10-06T12:00:00Z"),
    receivedAt: new Date("2026-10-06T12:00:00Z"),
  });
  expect(await source?.read({} as never)).toEqual([
    {
      key: "fiscal.clock_drift",
      code: "fiscal.clock_drift",
      params: { seconds: 86400 },
      severity: "warning",
      since: "2026-10-06T12:00:00.000Z",
    },
  ]);
  monitor.observe({ authorityTimestamp: null, sentAt: new Date(), receivedAt: new Date() });
  expect(await source?.read({} as never)).toEqual([]);
});

describe("authority clock alerts and sales", () => {
  let venue: BillVenue;
  useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    setup: async (db) => {
      venue = await provisionBillVenue(db);
    },
    timeoutMs: 120_000,
  });

  it("reports administrator drift alongside an independent cash sale", async () => {
    const module = await import("./time-health.js");
    const monitor = module.createAuthorityClockStatus();
    monitor.observe({
      authorityTimestamp: "2026-10-05T12:00:00Z",
      sentAt: new Date("2026-10-06T12:00:00Z"),
      receivedAt: new Date("2026-10-06T12:00:00Z"),
    });
    expect(await module.authorityClockAlertSource(monitor.read).read({} as never)).toEqual([
      {
        key: "fiscal.clock_drift",
        code: "fiscal.clock_drift",
        params: { seconds: 86400 },
        severity: "warning",
        since: "2026-10-06T12:00:00.000Z",
      },
    ]);
    const headers = { cookie: venue.cookie };
    const sale = await venue.app.request("/api/sales", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        zoneId: venue.zoneId,
        lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
        tender: { method: "cash", amount: "3.00" },
      }),
    });
    expect(sale.status, await sale.clone().text()).toBe(200);
    expect(await sale.json()).toMatchObject({ total: "3.00" });
  });
});

it("reports the absolute alert difference for a server behind the authority", async () => {
  const { createAuthorityClockStatus, authorityClockAlertSource } =
    await import("./time-health.js");
  const monitor = createAuthorityClockStatus();
  monitor.observe({
    authorityTimestamp: "2026-10-05T12:00:00Z",
    sentAt: new Date("2026-10-05T11:58:00Z"),
    receivedAt: new Date("2026-10-05T11:58:01Z"),
  });
  expect(monitor.read()).toEqual({
    state: "warning",
    driftSeconds: -119,
    measuredAt: "2026-10-05T11:58:01.000Z",
  });
  expect(await authorityClockAlertSource(monitor.read).read({} as never)).toMatchObject([
    { params: { seconds: 119 } },
  ]);
});

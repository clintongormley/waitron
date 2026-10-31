import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { provisionBillVenue, type BillVenue } from "./testing/bill-venue.js";
import { describe, expect, it } from "vitest";
import type { ClockServiceStatus } from "./box-host-client.js";
import { checkTimeHealth } from "./time-health.js";

const hostAnswering = (synchronised: boolean) => async (): Promise<ClockServiceStatus> => ({
  available: true,
  service: "on",
  unit: "systemd-timesyncd.service",
  synchronised,
  lastSyncAt: null,
});
const hostUnavailable = async (): Promise<ClockServiceStatus> => ({
  available: false,
  reason: "missing",
  detail: "ENOENT",
});

describe("checkTimeHealth", () => {
  it("reports synced when the box's clock service says synchronised", async () => {
    const health = await checkTimeHealth({ status: hostAnswering(true) });
    expect(health).toEqual({ synced: true, source: "timedatectl", warn: false });
  });

  it("warns when the box's clock service says not synchronised", async () => {
    const health = await checkTimeHealth({ status: hostAnswering(false) });
    expect(health).toEqual({ synced: false, source: "timedatectl", warn: true });
  });

  it("degrades to unavailable without warning when the box's clock service does not answer", async () => {
    const health = await checkTimeHealth({ status: hostUnavailable });
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

describe("the drift alert while payments are stopped for the clock", () => {
  async function warningSource(stopped?: (tx: Transaction, now: Date) => Promise<boolean>) {
    const { createAuthorityClockStatus, authorityClockAlertSource } =
      await import("./time-health.js");
    const monitor = createAuthorityClockStatus();
    monitor.observe({
      authorityTimestamp: "2026-10-05T12:00:00Z",
      sentAt: new Date("2026-10-06T12:00:00Z"),
      receivedAt: new Date("2026-10-06T12:00:00Z"),
    });
    return authorityClockAlertSource(monitor.read, stopped);
  }

  const DRIFT = [
    {
      key: "fiscal.clock_drift",
      code: "fiscal.clock_drift",
      params: { seconds: 86400 },
      severity: "warning",
      since: "2026-10-06T12:00:00.000Z",
    },
  ];

  it("is left out while the stop is on, asked with the read's own transaction and time", async () => {
    const asked: unknown[] = [];
    const source = await warningSource(async (tx, now) => {
      asked.push(tx, now);
      return true;
    });
    const tx = { marker: "tx" } as never;
    const now = new Date("2026-10-06T12:30:00Z");
    expect(await source.read({ tx, now })).toEqual([]);
    expect(asked).toEqual([tx, now]);
  });

  it("is raised as before while the stop is off", async () => {
    const source = await warningSource(async () => false);
    expect(await source.read({ tx: {} as never, now: new Date() })).toEqual(DRIFT);
  });

  it("is raised as before when nothing says whether the stop is on", async () => {
    const source = await warningSource();
    expect(await source.read({ tx: {} as never, now: new Date() })).toEqual(DRIFT);
  });

  it("does not ask about the stop while there is no drift to raise", async () => {
    const { createAuthorityClockStatus, authorityClockAlertSource } =
      await import("./time-health.js");
    let asked = 0;
    const source = authorityClockAlertSource(createAuthorityClockStatus().read, async () => {
      asked += 1;
      return true;
    });
    expect(await source.read({ tx: {} as never, now: new Date() })).toEqual([]);
    expect(asked).toBe(0);
  });
});

describe("each kept comparison with AEAT's reply time is handed on as a witness sample", () => {
  it("hands on the timestamp plus 500 ms, half the round trip plus 500 ms, and the midpoint", async () => {
    const { createAuthorityClockStatus } = await import("./time-health.js");
    const samples: unknown[] = [];
    const monitor = createAuthorityClockStatus({
      onSample: (sample) => samples.push(sample),
      monotonic: () => 90_000,
    });
    monitor.observe({
      authorityTimestamp: "2026-10-05T12:00:00Z",
      sentAt: new Date("2026-10-05T12:00:00.000Z"),
      receivedAt: new Date("2026-10-05T12:00:03.000Z"),
    });
    expect(samples).toEqual([
      {
        authorityMs: Date.parse("2026-10-05T12:00:00.500Z"),
        uncertaintyMs: 2_000,
        at: { wallMs: Date.parse("2026-10-05T12:00:01.500Z"), monoMs: 88_500 },
      },
    ]);
  });

  it("hands on nothing for a reply with no timestamp", async () => {
    const { createAuthorityClockStatus } = await import("./time-health.js");
    const samples: unknown[] = [];
    const monitor = createAuthorityClockStatus({ onSample: (sample) => samples.push(sample) });
    monitor.observe({ authorityTimestamp: null, sentAt: new Date(), receivedAt: new Date() });
    expect(samples).toEqual([]);
  });
});

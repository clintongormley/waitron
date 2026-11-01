import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, locations, nodes, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { AppError, locationId } from "@waitron/shared";
import {
  createTrustedClock,
  prepareIssueClock,
  readIssueZone,
  type IssueScope,
  type TrustedClock,
} from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const AT = "2026-10-14T23:30:00.000Z";
let scope: IssueScope;
beforeEach(async () => {
  await seedTenant(suite.db);
  const [row] = await suite.db
    .insert(locations)
    .values({
      name: "Test venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Restaurant service",
      timeZone: "Europe/Madrid",
    })
    .returning();
  scope = { nodeId: await seedNode(suite.db, locationId(row!.id)) };
});
afterEach(() => vi.restoreAllMocks());
const source = (instant = new Date(AT)) =>
  createTrustedClock({
    deviceId: "test",
    wallClock: () => instant.getTime(),
    monotonic: () => 0,
    degradedAfterSeconds: 3600,
  });
const zone = (target = scope) => withTransaction(suite.db, (tx) => readIssueZone(tx, target));
const prepare = (clock: TrustedClock = source()) =>
  withTransaction(suite.db, (tx) => prepareIssueClock(tx, scope, clock));

describe("writing location zone", () => {
  it("uses the writing node when the configured location is omitted", async () => {
    expect(await zone({ nodeId: scope.nodeId })).toBe("Europe/Madrid");
  });
  it.each([
    ["US/Eastern", "America/New_York"],
    ["Europe/London", "Europe/London"],
  ])(
    "accepts supported saved %s independently of country creation policy",
    async (timeZone, expected) => {
      await suite.db.update(locations).set({ timeZone });
      expect(await zone()).toBe(expected);
    },
  );
  it.each([
    ["", "missing"],
    ["  ", "missing"],
    ["Invalid/Zone", "invalid"],
    [" Europe/Madrid", "invalid"],
    ["Europe/Madrid ", "invalid"],
    ["+02:00", "invalid"],
  ])("refuses saved %j before reading the source clock or writing", async (timeZone, reason) => {
    await suite.db.update(locations).set({ timeZone });
    const clock = source();
    const now = vi.spyOn(clock, "now");
    const write = vi.fn();
    await expect(
      withTransaction(suite.db, async (tx) => {
        await prepareIssueClock(tx, scope, clock);
        write();
      }),
    ).rejects.toMatchObject({ code: "venue.time_zone_invalid", params: { reason } });
    expect(now).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it.each(["node"] as const)("refuses target %s independently of zone validity", async (reason) => {
    const target = { ...scope, nodeId: randomUUID() };
    await expect(zone(target)).rejects.toMatchObject({
      code: "venue.time_zone_target_invalid",
      params: { reason },
    });
  });
  it("reads the venue's zone whatever the node's location column holds", async () => {
    await suite.db.execute(sql`pragma foreign_keys = off`);
    try {
      await suite.db
        .update(nodes)
        .set({ locationId: randomUUID() })
        .where(eq(nodes.id, scope.nodeId));
      expect(await zone({ nodeId: scope.nodeId })).toBe("Europe/Madrid");
    } finally {
      await suite.db.execute(sql`pragma foreign_keys = on`);
    }
  });
  it("propagates unexpected zone-name runtime faults", async () => {
    const fault = new Error("runtime unavailable");
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      throw fault;
    });
    await expect(zone()).rejects.toBe(fault);
  });
});

describe("prepared issue reading", () => {
  it("freezes one copied reading with the saved zone offset and original confidence", async () => {
    const clock = source();
    const warning = new AppError("clock.degraded", { deviceId: "test", anchorAgeSeconds: 3601 });
    const reading = {
      instant: new Date(AT),
      offsetMinutes: 0,
      confident: false,
      confidence: "degraded" as const,
      anchorAgeSeconds: 3601,
      warning,
    };
    const now = vi.spyOn(clock, "now").mockReturnValue(reading);
    const prepared = await prepare(clock);
    const first = prepared.now();
    expect(first).toEqual({ ...reading, instant: new Date(AT), offsetMinutes: 120 });
    expect(first.warning).toBe(warning);
    reading.instant.setUTCFullYear(2000);
    reading.offsetMinutes = -480;
    first.instant.setUTCFullYear(1990);
    first.offsetMinutes = -300;
    expect(prepared.now()).toEqual({
      instant: new Date(AT),
      offsetMinutes: 120,
      confident: false,
      confidence: "degraded",
      anchorAgeSeconds: 3601,
      warning,
    });
    expect(now).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["2026-03-29T00:30:00.000Z", 60],
    ["2026-03-29T01:30:00.000Z", 120],
    ["2026-10-25T00:30:00.000Z", 120],
    ["2026-10-25T01:30:00.000Z", 60],
  ])("converts at each issuance instant %s", async (instant, offsetMinutes) => {
    expect((await prepare(source(new Date(instant)))).now()).toMatchObject({
      instant: new Date(instant),
      offsetMinutes,
    });
  });
  it("reads a newly committed zone for the next preparation while retaining the old frozen reading", async () => {
    const first = await prepare();
    await suite.db.update(locations).set({ timeZone: "Atlantic/Canary" });
    expect((await prepare()).now().offsetMinutes).toBe(60);
    expect(first.now().offsetMinutes).toBe(120);
  });
  it("delegates anchors to the source without changing the frozen issue reading", async () => {
    const clock = source();
    const prepared = await prepare(clock);
    const anchor = prepared.anchor({
      instant: new Date("2026-12-01T00:00:00.000Z"),
      offsetMinutes: -300,
      source: "authority",
    });
    expect(clock.currentAnchor()).toEqual(anchor);
    expect(prepared.currentAnchor()).toEqual(anchor);
    expect(prepared.now()).toMatchObject({
      instant: new Date(AT),
      offsetMinutes: 120,
      confidence: "unanchored",
    });
  });
  it("refuses an invalid instant before the caller can write", async () => {
    const write = vi.fn();
    await expect(
      withTransaction(suite.db, async (tx) => {
        await prepareIssueClock(tx, scope, source(new Date(NaN)));
        write();
      }),
    ).rejects.toMatchObject({
      code: "venue.time_zone_conversion_failed",
      params: { reason: "invalid_instant" },
    });
    expect(write).not.toHaveBeenCalled();
  });
  it("reports unreadable offset separately from repair eligibility", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockReturnValue([]);
    await expect(prepare()).rejects.toMatchObject({
      code: "venue.time_zone_conversion_failed",
      params: { reason: "unreadable_offset" },
    });
  });
  it("propagates formatter faults without granting repair", async () => {
    const fault = new Error("formatter failed");
    vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts").mockImplementation(() => {
      throw fault;
    });
    await expect(prepare()).rejects.toBe(fault);
  });
});

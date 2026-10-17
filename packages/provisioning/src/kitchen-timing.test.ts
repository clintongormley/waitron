import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import {
  kitchenStations,
  kitchenStationTiming,
  kitchenTimingDefaults,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { enabledModules } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { eq } from "drizzle-orm";
import { request } from "../test/first-setup-request.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue } from "./venue-plan.js";
import { venueFiscalSelection } from "./venue-fiscal.js";
import {
  assertStationTiming,
  getKitchenTimingDefaults,
  parseStationTimingPatch,
  setKitchenTimingDefaults,
} from "./kitchen-timing.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const defaults = { warmAfterMinutes: 3, overdueAfterMinutes: 7, forgottenAfterMinutes: 12 };
const fields = ["warmAfterMinutes", "overdueAfterMinutes", "forgottenAfterMinutes"] as const;

async function fixture() {
  const modules = enabledModules(ALL_MODULES, venueFiscalSelection(ALL_MODULES, "GB-vat").config);
  const result = await applyVenue(
    planVenue(
      {
        ...request,
        country: "GB",
        taxId: "123456789",
        location: { ...request.location, fiscalTerritory: "GB-vat", timeZone: "Europe/London" },
        admin: {
          displayName: "Owner",
          email: "owner@example.test",
          pinHash: "synthetic-pin",
          passwordHash: "synthetic-password",
        },
      },
      modules,
    ),
    { db: suite.db, modules },
  );
  return { locationId: locationId(result.locationId) };
}

it("retains omitted fields and distinguishes null inheritance from explicit values", () => {
  expect(parseStationTimingPatch({})).toEqual({});
  expect(
    parseStationTimingPatch({ warmAfterMinutes: null, overdueAfterMinutes: 9, ignored: true }),
  ).toEqual({ warmAfterMinutes: null, overdueAfterMinutes: 9 });
  expect(parseStationTimingPatch({ forgottenAfterMinutes: 2_147_483_647 })).toEqual({
    forgottenAfterMinutes: 2_147_483_647,
  });
});

it.each(
  fields.flatMap((field) =>
    [0, -1, 1.5, "3", [], true, NaN, Infinity, 2_147_483_648].map((value) => ({ field, value })),
  ),
)("refuses an invalid $field override: $value", ({ field, value }) => {
  expect(() => parseStationTimingPatch({ [field]: value })).toThrow(
    expect.objectContaining({ code: "management.request_invalid", params: { field } }),
  );
});

it("names the station and effective field that becomes invalid after inheritance", () => {
  expect(() =>
    assertStationTiming({ warmAfterMinutes: 7 }, defaults, { id: "station", name: "Grill" }),
  ).toThrow(
    expect.objectContaining({
      code: "station.thresholds_invalid",
      params: { field: "overdueAfterMinutes", stationId: "station", name: "Grill" },
    }),
  );
  expect(() =>
    assertStationTiming({ overdueAfterMinutes: 12 }, defaults, { name: "Grill" }),
  ).toThrow(
    expect.objectContaining({
      code: "station.thresholds_invalid",
      params: { field: "forgottenAfterMinutes", name: "Grill" },
    }),
  );
  expect(() => assertStationTiming({ warmAfterMinutes: 0 }, defaults, { name: "Grill" })).toThrow(
    expect.objectContaining({
      code: "station.thresholds_invalid",
      params: { field: "warmAfterMinutes", name: "Grill" },
    }),
  );
  expect(() =>
    assertStationTiming({ warmAfterMinutes: null }, defaults, { name: "Grill" }),
  ).not.toThrow();
});

it.each([
  null,
  [],
  "3",
  {},
  { ...defaults, overdueAfterMinutes: 3 },
  { ...defaults, forgottenAfterMinutes: 7 },
  ...fields.flatMap((field) =>
    [null, 0, 1.5, 2_147_483_648].map((value) => ({ ...defaults, [field]: value })),
  ),
])("refuses malformed or unordered venue defaults before writing: %j", async (input) => {
  const cfg = await fixture();
  const before = await withTransaction(suite.db, (tx) => getKitchenTimingDefaults(tx, cfg));
  await expect(
    withTransaction(suite.db, (tx) => setKitchenTimingDefaults(tx, cfg, input)),
  ).rejects.toMatchObject({ code: "management.request_invalid" });
  expect(await withTransaction(suite.db, (tx) => getKitchenTimingDefaults(tx, cfg))).toEqual(
    before,
  );
});

it("writes venue defaults without replacing a station's nullable overrides", async () => {
  const cfg = await fixture();
  const stationId = randomUUID();
  await withTransaction(suite.db, async (tx) => {
    await tx
      .insert(kitchenStations)
      .values({ id: stationId, locationId: cfg.locationId, name: "Grill" });
    await tx.insert(kitchenStationTiming).values({
      stationId,
      warmAfterMinutes: 2,
      overdueAfterMinutes: null,
      forgottenAfterMinutes: 20,
    });
    await setKitchenTimingDefaults(tx, cfg, defaults);
  });
  expect(await withTransaction(suite.db, (tx) => getKitchenTimingDefaults(tx, cfg))).toEqual(
    defaults,
  );
  expect(
    await suite.db
      .select()
      .from(kitchenStationTiming)
      .where(eq(kitchenStationTiming.stationId, stationId)),
  ).toEqual([
    { stationId, warmAfterMinutes: 2, overdueAfterMinutes: null, forgottenAfterMinutes: 20 },
  ]);
});

it("refuses a default edit that makes an inactive station invalid and leaves the old defaults intact", async () => {
  const cfg = await fixture();
  const stationId = randomUUID();
  await withTransaction(suite.db, async (tx) => {
    await tx
      .insert(kitchenStations)
      .values({ id: stationId, locationId: cfg.locationId, name: "Old grill", active: false });
    await tx.insert(kitchenStationTiming).values({ stationId, warmAfterMinutes: 9 });
  });
  const before = await withTransaction(suite.db, (tx) => getKitchenTimingDefaults(tx, cfg));
  await expect(
    withTransaction(suite.db, (tx) => setKitchenTimingDefaults(tx, cfg, defaults)),
  ).rejects.toMatchObject({
    code: "station.thresholds_invalid",
    params: { field: "overdueAfterMinutes", stationId, name: "Old grill" },
  });
  expect(await withTransaction(suite.db, (tx) => getKitchenTimingDefaults(tx, cfg))).toEqual(
    before,
  );
});

it("never invents missing defaults during a read or write", async () => {
  const cfg = await fixture();
  await suite.db
    .delete(kitchenTimingDefaults)
    .where(eq(kitchenTimingDefaults.locationId, cfg.locationId));
  await expect(
    withTransaction(suite.db, (tx) => getKitchenTimingDefaults(tx, cfg)),
  ).rejects.toMatchObject({
    code: "station.timing_missing",
    params: { locationId: cfg.locationId },
  });
  await expect(
    withTransaction(suite.db, (tx) => setKitchenTimingDefaults(tx, cfg, defaults)),
  ).rejects.toMatchObject({
    code: "station.timing_missing",
    params: { locationId: cfg.locationId },
  });
  expect(await suite.db.select().from(kitchenTimingDefaults)).toEqual([]);
});

import { STATION_COLOURS } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import {
  CORE_CONFIGURATION_TRANSFER,
  validateCoreConfiguration,
} from "./configuration-transfer.js";

const stationRefusal = expect.objectContaining({
  code: "setup.request_invalid",
  params: { field: "kitchen_stations.colour" },
});

describe("validateCoreConfiguration", () => {
  it.each([
    null,
    1,
    [],
    "{not json",
    "null",
    "{}",
    '"receipt"',
    "[null]",
    '[["receipt"]]',
    '["cash_drawer"]',
  ])("refuses malformed printer pick-up roles %j", (pickup_roles) => {
    expect(() => validateCoreConfiguration({ printers: [{ pickup_roles }] })).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "printers.pickup_roles" },
      }),
    );
  });

  it.each(["[]", '["receipt"]', '["payment_slip"]', '["payment_slip","receipt"]'])(
    "accepts a stored printer pick-up set %s",
    (pickup_roles) => {
      expect(() => validateCoreConfiguration({ printers: [{ pickup_roles }] })).not.toThrow();
    },
  );

  it("refuses a station colour a save would refuse", () => {
    expect(() =>
      validateCoreConfiguration({ kitchen_stations: [{ colour: "invalid-colour" }] }),
    ).toThrowError(stationRefusal);
  });

  it("A725 accepts an absent station colour for allocation during import", () => {
    expect(() => validateCoreConfiguration({ kitchen_stations: [{}] })).not.toThrow();
  });

  it.each([null, [], {}, 1, false])(
    "A725 refuses an explicit invalid station colour %j",
    (colour) => {
      expect(() => validateCoreConfiguration({ kitchen_stations: [{ colour }] })).toThrowError(
        stationRefusal,
      );
    },
  );

  it("accepts each station colour", () => {
    expect(() =>
      validateCoreConfiguration({
        kitchen_stations: STATION_COLOURS.map((colour) => ({ colour })),
      }),
    ).not.toThrow();
  });

  it("accepts an empty bundle", () => {
    expect(() => validateCoreConfiguration({})).not.toThrow();
  });

  it("refuses a printer row marked deleted, which the exporter never sends", () => {
    expect(() =>
      validateCoreConfiguration({
        printers: [
          { id: "p1", deleted_at: null },
          { id: "p2", deleted_at: "2026-10-10T10:00:00.000Z" },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "setup.request_invalid",
        params: { field: "printers.deleted_at" },
      }),
    );
  });

  it("accepts printer rows whose deleted mark is null or absent", () => {
    expect(() =>
      validateCoreConfiguration({ printers: [{ id: "p1", deleted_at: null }, { id: "p2" }] }),
    ).not.toThrow();
  });

  it.each(["kitchen_courses", "kitchen_stations"])(
    "refuses a deleted %s configuration row without refusing archived products",
    (table) => {
      expect(() =>
        validateCoreConfiguration({ [table]: [{ id: "old", active: 0, colour: "red" }] }),
      ).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: `${table}.active` },
        }),
      );
      expect(() =>
        validateCoreConfiguration({
          [table]: [{ id: "live", active: 1, colour: "red" }],
          products: [{ id: "archived", active: 0 }],
        }),
      ).not.toThrow();
    },
  );

  it("is the core transfer's validate", () => {
    expect(validateCoreConfiguration).toBeTypeOf("function");
    expect(CORE_CONFIGURATION_TRANSFER.validate).toBe(validateCoreConfiguration);
  });
});

describe("CORE_CONFIGURATION_TRANSFER", () => {
  it("carries no venue-made statuses", () => {
    expect(CORE_CONFIGURATION_TRANSFER.tables.map((t) => t.name)).not.toContain(
      "table_service_statuses",
    );
  });

  it("leaves a deleted printer behind and never carries its poll credential", () => {
    expect(CORE_CONFIGURATION_TRANSFER.tables.find((table) => table.name === "printers")).toEqual({
      name: "printers",
      locationColumns: ["location_id"],
      omit: ["poll_token_hash"],
      reconnect: true,
      leaveBehindWhenSet: "deleted_at",
    });
  });
});

it.each([0, false])("refuses a deleted floor zone with active=%j", (active) => {
  expect(() => validateCoreConfiguration({ floor_zones: [{ id: "old", active }] })).toThrowError(
    expect.objectContaining({
      code: "setup.request_invalid",
      params: { field: "floor_zones.active" },
    }),
  );
  expect(() =>
    validateCoreConfiguration({ floor_zones: [{ id: "live", active: 1 }] }),
  ).not.toThrow();
});

it("accepts the shared grey station colour for import", () => {
  expect(() => validateCoreConfiguration({ kitchen_stations: [{ colour: "grey" }] })).not.toThrow();
});

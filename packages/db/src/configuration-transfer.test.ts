import {
  BUMP_MODES,
  CHANGES_AFTER_SENDING,
  STATION_COLOURS,
  TICKET_GROUPINGS,
} from "@waitron/shared";
import { describe, expect, it } from "vitest";
import {
  CORE_CONFIGURATION_TRANSFER,
  validateCoreConfiguration,
} from "./configuration-transfer.js";
import { storeTableShortNameKeys } from "./table-short-names.js";

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

  it.each(["bogus", "Combined", null, 1])(
    "refuses a station ticket grouping a save would refuse %j",
    (ticket_grouping) => {
      expect(() =>
        validateCoreConfiguration({ kitchen_stations: [{ ticket_grouping }] }),
      ).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: "kitchen_stations.ticket_grouping" },
        }),
      );
    },
  );

  it("accepts an absent station ticket grouping", () => {
    expect(() => validateCoreConfiguration({ kitchen_stations: [{}] })).not.toThrow();
  });

  it("accepts each station ticket grouping", () => {
    expect(() =>
      validateCoreConfiguration({
        kitchen_stations: TICKET_GROUPINGS.map((ticket_grouping) => ({ ticket_grouping })),
      }),
    ).not.toThrow();
  });

  it.each(["bogus", "Ticket", null, 1])(
    "refuses a station bump mode a save would refuse %j",
    (bump_mode) => {
      expect(() => validateCoreConfiguration({ kitchen_stations: [{ bump_mode }] })).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: "kitchen_stations.bump_mode" },
        }),
      );
    },
  );

  it("accepts an absent station bump mode", () => {
    expect(() => validateCoreConfiguration({ kitchen_stations: [{}] })).not.toThrow();
  });

  it("accepts each station bump mode", () => {
    expect(() =>
      validateCoreConfiguration({
        kitchen_stations: BUMP_MODES.map((bump_mode) => ({ bump_mode })),
      }),
    ).not.toThrow();
  });

  it.each(["bogus", "Held", null, 1])(
    "refuses a station's changes after sending a save would refuse %j",
    (changes_after_sending) => {
      expect(() =>
        validateCoreConfiguration({ kitchen_stations: [{ changes_after_sending }] }),
      ).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: "kitchen_stations.changes_after_sending" },
        }),
      );
    },
  );

  it("accepts an absent station changes after sending", () => {
    expect(() => validateCoreConfiguration({ kitchen_stations: [{}] })).not.toThrow();
  });

  it("accepts each station changes after sending", () => {
    expect(() =>
      validateCoreConfiguration({
        kitchen_stations: CHANGES_AFTER_SENDING.map((changes_after_sending) => ({
          changes_after_sending,
        })),
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

  describe.each(["dining_tables", "floor_plan_tables"])("%s short names", (table) => {
    it.each(["", "ABCDEF", 5])(
      "refuses a table short name that is blank, too long or not text: %j",
      (short_name) => {
        expect(() => validateCoreConfiguration({ [table]: [{ short_name }] })).toThrowError(
          expect.objectContaining({
            code: "setup.request_invalid",
            params: { field: `${table}.short_name` },
          }),
        );
      },
    );

    it("refuses a short name of spaces", () => {
      expect(() => validateCoreConfiguration({ [table]: [{ short_name: "  " }] })).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: `${table}.short_name` },
        }),
      );
    });

    it.each(["\u0020T1\u0020", "\u00a0T1"])(
      "refuses a short name with spaces around it, %j",
      (short_name) => {
        expect(() => validateCoreConfiguration({ [table]: [{ short_name }] })).toThrowError(
          expect.objectContaining({
            code: "setup.request_invalid",
            params: { field: `${table}.short_name` },
          }),
        );
      },
    );

    it("accepts a short name that is null or absent, or five characters", () => {
      expect(() =>
        validateCoreConfiguration({
          [table]: [{ short_name: null }, {}, { short_name: "ABCDÉ" }],
        }),
      ).not.toThrow();
    });

    it("refuses two tables whose short names differ only in case", () => {
      expect(() =>
        validateCoreConfiguration({ [table]: [{ short_name: "T1" }, { short_name: "t1" }] }),
      ).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: `${table}.short_name` },
        }),
      );
    });
  });

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

  it("carries a table's short name but never its key, which the import sets", () => {
    expect(
      CORE_CONFIGURATION_TRANSFER.tables.find((table) => table.name === "dining_tables"),
    ).toEqual({
      name: "dining_tables",
      locationColumns: ["location_id"],
      omit: ["needs_clearing_since", "short_name_key"],
    });
    expect(CORE_CONFIGURATION_TRANSFER.afterImport).toBe(storeTableShortNameKeys);
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

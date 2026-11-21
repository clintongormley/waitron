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

const stationRefusal = expect.objectContaining({
  code: "setup.request_invalid",
  params: { field: "kitchen_stations.colour" },
});

describe("validateCoreConfiguration", () => {
  describe("profile printer lists", () => {
    const printers = [
      { id: "bar", kind: "receipt" },
      { id: "office", kind: "a4" },
    ];

    it.each([
      ["a non-text column", {}],
      ["invalid JSON", "{"],
      ["null instead of lists", "null"],
      ["an array instead of lists", "[]"],
      ["an unknown role", '{"office":{"ids":[],"defaultId":null}}'],
      ["a null role", '{"receipt":null}'],
      ["a scalar role", '{"receipt":true}'],
      ["an array role", '{"receipt":[]}'],
      ["an absent list", '{"receipt":{"defaultId":null}}'],
      ["a non-string id", '{"receipt":{"ids":[1],"defaultId":null}}'],
      ["an unknown id", '{"receipt":{"ids":["old"],"defaultId":null}}'],
      ["a repeated id", '{"receipt":{"ids":["bar","bar"],"defaultId":null}}'],
      ["an office printer for receipts", '{"receipt":{"ids":["office"],"defaultId":null}}'],
      ["a default outside its list", '{"receipt":{"ids":[],"defaultId":"bar"}}'],
    ])("refuses %s", (_description, printer_lists) => {
      expect(() =>
        validateCoreConfiguration({ printers, device_profiles: [{ printer_lists }] }),
      ).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: "device_profiles.printer_lists" },
        }),
      );
    });

    it("accepts a printer shared by roles and an office printer for invoices", () => {
      const printer_lists = JSON.stringify({
        receipt: { ids: ["bar"], defaultId: null },
        invoice: { ids: ["bar", "office"], defaultId: "office" },
      });
      expect(() =>
        validateCoreConfiguration({ printers, device_profiles: [{}, { printer_lists }] }),
      ).not.toThrow();
    });
  });

  describe("profile kitchen views", () => {
    const station = { stationIds: null, zoneIds: null };
    const pass = { stationIds: ["grill"], zoneIds: ["dining"], showNonPassStations: false };

    function validateViews(...values: unknown[]) {
      validateCoreConfiguration({
        device_profiles: values.map((kitchen_views) => ({ kitchen_views })),
        kitchen_stations: [{ id: "grill" }],
        floor_zones: [{ id: "dining" }],
      });
    }

    it("accepts no view and one view on each of several profiles", () => {
      expect(() =>
        validateViews(undefined, "{}", JSON.stringify({ station }), JSON.stringify({ pass })),
      ).not.toThrow();
    });

    it.each([
      ["a non-text column", {}],
      ["invalid JSON", "{"],
      ["an array instead of views", "[]"],
      ["two views", JSON.stringify({ station, pass })],
      ["an unknown kind", JSON.stringify({ floor: station })],
      ["a scalar view", JSON.stringify({ station: false })],
      ["zones on a station view", JSON.stringify({ station: { ...station, zoneIds: ["dining"] } })],
      [
        "a station from the wrong table",
        JSON.stringify({ pass: { ...pass, stationIds: ["dining"] } }),
      ],
      ["a zone from the wrong table", JSON.stringify({ pass: { ...pass, zoneIds: ["grill"] } })],
      ["a repeated station", JSON.stringify({ pass: { ...pass, stationIds: ["grill", "grill"] } })],
      ["a null display choice", JSON.stringify({ pass: { ...pass, showNonPassStations: null } })],
      [
        "a display choice on a station view",
        JSON.stringify({ station: { ...station, showNonPassStations: false } }),
      ],
    ])("refuses %s", (_label, views) => {
      expect(() => validateViews(views)).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: "device_profiles.kitchen_views" },
        }),
      );
    });
  });

  describe.each(["picks_up_receipts", "picks_up_payment_slips"])("%s", (field) => {
    it.each([[null], [-1], [2], [0.5], ["1"], [true], [[]], [{}]])(
      "refuses a malformed flag %j",
      (value) => {
        expect(() => validateCoreConfiguration({ printers: [{ [field]: value }] })).toThrowError(
          expect.objectContaining({
            code: "setup.request_invalid",
            params: { field: `printers.${field}` },
          }),
        );
      },
    );

    it.each([undefined, 0, 1])("accepts a missing or binary flag %j", (value) => {
      const row = value === undefined ? {} : { [field]: value };
      expect(() => validateCoreConfiguration({ printers: [row] })).not.toThrow();
    });
  });

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

  it.each([null, true, "1", 2, -1])(
    "A773 station policy: refuses an imported waits_for_pass of %j",
    (waits_for_pass) => {
      expect(() =>
        validateCoreConfiguration({ kitchen_stations: [{ waits_for_pass }] }),
      ).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: "kitchen_stations.waits_for_pass" },
        }),
      );
    },
  );

  it("A773 station policy: accepts 0, 1 and an absent waits_for_pass", () => {
    expect(() =>
      validateCoreConfiguration({
        kitchen_stations: [{ waits_for_pass: 0 }, { waits_for_pass: 1 }, {}],
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

    it("refuses a short name holding +, which marks tables joined for the day", () => {
      expect(() => validateCoreConfiguration({ [table]: [{ short_name: "T1+T2" }] })).toThrowError(
        expect.objectContaining({
          code: "setup.request_invalid",
          params: { field: `${table}.short_name` },
        }),
      );
    });

    it.each([{ label: "4+5", short_name: null }, { label: "4+5" }])(
      "refuses a table whose name holds + and has no short name, since the till shows its name: %j",
      (row) => {
        expect(() => validateCoreConfiguration({ [table]: [row] })).toThrowError(
          expect.objectContaining({
            code: "setup.request_invalid",
            params: { field: `${table}.short_name` },
          }),
        );
      },
    );

    it("accepts a table whose name holds + when it has a short name without one", () => {
      expect(() =>
        validateCoreConfiguration({ [table]: [{ label: "4+5", short_name: "4 5" }] }),
      ).not.toThrow();
    });

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
      omit: [
        "needs_clearing_since",
        "short_name_key",
        "on_floor",
        "today_seats",
        "today_fixed",
        "today_x",
        "today_y",
        "today_width",
        "today_height",
        "today_shape",
        "today_rotation",
        "taken_off",
        "today_name",
        "merge_id",
        "merge_before_x",
        "merge_before_y",
        "merge_before_rotation",
      ],
    });
  });

  it("A773 station policy: a station's pass waiting is carried", () => {
    expect(
      CORE_CONFIGURATION_TRANSFER.tables.find((table) => table.name === "kitchen_stations"),
    ).toEqual({
      name: "kitchen_stations",
      jsonReferences: [{ column: "printer_ids", paths: [["*"]] }],
      omit: ["closed_on_day", "closed_sends_to_station_id"],
      leaveBehindWhenFalse: "active",
    });
  });

  it("leaves deleted printers, poll credentials, portable holds and agent bindings behind", () => {
    expect(CORE_CONFIGURATION_TRANSFER.tables.find((table) => table.name === "printers")).toEqual({
      name: "printers",
      omit: ["poll_token_hash", "held_by_device_id", "held_at", "agent_id"],
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

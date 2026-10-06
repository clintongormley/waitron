import { describe, expect, it } from "vitest";
import { getCountryPack } from "@waitron/country-packs";
import {
  chooseMaker,
  chooseExtraMaker,
  closedSendsTo,
  followFallbacks,
  folderAncestors,
  stationStatus,
  unreachableExceptions,
  type RouteTarget,
  type RoutingMoment,
  type RoutingRules,
  type StationTiming,
} from "./routing.js";

const station = (stationId: string) => ({ kind: "station" as const, stationId });
const parentOf = new Map<string, string | null>([
  ["drinks", null],
  ["cocktails", "drinks"],
  ["beer", "drinks"],
  ["food", null],
]);
const base: RoutingRules = {
  exceptions: [],
  claims: new Map([
    ["drinks", station("bar")],
    ["cocktails", station("cocktailBar")],
  ]),
  parentOf,
  activeStationIds: new Set(["bar", "cocktailBar", "mainBar", "terraceBar", "kitchen"]),
  defaultStationId: "kitchen",
  timing: new Map(),
};
const mojito = { productId: "mojito", routedProductId: "mojito", categoryId: "cocktails" };
const lager = { productId: "lager", routedProductId: "lager", categoryId: "beer" };
const bread = { productId: "bread", routedProductId: "bread", categoryId: null };

describe("chooseMaker", () => {
  it("gives the nearest claimed folder, and an unclaimed subfolder its parent's claim", () => {
    expect(chooseMaker(base, mojito, null, null)).toEqual({
      route: station("cocktailBar"),
      decidedBy: { kind: "claim", categoryId: "cocktails" },
      fallbacks: [],
      noReplacement: false,
    });
    expect(chooseMaker(base, lager, "indoors", null).decidedBy).toEqual({
      kind: "claim",
      categoryId: "drinks",
    });
    expect(chooseMaker(base, bread, "indoors", null)).toEqual({
      route: station("kitchen"),
      decidedBy: { kind: "default" },
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("tries exceptions first, in position order, and the first match wins", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        {
          id: "e2",
          position: 2,
          zoneId: "terrace",
          categoryId: "drinks",
          productId: null,
          target: station("terraceBar"),
        },
        {
          id: "e1",
          position: 1,
          zoneId: "terrace",
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
      ],
    };
    expect(chooseMaker(rules, mojito, "terrace", null).route).toEqual(station("mainBar"));
    expect(chooseMaker(rules, lager, "terrace", null).route).toEqual(station("terraceBar"));
    expect(chooseMaker(rules, mojito, "indoors", null).decidedBy).toEqual({
      kind: "claim",
      categoryId: "cocktails",
    });
    expect(chooseMaker(rules, mojito, null, null).decidedBy).toEqual({
      kind: "claim",
      categoryId: "cocktails",
    });
  });

  it("matches an exception with no zone on any order, and one naming a product on its variants", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        {
          id: "e1",
          position: 1,
          zoneId: null,
          categoryId: null,
          productId: "lager",
          target: { kind: "no_preparation" },
        },
      ],
    };
    const lagerPint = { productId: "lager-pint", routedProductId: "lager", categoryId: "beer" };
    expect(chooseMaker(rules, lagerPint, null, null)).toEqual({
      route: { kind: "no_preparation" },
      decidedBy: { kind: "exception", exceptionId: "e1" },
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("routes by the category the facts carry, not by the routed product's", () => {
    const mocktail = { productId: "virgin", routedProductId: "mojito", categoryId: "food" };
    expect(chooseMaker(base, mocktail, null, null).decidedBy).toEqual({ kind: "default" });
  });

  it("follows a switched-off station's fallback", () => {
    const rules = {
      ...base,
      activeStationIds: new Set(["bar", "mainBar", "kitchen"]),
      timing: new Map([["cocktailBar", { fallbackId: "mainBar", hours: [], today: null }]]),
    };
    expect(chooseMaker(rules, mojito, null, null)).toEqual({
      route: station("mainBar"),
      decidedBy: { kind: "claim", categoryId: "cocktails" },
      fallbacks: [{ stationId: "cocktailBar", why: "switched_off" }],
      noReplacement: false,
    });
    expect(chooseMaker({ ...rules, timing: new Map() }, mojito, null, null)).toEqual({
      route: null,
      decidedBy: { kind: "claim", categoryId: "cocktails" },
      fallbacks: [{ stationId: "cocktailBar", why: "switched_off" }],
      noReplacement: true,
    });
  });

  it("never walks a no-preparation target", () => {
    const rules = { ...base, claims: new Map([["drinks", { kind: "no_preparation" as const }]]) };
    expect(chooseMaker(rules, lager, null, null).route).toEqual({ kind: "no_preparation" });
  });

  it("returns no route when nothing matches and there is no active default", () => {
    expect(chooseMaker({ ...base, defaultStationId: null }, bread, null, null)).toEqual({
      route: null,
      decidedBy: null,
      fallbacks: [],
      noReplacement: false,
    });
  });
});

describe("folderAncestors", () => {
  it("walks up to the top, and stops at a loop", () => {
    expect(folderAncestors(parentOf, "cocktails")).toEqual(["cocktails", "drinks"]);
    expect(folderAncestors(parentOf, null)).toEqual([]);
    const loop = new Map<string, string | null>([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(folderAncestors(loop, "a")).toEqual(["a", "b"]);
  });
});

describe("unreachableExceptions", () => {
  it("flags an exception an earlier, wider one always catches", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        {
          id: "wide",
          position: 1,
          zoneId: "terrace",
          categoryId: "drinks",
          productId: null,
          target: station("terraceBar"),
        },
        {
          id: "narrow",
          position: 2,
          zoneId: "terrace",
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
        {
          id: "other-zone",
          position: 3,
          zoneId: "indoors",
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
        {
          id: "any-zone",
          position: 4,
          zoneId: null,
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set(["narrow"]));
  });

  it("flags a duplicate product exception, and everything after a catch-all for its zone", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        {
          id: "all-terrace",
          position: 1,
          zoneId: "terrace",
          categoryId: null,
          productId: null,
          target: station("terraceBar"),
        },
        {
          id: "p1",
          position: 2,
          zoneId: "terrace",
          categoryId: null,
          productId: "lager",
          target: station("bar"),
        },
        {
          id: "p2",
          position: 3,
          zoneId: null,
          categoryId: null,
          productId: "lager",
          target: station("bar"),
        },
        {
          id: "p3",
          position: 4,
          zoneId: null,
          categoryId: null,
          productId: "lager",
          target: station("mainBar"),
        },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set(["p1", "p3"]));
  });

  it("flags an exception behind one whose station is switched off", () => {
    const rules: RoutingRules = {
      ...base,
      activeStationIds: new Set(["bar", "mainBar", "kitchen"]),
      exceptions: [
        {
          id: "off",
          position: 1,
          zoneId: "terrace",
          categoryId: "drinks",
          productId: null,
          target: station("terraceBar"),
        },
        {
          id: "on",
          position: 2,
          zoneId: "terrace",
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set(["on"]));
  });
});

describe("the design's terrace example, written in the wrong order", () => {
  it("flags the cocktails exception and sends a terrace mojito to the terrace bar", () => {
    const rules: RoutingRules = {
      ...base,
      exceptions: [
        {
          id: "drinks",
          position: 1,
          zoneId: "terrace",
          categoryId: "drinks",
          productId: null,
          target: station("terraceBar"),
        },
        {
          id: "cocktails",
          position: 2,
          zoneId: "terrace",
          categoryId: "cocktails",
          productId: null,
          target: station("mainBar"),
        },
      ],
    };
    expect(unreachableExceptions(rules)).toEqual(new Set(["cocktails"]));
    expect(chooseMaker(rules, mojito, "terrace", null).route).toEqual(station("terraceBar"));
  });
});

describe("routing edge cases", () => {
  it("breaks equal positions by id without changing the supplied exceptions", () => {
    const exceptions = [
      {
        id: "z",
        position: 1,
        zoneId: null,
        categoryId: null,
        productId: null,
        target: station("bar"),
      },
      {
        id: "a",
        position: 1,
        zoneId: null,
        categoryId: null,
        productId: null,
        target: station("mainBar"),
      },
    ];
    const rules = { ...base, exceptions };
    expect(chooseMaker(rules, bread, null, null).decidedBy).toEqual({
      kind: "exception",
      exceptionId: "a",
    });
    expect(unreachableExceptions(rules)).toEqual(new Set(["z"]));
    expect(exceptions.map(({ id }) => id)).toEqual(["z", "a"]);
  });

  it("requires both product and folder when an exception gives both", () => {
    const rules = {
      ...base,
      exceptions: [
        {
          id: "both",
          position: 1,
          zoneId: null,
          categoryId: "cocktails",
          productId: "mojito",
          target: station("mainBar"),
        },
      ],
    };
    expect(chooseMaker(rules, mojito, null, null).decidedBy).toEqual({
      kind: "exception",
      exceptionId: "both",
    });
    expect(chooseMaker(rules, { ...mojito, categoryId: "food" }, null, null).decidedBy).toEqual({
      kind: "default",
    });
    expect(
      chooseMaker(rules, { ...mojito, routedProductId: "different" }, null, null).decidedBy,
    ).toEqual({ kind: "claim", categoryId: "cocktails" });
    expect(chooseMaker(rules, bread, null, null).decidedBy).toEqual({ kind: "default" });
  });

  it("keeps the first switched-off exception even when later rules say no preparation", () => {
    const rules = {
      ...base,
      activeStationIds: new Set<string>(),
      claims: new Map<string, RouteTarget>([
        ["cocktails", station("cocktailBar")],
        ["drinks", { kind: "no_preparation" as const }],
      ]),
      exceptions: [
        {
          id: "second",
          position: 2,
          zoneId: null,
          categoryId: null,
          productId: null,
          target: station("bar"),
        },
        {
          id: "first",
          position: 1,
          zoneId: null,
          categoryId: null,
          productId: null,
          target: station("mainBar"),
        },
      ],
    };
    expect(chooseMaker(rules, mojito, null, null)).toEqual({
      route: null,
      decidedBy: { kind: "exception", exceptionId: "first" },
      fallbacks: [{ stationId: "mainBar", why: "switched_off" }],
      noReplacement: true,
    });
  });

  it("rejects a switched-off default instead of routing work to it", () => {
    expect(chooseMaker({ ...base, activeStationIds: new Set() }, bread, null, null)).toEqual({
      route: null,
      decidedBy: null,
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("keeps a missing category as the leaf and stops at a missing parent", () => {
    expect(folderAncestors(parentOf, "missing")).toEqual(["missing"]);
    expect(folderAncestors(new Map([["leaf", "missing"]]), "leaf")).toEqual(["leaf", "missing"]);
    expect(folderAncestors(new Map([["self", "self"]]), "self")).toEqual(["self"]);
    expect(folderAncestors(new Map([["", null]]), "")).toEqual([""]);
  });

  it.each([
    {
      name: "different products",
      aCategory: null,
      aProduct: "mojito",
      bCategory: null,
      bProduct: "lager",
      unreachable: false,
    },
    {
      name: "product before folder",
      aCategory: null,
      aProduct: "mojito",
      bCategory: "cocktails",
      bProduct: null,
      unreachable: false,
    },
    {
      name: "folder before product of unknown folder",
      aCategory: "drinks",
      aProduct: null,
      bCategory: null,
      bProduct: "mojito",
      unreachable: false,
    },
    {
      name: "different folders",
      aCategory: "food",
      aProduct: null,
      bCategory: "drinks",
      bProduct: null,
      unreachable: false,
    },
    {
      name: "narrow folder before parent",
      aCategory: "cocktails",
      aProduct: null,
      bCategory: "drinks",
      bProduct: null,
      unreachable: false,
    },
    {
      name: "folder before catch-all",
      aCategory: "drinks",
      aProduct: null,
      bCategory: null,
      bProduct: null,
      unreachable: false,
    },
    {
      name: "same folder",
      aCategory: "drinks",
      aProduct: null,
      bCategory: "drinks",
      bProduct: null,
      unreachable: true,
    },
  ])(
    "detects coverage accurately for $name",
    ({ aCategory, aProduct, bCategory, bProduct, unreachable }) => {
      const rules = {
        ...base,
        exceptions: [
          {
            id: "a",
            position: 1,
            zoneId: null,
            categoryId: aCategory,
            productId: aProduct,
            target: { kind: "no_preparation" as const },
          },
          {
            id: "b",
            position: 2,
            zoneId: "terrace",
            categoryId: bCategory,
            productId: bProduct,
            target: station("bar"),
          },
        ],
      };
      expect(unreachableExceptions(rules)).toEqual(new Set(unreachable ? ["b"] : []));
    },
  );
});

const at = (weekday: number, timeOfDay: string): RoutingMoment => ({ weekday, timeOfDay });
const FRI = 5,
  SAT = 6;

describe("opening hours", () => {
  const rules: RoutingRules = {
    ...base,
    activeStationIds: new Set([
      ...base.activeStationIds,
      "upstairs",
      "downstairs",
      "late",
      "midnight",
    ]),
    timing: new Map([
      [
        "upstairs",
        {
          fallbackId: "downstairs",
          hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }],
          today: null,
        },
      ],
      [
        "late",
        {
          fallbackId: null,
          hours: [{ weekday: FRI, opensAt: "22:00:00", closesAt: "02:00:00" }],
          today: null,
        },
      ],
      [
        "midnight",
        {
          fallbackId: null,
          hours: [{ weekday: FRI, opensAt: "20:00", closesAt: "00:00" }],
          today: null,
        },
      ],
    ]),
  };
  const open = (id: string, m: RoutingMoment | null) => stationStatus(rules, id, m);

  it("includes the opening minute and excludes the closing minute", () => {
    expect(open("upstairs", at(FRI, "19:00"))).toEqual({ open: true, why: "in_hours" });
    expect(open("upstairs", at(FRI, "20:59"))).toEqual({ open: true, why: "in_hours" });
    expect(open("upstairs", at(FRI, "21:00"))).toEqual({ open: false, why: "out_of_hours" });
    expect(open("upstairs", at(SAT, "20:00"))).toEqual({ open: false, why: "out_of_hours" });
  });

  it("keeps past-midnight hours open on the next day up to closing", () => {
    expect(open("late", at(FRI, "21:59")).open).toBe(false);
    expect(open("late", at(FRI, "23:30")).open).toBe(true);
    expect(open("late", at(SAT, "01:59")).open).toBe(true);
    expect(open("late", at(SAT, "02:00")).open).toBe(false);
    expect(open("midnight", at(FRI, "23:59")).open).toBe(true);
    expect(open("midnight", at(SAT, "00:00")).open).toBe(false);
    const saturday = {
      ...rules,
      timing: new Map([
        [
          "late",
          {
            fallbackId: null,
            hours: [{ weekday: SAT, opensAt: "22:00", closesAt: "02:00" }],
            today: null,
          },
        ],
      ]),
    };
    expect(stationStatus(saturday, "late", at(0, "01:00")).open).toBe(true);
  });

  it("uses no hours and the default before schedule closures", () => {
    expect(open("downstairs", at(FRI, "04:00"))).toEqual({ open: true, why: "no_hours" });
    const kitchenHours = {
      ...rules,
      timing: new Map([
        [
          "kitchen",
          {
            fallbackId: "bar",
            hours: [{ weekday: 1, opensAt: "09:00", closesAt: "10:00" }],
            today: "closed" as const,
          },
        ],
      ]),
    };
    expect(stationStatus(kitchenHours, "kitchen", at(FRI, "20:00"))).toEqual({
      open: true,
      why: "default",
    });
  });

  it("uses today's by-hand change, except when time does not apply", () => {
    const closed = {
      ...rules,
      timing: new Map([
        [
          "upstairs",
          {
            fallbackId: "downstairs",
            hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }],
            today: "closed" as const,
          },
        ],
      ]),
    };
    expect(stationStatus(closed, "upstairs", at(FRI, "20:00"))).toEqual({
      open: false,
      why: "closed_by_hand",
    });
    const opened = {
      ...rules,
      timing: new Map([
        [
          "upstairs",
          {
            fallbackId: "downstairs",
            hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }],
            today: "open" as const,
          },
        ],
      ]),
    };
    expect(stationStatus(opened, "upstairs", at(SAT, "12:00"))).toEqual({
      open: true,
      why: "opened_by_hand",
    });
    expect(stationStatus(closed, "upstairs", null)).toEqual({
      open: true,
      why: "time_not_applied",
    });
    expect(stationStatus(base, "retired", null)).toEqual({ open: false, why: "switched_off" });
  });
});

describe("opening hours by calendar date", () => {
  const MON = 1,
    TUE = 2;
  const schedule = (timing: Partial<StationTiming>): RoutingRules => ({
    ...base,
    activeStationIds: new Set([...base.activeStationIds, "late"]),
    timing: new Map([["late", { fallbackId: null, hours: [], today: null, ...timing }]]),
  });
  const on = (civilDate: string, weekday: number, timeOfDay: string): RoutingMoment => ({
    civilDate,
    weekday,
    timeOfDay,
  });
  const status = (rules: RoutingRules, moment: RoutingMoment | null) =>
    stationStatus(rules, "late", moment);
  const inHours = { open: true, why: "in_hours" };
  const outOfHours = { open: false, why: "out_of_hours" };
  const noHours = { open: true, why: "no_hours" };
  // Monday 22:00 to Tuesday 02:00 in a configured week where every other day is Closed.
  const mondayNight = {
    weekSet: true,
    hours: [{ weekday: MON, opensAt: "22:00", closesAt: "02:00" }],
  };
  // Tuesday 6 October 2026, the day after Monday 5 October.
  const tuesday = (time: string) => on("2026-10-06", TUE, time);

  it("keeps Monday's overnight tail on Tuesday, even when Tuesday is Closed", () => {
    expect(status(schedule(mondayNight), tuesday("00:30"))).toEqual(inHours);
    const closedTuesday = schedule({ ...mondayNight, dates: new Map([["2026-10-06", []]]) });
    expect(status(closedTuesday, tuesday("00:30"))).toEqual(inHours);
    expect(status(closedTuesday, tuesday("01:59"))).toEqual(inHours);
    expect(status(closedTuesday, tuesday("02:00"))).toEqual(outOfHours);
  });

  it("drops Monday's tail when Monday itself is Closed or has other hours", () => {
    expect(
      status(schedule({ ...mondayNight, dates: new Map([["2026-10-05", []]]) }), tuesday("00:30")),
    ).toEqual(outOfHours);
    const earlyMonday = schedule({
      ...mondayNight,
      dates: new Map([["2026-10-05", [{ opensAt: "12:00", closesAt: "16:00" }]]]),
    });
    expect(status(earlyMonday, tuesday("00:30"))).toEqual(outOfHours);
    expect(status(earlyMonday, on("2026-10-05", MON, "15:59"))).toEqual(inHours);
    expect(status(earlyMonday, on("2026-10-05", MON, "22:00"))).toEqual(outOfHours);
  });

  it("reads each date's own hours across a month end, a year end and Sunday into Monday", () => {
    const rules = schedule({
      weekSet: true,
      hours: [],
      dates: new Map([
        ["2026-10-31", [{ opensAt: "23:00", closesAt: "01:00" }]],
        ["2026-11-01", [{ opensAt: "12:00", closesAt: "13:00" }]],
        ["2026-12-31", [{ opensAt: "22:00", closesAt: "03:00" }]],
        ["2027-01-01", []],
        ["2026-10-11", [{ opensAt: "23:00", closesAt: "02:00" }]],
      ]),
    });
    expect(status(rules, on("2026-11-01", 0, "00:30"))).toEqual(inHours);
    expect(status(rules, on("2026-11-01", 0, "01:00"))).toEqual(outOfHours);
    expect(status(rules, on("2026-11-01", 0, "12:30"))).toEqual(inHours);
    expect(status(rules, on("2027-01-01", 5, "02:59"))).toEqual(inHours);
    expect(status(rules, on("2027-01-01", 5, "03:00"))).toEqual(outOfHours);
    expect(status(rules, on("2026-10-12", MON, "01:30"))).toEqual(inHours);
    expect(status(rules, on("2026-10-13", TUE, "01:30"))).toEqual(outOfHours);
  });

  it("includes the opening minute and excludes the closing minute of a special date", () => {
    const rules = schedule({
      dates: new Map([["2026-10-09", [{ opensAt: "12:00", closesAt: "14:00" }]]]),
    });
    expect(status(rules, on("2026-10-09", 5, "11:59"))).toEqual(outOfHours);
    expect(status(rules, on("2026-10-09", 5, "12:00"))).toEqual(inHours);
    expect(status(rules, on("2026-10-09", 5, "13:59"))).toEqual(inHours);
    expect(status(rules, on("2026-10-09", 5, "14:00"))).toEqual(outOfHours);
  });

  it("tells a week with no hours set from a week that is Closed every day", () => {
    expect(status(schedule({ weekSet: false, hours: [] }), tuesday("12:00"))).toEqual(noHours);
    expect(status(schedule({ weekSet: true, hours: [] }), tuesday("12:00"))).toEqual(outOfHours);
  });

  it("applies a special date to a station with no weekly hours on that date only", () => {
    const rules = schedule({
      weekSet: false,
      dates: new Map([["2026-10-09", [{ opensAt: "22:00", closesAt: "01:00" }]]]),
    });
    expect(status(rules, on("2026-10-09", 5, "12:00"))).toEqual(outOfHours);
    expect(status(rules, on("2026-10-10", 6, "00:30"))).toEqual(inHours);
    expect(status(rules, on("2026-10-10", 6, "01:00"))).toEqual(noHours);
    expect(status(rules, on("2026-10-08", 4, "12:00"))).toEqual(noHours);
  });

  it("opens all day from midnight up to the next midnight", () => {
    const rules = schedule({
      weekSet: true,
      dates: new Map([["2026-10-09", [{ opensAt: "00:00", closesAt: "00:00" }]]]),
    });
    expect(status(rules, on("2026-10-09", 5, "00:00"))).toEqual(inHours);
    expect(status(rules, on("2026-10-09", 5, "23:59"))).toEqual(inHours);
    expect(status(rules, on("2026-10-10", 6, "00:00"))).toEqual(outOfHours);
  });

  it("previews the standard week alone for a moment that names no date", () => {
    const rules = schedule({ ...mondayNight, dates: new Map([["2026-10-05", []]]) });
    expect(status(rules, { weekday: TUE, timeOfDay: "00:30" })).toEqual(inHours);
  });

  it("keeps the switch, the default, an unreadable clock and today's by-hand change ahead of a special date", () => {
    const closedDate = new Map([["2026-10-06", []]]);
    expect(
      status(schedule({ weekSet: true, dates: closedDate, today: "open" }), tuesday("12:00")),
    ).toEqual({ open: true, why: "opened_by_hand" });
    expect(
      status(
        schedule({
          dates: new Map([["2026-10-06", [{ opensAt: "00:00", closesAt: "00:00" }]]]),
          today: "closed",
        }),
        tuesday("12:00"),
      ),
    ).toEqual({ open: false, why: "closed_by_hand" });
    expect(status(schedule({ weekSet: true, dates: closedDate }), null)).toEqual({
      open: true,
      why: "time_not_applied",
    });
    const asDefault = {
      ...schedule({ weekSet: true, dates: closedDate }),
      defaultStationId: "late",
    };
    expect(status(asDefault, tuesday("12:00"))).toEqual({ open: true, why: "default" });
    const switchedOff = { ...asDefault, activeStationIds: new Set<string>() };
    expect(status(switchedOff, tuesday("12:00"))).toEqual({ open: false, why: "switched_off" });
  });
});

describe("fallbacks", () => {
  const rules: RoutingRules = {
    ...base,
    claims: new Map([["drinks", station("upstairs")]]),
    activeStationIds: new Set(["upstairs", "downstairs", "kitchen", "a", "b"]),
    timing: new Map([
      [
        "upstairs",
        {
          fallbackId: "downstairs",
          hours: [{ weekday: FRI, opensAt: "19:00", closesAt: "21:00" }],
          today: null,
        },
      ],
      ["downstairs", { fallbackId: null, hours: [], today: null }],
      ["a", { fallbackId: "b", hours: [], today: "closed" }],
      ["b", { fallbackId: "a", hours: [], today: "closed" }],
    ]),
  };

  it("sends work from an out-of-hours station to its first open fallback", () => {
    expect(chooseMaker(rules, lager, null, at(FRI, "22:00"))).toEqual({
      route: station("downstairs"),
      decidedBy: { kind: "claim", categoryId: "drinks" },
      fallbacks: [{ stationId: "upstairs", why: "out_of_hours" }],
      noReplacement: false,
    });
    expect(chooseMaker(rules, lager, null, at(FRI, "20:00")).route).toEqual(station("upstairs"));
  });

  it("returns a dead end when every fallback is closed", () => {
    const closed = {
      ...rules,
      timing: new Map([
        ...rules.timing,
        ["downstairs", { fallbackId: null, hours: [], today: "closed" as const }],
      ]),
    };
    expect(chooseMaker(closed, lager, null, at(FRI, "22:00"))).toEqual({
      route: null,
      decidedBy: { kind: "claim", categoryId: "drinks" },
      fallbacks: [
        { stationId: "upstairs", why: "out_of_hours" },
        { stationId: "downstairs", why: "closed_by_hand" },
      ],
      noReplacement: true,
    });
  });

  it("stops a fallback loop before revisiting a station", () => {
    expect(followFallbacks(rules, "a", at(FRI, "20:00"))).toEqual({
      stationId: null,
      steps: [
        { stationId: "a", why: "closed_by_hand" },
        { stationId: "b", why: "closed_by_hand" },
      ],
    });
  });

  it("reaches the default only through an explicit fallback", () => {
    const toKitchen = {
      ...rules,
      timing: new Map([
        ...rules.timing,
        ["a", { fallbackId: "kitchen", hours: [], today: "closed" as const }],
      ]),
    };
    expect(followFallbacks(toKitchen, "a", at(FRI, "20:00")).stationId).toBe("kitchen");
  });

  it("keeps a missing default distinct from a closed chain", () => {
    expect(
      chooseMaker({ ...rules, defaultStationId: null }, bread, null, at(FRI, "20:00")),
    ).toEqual({
      route: null,
      decidedBy: null,
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("does not walk a no-preparation route", () => {
    const np = { ...rules, claims: new Map([["drinks", { kind: "no_preparation" as const }]]) };
    expect(chooseMaker(np, lager, null, at(FRI, "22:00"))).toEqual({
      route: { kind: "no_preparation" },
      decidedBy: { kind: "claim", categoryId: "drinks" },
      fallbacks: [],
      noReplacement: false,
    });
  });

  it("finds where a station's work would go if it closed", () => {
    expect(closedSendsTo(rules, "upstairs", at(FRI, "20:00"))).toBe("downstairs");
    expect(closedSendsTo(rules, "downstairs", at(FRI, "20:00"))).toBeNull();
    expect(closedSendsTo(rules, "a", at(FRI, "20:00"))).toBeNull();
    expect(closedSendsTo(rules, "kitchen", at(FRI, "20:00"))).toBe("kitchen");
  });
});

const extrasRules: RoutingRules = {
  ...base,
  parentOf: new Map([
    ...parentOf,
    ["extras", null],
    ["sides", "extras"],
    ["toppings", "extras"],
    ["sauces", "extras"],
  ]),
  activeStationIds: new Set([...base.activeStationIds, "grill", "fryer", "terraceKitchen"]),
  claims: new Map<string, RouteTarget>([
    ["sides", station("fryer")],
    ["sauces", { kind: "no_preparation" }],
  ]),
};
const chips = { productId: "chips", routedProductId: "chips", categoryId: "sides" };
const cheese = { productId: "cheese", routedProductId: "cheese", categoryId: "toppings" };
const sauce = { productId: "sauce", routedProductId: "sauce", categoryId: "sauces" };

describe("chooseExtraMaker", () => {
  it("splits an extra off when its folder's claim names another station", () => {
    expect(chooseExtraMaker(extrasRules, chips, null, null, "grill")).toEqual({
      outcome: { kind: "made", stationId: "fryer" },
      decidedBy: { kind: "claim", categoryId: "sides" },
      fallbacks: [],
    });
  });
  it("keeps an unclaimed extra with its dish with or without an active default", () => {
    expect(chooseExtraMaker(extrasRules, cheese, null, null, "grill").outcome).toEqual({
      kind: "follows_dish",
      why: "no_rule",
    });
    expect(
      chooseExtraMaker({ ...extrasRules, defaultStationId: null }, cheese, null, null, "grill")
        .outcome,
    ).toEqual({ kind: "follows_dish", why: "no_rule" });
  });
  it("keeps a no-preparation extra with its dish", () => {
    expect(chooseExtraMaker(extrasRules, sauce, null, null, "grill").outcome).toEqual({
      kind: "follows_dish",
      why: "no_preparation",
    });
  });
  it("keeps an extra with its dish when both are made at one station", () => {
    expect(chooseExtraMaker(extrasRules, chips, null, null, "fryer").outcome).toEqual({
      kind: "follows_dish",
      why: "same_station",
    });
  });
  it("lets an exception decide for an extra as for a dish", () => {
    const rules = {
      ...extrasRules,
      exceptions: [
        {
          id: "t",
          position: 1,
          zoneId: "terrace",
          categoryId: null,
          productId: null,
          target: station("terraceKitchen"),
        },
      ],
    };
    expect(chooseExtraMaker(rules, chips, "terrace", null, "terraceKitchen")).toEqual({
      outcome: { kind: "follows_dish", why: "same_station" },
      decidedBy: { kind: "exception", exceptionId: "t" },
      fallbacks: [],
    });
  });
  it("walks the extra's fallbacks before comparing its station with its dish's", () => {
    const rules = {
      ...extrasRules,
      timing: new Map([["fryer", { fallbackId: "kitchen", hours: [], today: "closed" as const }]]),
    };
    expect(chooseExtraMaker(rules, chips, null, at(FRI, "20:00"), "grill")).toEqual({
      outcome: { kind: "made", stationId: "kitchen" },
      decidedBy: { kind: "claim", categoryId: "sides" },
      fallbacks: [{ stationId: "fryer", why: "closed_by_hand" }],
    });
    expect(chooseExtraMaker(rules, chips, null, at(FRI, "20:00"), "kitchen").outcome).toEqual({
      kind: "follows_dish",
      why: "same_station",
    });
  });
  it("keeps an extra with its dish when none of its stations is open", () => {
    const rules = {
      ...extrasRules,
      timing: new Map([["fryer", { fallbackId: null, hours: [], today: "closed" as const }]]),
    };
    expect(chooseExtraMaker(rules, chips, null, at(FRI, "20:00"), "grill")).toEqual({
      outcome: { kind: "follows_dish", why: "no_replacement" },
      decidedBy: { kind: "claim", categoryId: "sides" },
      fallbacks: [{ stationId: "fryer", why: "closed_by_hand" }],
    });
  });
  it("splits a claimed extra off a dish that needs no preparation", () => {
    expect(chooseExtraMaker(extrasRules, chips, null, null, null).outcome).toEqual({
      kind: "made",
      stationId: "fryer",
    });
  });
});

describe("a public holiday", () => {
  const MON = 1;
  // Monday 12 October 2026 is Spain's national day; Monday 5 October is an ordinary Monday.
  const HOLIDAY = "2026-10-12";
  const ORDINARY = "2026-10-05";
  const on = (civilDate: string, timeOfDay: string): RoutingMoment => ({
    civilDate,
    weekday: MON,
    timeOfDay,
  });
  const timing: StationTiming = {
    fallbackId: "mainBar",
    hours: [{ weekday: MON, opensAt: "18:00", closesAt: "23:00" }],
    today: null,
    weekSet: true,
  };
  const rules: RoutingRules = { ...base, timing: new Map([["cocktailBar", timing]]) };

  it("is a national holiday in Seville through the real Spanish pack, and the ordinary Monday is not", () => {
    const spain = getCountryPack("ES")!.holidayCalendar!;
    const facts = (date: string) =>
      spain.read({ provinceCode: "41", areaKey: null, from: date, to: date }).facts;
    expect(facts(HOLIDAY)).toEqual([expect.objectContaining({ date: HOLIDAY, scope: "national" })]);
    expect(facts(ORDINARY)).toEqual([]);
  });

  it("leaves a station on its Monday hours, and every route as on an ordinary Monday", () => {
    for (const time of ["12:00", "18:00", "22:59", "23:00"]) {
      expect(stationStatus(rules, "cocktailBar", on(HOLIDAY, time))).toEqual(
        stationStatus(rules, "cocktailBar", on(ORDINARY, time)),
      );
      expect(chooseMaker(rules, mojito, "terrace", on(HOLIDAY, time))).toEqual(
        chooseMaker(rules, mojito, "terrace", on(ORDINARY, time)),
      );
    }
    expect(stationStatus(rules, "cocktailBar", on(HOLIDAY, "20:00"))).toEqual({
      open: true,
      why: "in_hours",
    });
    expect(chooseMaker(rules, mojito, null, on(HOLIDAY, "20:00")).route).toEqual(
      station("cocktailBar"),
    );
    expect(chooseMaker(rules, mojito, null, on(HOLIDAY, "12:00")).route).toEqual(
      station("mainBar"),
    );
  });

  it("closes a station on the holiday only through a special date the venue saved", () => {
    const closedHoliday: RoutingRules = {
      ...base,
      timing: new Map([["cocktailBar", { ...timing, dates: new Map([[HOLIDAY, []]]) }]]),
    };
    expect(stationStatus(closedHoliday, "cocktailBar", on(HOLIDAY, "20:00"))).toEqual({
      open: false,
      why: "out_of_hours",
    });
    expect(chooseMaker(closedHoliday, mojito, null, on(HOLIDAY, "20:00")).route).toEqual(
      station("mainBar"),
    );
    expect(stationStatus(closedHoliday, "cocktailBar", on(ORDINARY, "20:00"))).toEqual({
      open: true,
      why: "in_hours",
    });
  });
});

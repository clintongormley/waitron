import { describe, expect, it } from "vitest";
import {
  chooseExtraMaker,
  chooseMaker,
  closedSendsTo,
  followFallbacks,
  stationStatus,
  type RoutingRules,
  type StationTiming,
} from "./routing.js";

// Former schedule values remain in fixtures to catch a routing consumer reading them again.
type FormerStationTiming = StationTiming & {
  fallbackId?: string | null;
  hours?: readonly { weekday: number; opensAt: string; closesAt: string }[];
  weekSet?: boolean;
  dates?: ReadonlyMap<string, readonly { opensAt: string; closesAt: string }[]>;
};

const dish = { productId: "coffee", routedProductId: "coffee", categoryId: null };
const moment = { weekday: 5, timeOfDay: "16:00", civilDate: "2026-10-09" };
const station = (stationId: string) => ({ kind: "station" as const, stationId });
const rulesFor = (
  timing: ReadonlyMap<string, FormerStationTiming> = new Map(),
  activeStationIds: ReadonlySet<string> = new Set(["bar", "grill", "kitchen"]),
  defaultStationId: string | null = "kitchen",
): RoutingRules => ({
  cells: [{ row: { kind: "product", productId: "coffee" }, zoneId: null, target: station("bar") }],
  parentOf: new Map(),
  timing,
  activeStationIds,
  defaultStationId,
});
const closed = (todaySendsTo: string | null = null): FormerStationTiming => ({
  hours: [],
  fallbackId: null,
  today: "closed",
  todaySendsTo,
});

// Old schedules are deliberately different from the close-for-today state.
const oldSchedule: FormerStationTiming = {
  fallbackId: "grill",
  today: null,
  hours: [{ weekday: 5, opensAt: "12:00", closesAt: "14:00" }],
  weekSet: true,
  dates: new Map([["2026-10-09", []]]),
};

describe("routing without station hours", () => {
  it.each(["11:59", "12:00", "13:59", "14:00", "16:00", "23:59"])(
    "sends to the chosen station at %s regardless of its former hours",
    (timeOfDay) => {
      const rules = rulesFor(new Map([["bar", oldSchedule]]));
      const at = { ...moment, timeOfDay };
      expect(stationStatus(rules, "bar", at)).toEqual({ open: true, why: "open" });
      expect(chooseMaker(rules, dish, null, at)).toEqual({
        route: station("bar"),
        decidedBy: {
          kind: "cell",
          address: { row: { kind: "product", productId: "coffee" }, zoneId: null },
        },
        fallbacks: [],
        noReplacement: false,
      });
    },
  );

  it("an active station with no timing record is open", () => {
    expect(stationStatus(rulesFor(), "bar", moment)).toEqual({ open: true, why: "open" });
  });

  it("a stored open-for-today row reads as ordinary open", () => {
    expect(
      stationStatus(rulesFor(new Map([["bar", { ...oldSchedule, today: "open" }]])), "bar", moment),
    ).toEqual({ open: true, why: "open" });
  });

  it.each([undefined, null])(
    "a close with destination %s goes to the default, ignoring the old fallback",
    (todaySendsTo) => {
      const rules = rulesFor(new Map([["bar", { ...oldSchedule, today: "closed", todaySendsTo }]]));
      expect(chooseMaker(rules, dish, null, moment)).toEqual({
        route: station("kitchen"),
        decidedBy: {
          kind: "cell",
          address: { row: { kind: "product", productId: "coffee" }, zoneId: null },
        },
        fallbacks: [{ stationId: "bar", why: "closed_by_hand" }],
        noReplacement: false,
      });
      expect(closedSendsTo(rules, "bar", moment)).toBe("kitchen");
    },
  );

  it("a disabled station goes to the default even with an old fallback and today's destination", () => {
    const rules = rulesFor(
      new Map([["bar", { ...closed("grill"), fallbackId: "grill" }]]),
      new Set(["grill", "kitchen"]),
    );
    expect(followFallbacks(rules, "bar", moment)).toEqual({
      stationId: "kitchen",
      steps: [{ stationId: "bar", why: "switched_off" }],
    });
    expect(closedSendsTo(rules, "bar", moment)).toBe("kitchen");
  });

  it("a close follows today's destination while that destination is open", () => {
    const rules = rulesFor(new Map([["bar", closed("grill")]]));
    expect(followFallbacks(rules, "bar", moment)).toEqual({
      stationId: "grill",
      steps: [{ stationId: "bar", why: "closed_by_hand" }],
    });
    expect(closedSendsTo(rules, "bar", moment)).toBe("grill");
  });

  it("continues through a closed destination to its daily choice", () => {
    const rules = rulesFor(
      new Map([
        ["bar", closed("grill")],
        ["grill", closed("kitchen")],
      ]),
    );
    expect(followFallbacks(rules, "bar", moment)).toEqual({
      stationId: "kitchen",
      steps: [
        { stationId: "bar", why: "closed_by_hand" },
        { stationId: "grill", why: "closed_by_hand" },
      ],
    });
  });

  it("a closed destination with no choice reaches the default", () => {
    const rules = rulesFor(
      new Map([
        ["bar", closed("grill")],
        ["grill", closed()],
      ]),
    );
    expect(followFallbacks(rules, "bar", moment)).toEqual({
      stationId: "kitchen",
      steps: [
        { stationId: "bar", why: "closed_by_hand" },
        { stationId: "grill", why: "closed_by_hand" },
      ],
    });
    expect(closedSendsTo(rules, "bar", moment)).toBe("kitchen");
  });

  it.each(["bar", "grill"])("a destination cycle through %s ends at the default", (destination) => {
    const rules = rulesFor(
      new Map([
        ["bar", closed(destination)],
        ["grill", closed("bar")],
      ]),
    );
    expect(followFallbacks(rules, "bar", moment)).toEqual({
      stationId: "kitchen",
      steps:
        destination === "bar"
          ? [{ stationId: "bar", why: "closed_by_hand" }]
          : [
              { stationId: "bar", why: "closed_by_hand" },
              { stationId: "grill", why: "closed_by_hand" },
            ],
    });
    expect(closedSendsTo(rules, "bar", moment)).toBe("kitchen");
  });

  it.each([null, "kitchen"])(
    "retains the refusal when default %s is unavailable",
    (defaultStationId) => {
      const rules = rulesFor(
        new Map([["bar", closed()]]),
        new Set(["bar", "grill"]),
        defaultStationId,
      );
      expect(chooseMaker(rules, dish, null, moment)).toMatchObject({
        route: null,
        noReplacement: true,
      });
      expect(closedSendsTo(rules, "bar", moment)).toBeNull();
    },
  );

  it("the active default remains available despite an old close row", () => {
    const rules = rulesFor(new Map([["kitchen", closed("bar")]]));
    expect(stationStatus(rules, "kitchen", moment)).toEqual({ open: true, why: "default" });
    expect(followFallbacks(rules, "kitchen", moment)).toEqual({ stationId: "kitchen", steps: [] });
  });

  it("the default must be active even when its id is still recorded", () => {
    const rules = rulesFor(new Map(), new Set(["bar", "grill"]));
    expect(stationStatus(rules, "kitchen", moment)).toEqual({ open: false, why: "switched_off" });
    expect(closedSendsTo(rules, "kitchen", moment)).toBeNull();
  });

  it("an extra gets the default maker when its own station is disabled", () => {
    const rules = rulesFor(new Map(), new Set(["grill", "kitchen"]));
    expect(chooseExtraMaker(rules, dish, null, moment, "grill")).toEqual({
      outcome: { kind: "made", stationId: "kitchen" },
      decidedBy: {
        kind: "cell",
        address: { row: { kind: "product", productId: "coffee" }, zoneId: null },
      },
      fallbacks: [{ stationId: "bar", why: "switched_off" }],
    });
  });

  it("an untimed configuration read does not apply a daily close", () => {
    const rules = rulesFor(new Map([["bar", closed("grill")]]));
    expect(stationStatus(rules, "bar", null)).toEqual({ open: true, why: "open" });
    expect(chooseMaker(rules, dish, null, null).route).toEqual(station("bar"));
    expect(closedSendsTo(rules, "bar", null)).toBe("kitchen");
  });
});

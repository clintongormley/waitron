import { expect, it } from "vitest";
import type { DeviceZoneSelection } from "@waitron/venue-service";
import { deviceZoneNavigation } from "./device-zones.js";

const selection: DeviceZoneSelection = {
  profileId: "profile",
  snapshot: "scope",
  adjusted: false,
  saved: true,
  zones: [
    {
      id: "bar",
      name: "Bar",
      departmentId: "department",
      departmentName: "Restaurant",
      serviceMode: "prepay",
    },
    {
      id: "room",
      name: "Room",
      departmentId: "department",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
    },
    {
      id: "shop",
      name: "Shop",
      departmentId: "department",
      departmentName: "Restaurant",
      serviceMode: "ticket_then_pay",
    },
    {
      id: "garden",
      name: "Garden",
      departmentId: "department",
      departmentName: "Restaurant",
      serviceMode: "table_tab",
    },
  ],
  selectedZoneIds: ["shop", "room"],
  startingZoneId: "room",
};

it("uses only selected permitted zones in display order and starts on the selected table zone", () => {
  expect(deviceZoneNavigation("till", selection)).toEqual({
    counterZoneIds: ["shop"],
    floorZoneIds: ["room"],
    startingZoneId: "room",
    home: "floor",
  });
});

it("keeps both counter payment modes and drops unknown retained ids", () => {
  expect(
    deviceZoneNavigation("till", {
      ...selection,
      selectedZoneIds: ["shop", "bar", "foreign"],
      startingZoneId: "shop",
    }),
  ).toEqual({
    counterZoneIds: ["bar", "shop"],
    floorZoneIds: [],
    startingZoneId: "shop",
    home: "counter",
  });
});

it("an empty permitted intersection never falls back to a venue-wide counter", () => {
  expect(
    deviceZoneNavigation("till", {
      ...selection,
      selectedZoneIds: ["foreign"],
      startingZoneId: "foreign",
    }),
  ).toEqual({
    counterZoneIds: [],
    floorZoneIds: [],
    startingZoneId: null,
    home: null,
  });
});

it("a removed start uses the first effective zone rather than a hidden one", () => {
  expect(deviceZoneNavigation("till", { ...selection, startingZoneId: "bar" })).toEqual({
    counterZoneIds: ["shop"],
    floorZoneIds: ["room"],
    startingZoneId: "room",
    home: "floor",
  });
});

it.each(["phone-portrait", "tablet-landscape"] as const)(
  "%s retains its Floor home and never gains a Counter",
  (formFactor) => {
    expect(
      deviceZoneNavigation(formFactor, {
        ...selection,
        selectedZoneIds: ["bar", "room"],
        startingZoneId: "bar",
      }),
    ).toEqual({
      counterZoneIds: [],
      floorZoneIds: ["bar", "room"],
      startingZoneId: "bar",
      home: "floor",
    });
  },
);

it.each(["phone-portrait", "tablet-landscape"] as const)(
  "%s shows only the chosen zones, of every kind, and opens only on a saved start",
  (formFactor) => {
    const chosen = { ...selection, selectedZoneIds: ["garden", "shop", "foreign"] };
    const zones = { counterZoneIds: [], floorZoneIds: ["shop", "garden"], home: "floor" };
    expect(deviceZoneNavigation(formFactor, { ...chosen, startingZoneId: "shop" })).toEqual({
      ...zones,
      startingZoneId: "shop",
    });
    expect(
      deviceZoneNavigation(formFactor, { ...chosen, saved: false, startingZoneId: "shop" }),
    ).toEqual({ ...zones, startingZoneId: null });
    expect(
      deviceZoneNavigation(formFactor, { ...chosen, saved: false, startingZoneId: "garden" }),
    ).toEqual({ ...zones, startingZoneId: null });
    expect(deviceZoneNavigation(formFactor, { ...chosen, startingZoneId: "room" })).toEqual({
      ...zones,
      startingZoneId: null,
    });
  },
);

it.each(["phone-portrait", "tablet-landscape"] as const)(
  "%s has no Floor home when no chosen zone is still offered",
  (formFactor) => {
    expect(
      deviceZoneNavigation(formFactor, {
        ...selection,
        selectedZoneIds: ["foreign"],
        startingZoneId: "foreign",
      }),
    ).toEqual({ counterZoneIds: [], floorZoneIds: [], startingZoneId: null, home: null });
  },
);

it("a kitchen display gains no selling screen", () => {
  expect(deviceZoneNavigation("kds", selection)).toEqual({
    counterZoneIds: [],
    floorZoneIds: [],
    startingZoneId: null,
    home: null,
  });
});

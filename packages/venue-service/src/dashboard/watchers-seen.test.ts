import { expect, it } from "vitest";
import { watchersOfStation, watchersSeeing, type WatcherView } from "./watchers-seen.js";

const pass: WatcherView = {
  id: "pass",
  name: "Pass",
  active: true,
  displayOrder: 0,
  everyStation: true,
  stationIds: [],
  everyZone: true,
  zoneIds: [],
  runsPass: true,
  printerIds: [],
};
const runner: WatcherView = {
  id: "runner",
  name: "Terrace runner",
  active: true,
  displayOrder: 1,
  everyStation: false,
  stationIds: ["grill"],
  everyZone: false,
  zoneIds: ["terrace"],
  runsPass: false,
  printerIds: [],
};

it.each([
  ["grill", "terrace", ["Pass", "Terrace runner"]],
  ["grill", "inside", ["Pass"]],
  ["grill", null, ["Pass"]],
  ["fryer", "terrace", ["Pass"]],
] as const)("lists watchers seeing %s in %s", (stationId, zoneId, names) => {
  expect(watchersSeeing([pass, runner], stationId, zoneId).map((w) => w.name)).toEqual(names);
});

it("lists every-station and explicitly following watchers on a station card", () => {
  expect(watchersOfStation([pass, runner], "grill").map((w) => w.name)).toEqual([
    "Pass",
    "Terrace runner",
  ]);
  expect(watchersOfStation([pass, runner], "fryer").map((w) => w.name)).toEqual(["Pass"]);
});

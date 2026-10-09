import { expect, it } from "vitest";
import { watchersOfStation, type WatcherView } from "./watchers-seen.js";

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
  inUse: false,
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
  inUse: false,
};

it("lists every-station and explicitly following watchers on a station card", () => {
  expect(watchersOfStation([pass, runner], "grill").map((w) => w.name)).toEqual([
    "Pass",
    "Terrace runner",
  ]);
  expect(watchersOfStation([pass, runner], "fryer").map((w) => w.name)).toEqual(["Pass"]);
});

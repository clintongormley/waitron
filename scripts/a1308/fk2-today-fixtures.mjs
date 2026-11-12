import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { runFoldCli } from "./lib/fold-inserts.mjs";

export const rules = [
  {
    child: "zoneExtensions",
    parent: "floorZones",
    key: "zoneId",
    fields: {
      businessDay: "keptOpenDay",
      startsAt: "keptOpenFrom",
      endsAt: "keptOpenUntil",
      id: null,
    },
  },
  {
    child: "stationDayStates",
    parent: "kitchenStations",
    key: "stationId",
    fields: {
      businessDay: "closedOnDay",
      sendsToStationId: "closedSendsToStationId",
      open: null,
      id: null,
    },
  },
];
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await runFoldCli(rules);

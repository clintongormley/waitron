import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { runFoldCli } from "./lib/fold-inserts.mjs";
export const rules = [
  {
    child: "floorTodayTables",
    parent: "diningTables",
    key: "tableId",
    fields: {
      seats: "todaySeats",
      fixed: "todayFixed",
      x: "todayX",
      y: "todayY",
      width: "todayWidth",
      height: "todayHeight",
      shape: "todayShape",
      rotation: "todayRotation",
      takenOff: "takenOff",
      name: "todayName",
      id: null,
    },
    constants: { onFloor: "true" },
  },
  {
    child: "floorTodayZones",
    parent: "floorZones",
    key: "zoneId",
    fields: {
      businessDay: "todayBusinessDay",
      revision: "todayRevision",
      setId: "todaySetId",
      layoutRevision: "todayLayoutRevision",
      occurrence: "todayOccurrence",
      id: null,
    },
  },
];
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await runFoldCli(rules);

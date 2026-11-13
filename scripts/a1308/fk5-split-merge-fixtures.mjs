import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { runFoldCli } from "./lib/fold-inserts.mjs";
export const rules = [
  {
    child: "floorTodayJoinTables",
    parent: "diningTables",
    key: "tableId",
    fields: {
      joinId: "mergeId",
      beforeX: "mergeBeforeX",
      beforeY: "mergeBeforeY",
      beforeRotation: "mergeBeforeRotation",
      id: null,
    },
  },
];
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await runFoldCli(rules);

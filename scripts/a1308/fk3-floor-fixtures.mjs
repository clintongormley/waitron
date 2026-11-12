import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runFoldCli } from "./lib/fold-inserts.mjs";

const rules = [
  {
    child: "floorPlanTableParts",
    parent: "floorPlanTables",
    key: "partTableId",
    fields: { joinedTableId: "partOfTableId", id: null },
    raw: {
      childTable: "floor_plan_table_parts",
      parentTable: "floor_plan_tables",
      key: "part_table_id",
      columns: { joined_table_id: "part_of_table_id", id: null },
    },
  },
  {
    child: "floorResetTableParts",
    parent: "floorResetTables",
    key: "partResetTableId",
    fields: { joinedResetTableId: "partOfResetTableId", id: null },
    raw: {
      childTable: "floor_reset_table_parts",
      parentTable: "floor_reset_tables",
      key: "part_reset_table_id",
      columns: { joined_reset_table_id: "part_of_reset_table_id", id: null },
    },
  },
];

function keptSizes(source) {
  const renamed = source
    .replaceAll("floorPlanTableSizes", "floorPlanPlacements")
    .replaceAll("floor_plan_table_sizes", "floor_plan_placements");
  const text = renamed.replace(/import \{([^}]+)\} from/g, (_match, bindings) => {
    const seen = new Set();
    const kept = bindings.split(",").filter((binding) => {
      const key = binding.trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return `import {${kept.join(",")}} from`;
  });
  return { text, reports: [] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await runFoldCli(rules, keptSizes);

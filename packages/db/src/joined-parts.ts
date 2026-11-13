import { sql, type AnyColumn, type SQL, type SQLWrapper } from "drizzle-orm";
import { diningTables } from "./schema/dining-tables.js";
import { todayColumns } from "./floor-today-columns.js";
import { alias } from "drizzle-orm/sqlite-core";
import { floorResetTables } from "./schema/floor-plans.js";

type ResetRowColumns = Record<
  "tableId" | "x" | "y" | "width" | "height" | "shape" | "rotation",
  AnyColumn
>;

export function resetRowMoves(row: ResetRowColumns): SQL {
  const t = todayColumns;
  return sql`exists (
    select 1 from ${diningTables}
    where ${diningTables.onFloor} = 1 and ${t.tableId} = ${row.tableId} and ${t.takenOff} = 0 and ${t.x} is not null and (
      ${t.x} is not ${row.x} or ${t.y} is not ${row.y} or ${t.width} is not ${row.width}
      or ${t.height} is not ${row.height} or ${t.shape} is not ${row.shape}
      or ${t.rotation} is not ${row.rotation}
      or ${diningTables.mergeId} is not null
    )
  )`;
}

const markedRow = alias(floorResetTables, "needs_moving_row");

/** The table's reset row waits for Mark moved and its own change moves it: the till's "Needs moving". */
export function needsMoving(tableId: SQLWrapper): SQL {
  return sql`${tableId} in (
    select ${markedRow.tableId} from ${floorResetTables} ${sql.identifier("needs_moving_row")}
    where ${markedRow.readyToMove} = 1 and ${resetRowMoves(markedRow)}
  )`;
}

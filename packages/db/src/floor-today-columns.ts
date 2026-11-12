import { diningTables } from "./schema/dining-tables.js";

const fields = {
  tableId: "id",
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
} as const;
type TableRow = typeof diningTables.$inferSelect;
export type TodayRow = { [K in keyof typeof fields]: TableRow[(typeof fields)[K]] };
export const todayColumns = {
  tableId: diningTables.id,
  seats: diningTables.todaySeats,
  fixed: diningTables.todayFixed,
  x: diningTables.todayX,
  y: diningTables.todayY,
  width: diningTables.todayWidth,
  height: diningTables.todayHeight,
  shape: diningTables.todayShape,
  rotation: diningTables.todayRotation,
  takenOff: diningTables.takenOff,
  name: diningTables.todayName,
};
export function todaySet(
  values: Partial<Omit<TodayRow, "tableId">>,
): Partial<typeof diningTables.$inferInsert> {
  return {
    onFloor: true,
    ...Object.fromEntries(
      Object.entries(values).map(([key, value]) => [fields[key as keyof typeof values], value]),
    ),
  };
}
export const OFF_FLOOR = {
  onFloor: false,
  todaySeats: null,
  todayFixed: false,
  todayX: null,
  todayY: null,
  todayWidth: null,
  todayHeight: null,
  todayShape: null,
  todayRotation: null,
  takenOff: false,
  todayName: null,
};

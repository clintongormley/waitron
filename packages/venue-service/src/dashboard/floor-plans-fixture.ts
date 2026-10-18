import type { FloorPlanSetsModel } from "../floor-plan-set-types.js";

const layout = (zoneId: string, onPlan: number, spare: number) => ({ zoneId, onPlan, spare });

/** Casa Marina: Restaurant with three sets, Bar with an empty zone, Deli with no set. */
export function casaMarina(): FloorPlanSetsModel {
  return {
    departments: [
      {
        id: "restaurant",
        name: "Restaurant",
        zones: [
          { id: "inside", name: "Inside", tableCount: 13 },
          { id: "terrace", name: "Terrace", tableCount: 16 },
        ],
        sets: [
          {
            id: "standard",
            name: "Standard",
            isDefault: true,
            usedBy: [{ id: "lunch", name: "Lunch", colour: "blue" }],
            layouts: [layout("inside", 12, 0), layout("terrace", 10, 6)],
          },
          {
            id: "dinner",
            name: "Dinner",
            isDefault: false,
            usedBy: [{ id: "dinner-period", name: "Dinner", colour: "red" }],
            layouts: [layout("inside", 11, 0), layout("terrace", 8, 8)],
          },
          {
            id: "private",
            name: "Private party",
            isDefault: false,
            usedBy: [],
            layouts: [layout("inside", 4, 7), layout("terrace", 0, 16)],
          },
        ],
      },
      {
        id: "bar",
        name: "Bar",
        zones: [{ id: "bar-zone", name: "Bar", tableCount: 0 }],
        sets: [
          {
            id: "bar-standard",
            name: "Standard",
            isDefault: true,
            usedBy: [{ id: "all-day", name: "All day", colour: "green" }],
            layouts: [layout("bar-zone", 0, 0)],
          },
        ],
      },
      {
        id: "deli",
        name: "Deli",
        zones: [{ id: "deli-zone", name: "Deli", tableCount: 3 }],
        sets: [],
      },
    ],
  };
}

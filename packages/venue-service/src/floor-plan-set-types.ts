import type { CalendarColour } from "./hours-types.js";

export interface FloorPlanSetsModel {
  departments: {
    id: string;
    name: string;
    zones: { id: string; name: string; tableCount: number }[];
    sets: {
      id: string;
      name: string;
      isDefault: boolean;
      /** The default's includes the periods whose Floor plan field is empty. */
      usedBy: { id: string; name: string; colour: CalendarColour }[];
      layouts: { zoneId: string; onPlan: number; spare: number }[];
    }[];
  }[];
}

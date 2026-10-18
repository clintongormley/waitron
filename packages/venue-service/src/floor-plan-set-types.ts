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

/** A period's Floor plan choices: each department with a zone that has a table, and its sets in
 *  the order the Floor plans page lists them. */
export interface PeriodFloorPlans {
  departments: { id: string; sets: { id: string; name: string; isDefault: boolean }[] }[];
}

/** What deleting a set changes: the periods that name it, and the zones showing it today. */
export interface FloorPlanSetDeleteImpact {
  periods: { id: string; name: string }[];
  zonesShowing: { id: string; name: string }[];
}

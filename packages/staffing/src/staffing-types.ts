// Browser-safe and type-only: the dashboard reads its shapes from here, never from a server file.
import type { CalendarColour } from "@waitron/venue-service/hours-types";

export type { CalendarColour };

export interface StaffRole {
  id: string;
  name: string;
  colour: CalendarColour;
  position: number;
  holderIds: string[];
  blockCount: number;
  shiftCount: number;
}

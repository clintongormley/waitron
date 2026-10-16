import type { AllergenMap } from "@waitron/db";

export interface PartyAllergyGuest {
  id: string;
  position: number;
  who: string;
  allergens: AllergenMap;
  note: string | null;
}

export interface AllergyLineTick {
  guestId: string;
  draftLineId: string | null;
  workingLineId: string | null;
}

export interface PartyAllergySnapshot {
  answer: "none" | "allergies" | null;
  guests: PartyAllergyGuest[];
  ticks: AllergyLineTick[];
  changedBy: string | null;
  changedAt: string | null;
  revision: number;
}

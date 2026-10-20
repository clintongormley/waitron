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

export type AllergyLineRef =
  | { kind: "draft"; id: string }
  | { kind: "working"; id: string }
  | { kind: "submitted"; groupIndex: number; lineIndex: number };

export interface AllergyGuestInput {
  id?: string;
  who: string;
  allergens: AllergenMap;
  note: string | null;
}

export interface AllergyPatch {
  party?: { answer: "none" | "allergies"; guests: AllergyGuestInput[] };
  ticks: { line: AllergyLineRef; guestIndex: number | null }[];
}

export interface AllergyCommand {
  submissionId: string;
  expectedPartyRevision: number;
  allergy?: AllergyPatch;
}

export interface AllergyDish {
  line: AllergyLineRef;
  billId: string;
  name: string;
  quantity: string;
  allergens: AllergenMap | null;
  extras: { name: string; quantity: string; allergens: AllergenMap | null }[];
  sentAt: string | null;
  offeredBefore: boolean;
}

export interface PartyAllergyRead {
  partyId: string;
  snapshot: PartyAllergySnapshot;
  dishes: AllergyDish[];
}

export interface AllergyMoveRead {
  billId: string;
  tableId: string;
  partyId: string | null;
  snapshot: PartyAllergySnapshot | null;
  dishes: AllergyDish[];
}

export type AllergySendTarget =
  | { kind: "draft"; draftId: string; lineIds: string[] }
  | { kind: "lines"; orderId: string; lineNos: number[] }
  | { kind: "group"; groupId: string }
  | { kind: "held-line"; lineId: string }
  | { kind: "course"; orderId: string; courseId: string };

export interface AllergyChangeSet {
  partyId: string;
  before: PartyAllergySnapshot;
  after: PartyAllergySnapshot;
  workingLineIds: string[];
}

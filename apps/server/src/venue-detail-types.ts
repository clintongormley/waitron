import type { BusinessDayClock } from "@waitron/shared";
export interface VenueDetailValues {
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  timeZone: string;
  dayCutover: string;
}
export type VenueDetailField = keyof VenueDetailValues;
export type VenueDetailPatch = Partial<VenueDetailValues>;
export type DetailReason =
  | "sales"
  | "orders"
  | "daily_close"
  | "geography_context"
  | "current_details_only"
  | "holiday_geography"
  | "clock_effects"
  | "business_day_history";
export interface VenueDetailsModel {
  businessDayClock: BusinessDayClockModel;
  details: VenueDetailValues;
  issuer: { country: string; legalName: string; taxId: string };
  hasSales: boolean;
  hasOrderHistory: boolean;
  hasDailyClose: boolean;
  policy: Record<
    VenueDetailField,
    { decision: "allow" | "allow_with_warning" | "refuse"; reasons: DetailReason[] }
  >;
  provinces: { code: string; name: string }[];
}
export interface VenueDetailWrite {
  changes: VenueDetailPatch;
  expected: VenueDetailValues;
}

export interface VenueClockView {
  timeZone: string;
  dayCutover: string;
  civilDate: string;
  timeOfDay: string;
  businessDay: string;
  transitions: { at: string; civilDate: string; boundaryAt: string; boundaryTime: string }[];
}
export interface VenueClockPreview {
  at: string;
  current: VenueClockView | null;
  proposed: VenueClockView;
  backupDeadlines: { archive: string | null; cloud: string | null };
}

export interface BusinessDayClockModel {
  clock: BusinessDayClock;
  revision: number;
  currentBusinessDay: string | null;
  pending: null | {
    effectiveBusinessDay: string;
    dayCutover: string;
    startsAt: string;
    locksAt: string;
    editable: boolean;
  };
}
export interface BusinessDayStartInput {
  effectiveBusinessDay: string;
  dayCutover: string;
  expectedClockRevision: number;
}
export interface BusinessDayStartPreview {
  revision: number;
  previousDay: { businessDay: string; dayCutover: string; startAt: string; endAt: string };
  effectiveDay: { businessDay: string; dayCutover: string; startAt: string; endAt: string };
  locksAt: string;
  conflicts: readonly unknown[];
  conflictCount: number;
  backupDeadlines: VenueClockPreview["backupDeadlines"];
}

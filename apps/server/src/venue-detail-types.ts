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
  | "clock_effects";
export interface VenueDetailsModel {
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

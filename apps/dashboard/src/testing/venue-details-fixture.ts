import type { VenueDetailsModel, VenueDetailValues, VenueClockPreview } from "../api/client.js";

export function venueDetailsFixture(details: Partial<VenueDetailValues> = {}): VenueDetailsModel {
  return {
    details: {
      name: "Venue",
      addressLine1: "Calle Mayor 1",
      addressLine2: null,
      postalCode: "28001",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "06:00",
      ...details,
    },
    issuer: { country: "ES", legalName: "Issuer SL", taxId: "B12345678" },
    hasSales: false,
    hasOrderHistory: false,
    hasDailyClose: false,
    policy: {
      name: { decision: "allow_with_warning", reasons: ["current_details_only"] },
      addressLine1: { decision: "allow", reasons: [] },
      addressLine2: { decision: "allow", reasons: [] },
      postalCode: { decision: "allow_with_warning", reasons: ["current_details_only"] },
      city: { decision: "allow_with_warning", reasons: ["holiday_geography"] },
      province: { decision: "refuse", reasons: ["geography_context"] },
      timeZone: { decision: "allow_with_warning", reasons: ["clock_effects"] },
      dayCutover: { decision: "allow_with_warning", reasons: ["clock_effects"] },
    },
    provinces: [{ code: "28", name: "Madrid" }],
  };
}

export function venueClockPreviewFixture(): VenueClockPreview {
  return {
    at: "2026-10-06T02:00:00.000Z",
    current: {
      timeZone: "Europe/Madrid",
      dayCutover: "02:30",
      civilDate: "2026-10-06",
      timeOfDay: "04:00",
      businessDay: "2026-10-06",
      transitions: [
        {
          at: "2026-10-25T01:00:00.000Z",
          civilDate: "2026-10-25",
          boundaryAt: "2026-10-25T01:30:00.000Z",
          boundaryTime: "02:30",
        },
        {
          at: "2027-03-28T01:00:00.000Z",
          civilDate: "2027-03-28",
          boundaryAt: "2027-03-28T01:30:00.000Z",
          boundaryTime: "03:30",
        },
      ],
    },
    proposed: {
      timeZone: "UTC",
      dayCutover: "02:30",
      civilDate: "2026-10-06",
      timeOfDay: "02:00",
      businessDay: "2026-10-05",
      transitions: [],
    },
    backupDeadlines: { archive: "2026-10-06T03:36:00.000Z", cloud: null },
  };
}

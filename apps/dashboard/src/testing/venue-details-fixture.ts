import type { VenueDetailsModel, VenueDetailValues } from "../api/client.js";

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

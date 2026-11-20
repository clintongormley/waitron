import { classifySavedTimeZone } from "@waitron/shared";
import type { VenueDetailsModel, VenueDetailValues, VenueClockPreview } from "../api/client.js";

export function venueDetailsFixture(details: Partial<VenueDetailValues> = {}): VenueDetailsModel {
  const timeZone = details.timeZone ?? "Europe/Madrid";
  return {
    businessDayClock: {
      clock: {
        timeZone,
        dayCutover: details.dayCutover ?? "06:00",
        cutoverChanges: [],
      },
      revision: 0,
      currentBusinessDay: classifySavedTimeZone(timeZone).kind === "valid" ? "2026-10-06" : null,
      pending: null,
    },
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
    taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid",
    hasSales: false,
    hasOrderHistory: false,
    hasDailyClose: false,
    policy: {
      name: { decision: "allow_with_warning", reasons: ["current_details_only"] },
      addressLine1: { decision: "allow", reasons: [] },
      addressLine2: { decision: "allow", reasons: [] },
      postalCode:
        details.province === null
          ? { decision: "refuse", reasons: ["geography_context"] }
          : { decision: "allow_with_warning", reasons: ["current_details_only"] },
      city: { decision: "allow_with_warning", reasons: ["holiday_geography"] },
      province: { decision: "refuse", reasons: ["geography_context"] },
      timeZone: { decision: "allow_with_warning", reasons: ["clock_effects"] },
      dayCutover: { decision: "allow_with_warning", reasons: ["clock_effects"] },
    },
    provinces: [{ code: "28", name: "Madrid" }],
    timeZones: ["Europe/Madrid", "Atlantic/Canary"],
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
      timeZone: "Atlantic/Canary",
      dayCutover: "02:30",
      civilDate: "2026-10-06",
      timeOfDay: "03:00",
      businessDay: "2026-10-06",
      transitions: [],
    },
    backupDeadlines: { archive: "2026-10-06T03:36:00.000Z", cloud: null },
  };
}

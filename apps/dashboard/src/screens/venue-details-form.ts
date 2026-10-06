import type { VenueDetailPatch, VenueDetailValues, VenueDetailField } from "../api/client.js";

export const VENUE_DETAIL_FIELDS: readonly VenueDetailField[] = [
  "name",
  "addressLine1",
  "addressLine2",
  "postalCode",
  "city",
  "province",
  "timeZone",
  "dayCutover",
];
const CUTOVER = /^([01]\d|2[0-3]):[0-5]\d(?::00)?$/;

function normalized(field: VenueDetailField, value: string | null): string | null {
  if (value === null) return null;
  const text = value.normalize("NFC").trim();
  if (field === "addressLine2" && text === "") return null;
  if (field === "dayCutover" && CUTOVER.test(text)) return text.slice(0, 5);
  if (field === "timeZone") {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: text }).resolvedOptions().timeZone;
    } catch {
      return text;
    }
  }
  return text;
}

export function venueDetailPatch(
  saved: VenueDetailValues,
  draft: VenueDetailValues,
): VenueDetailPatch {
  const patch: VenueDetailPatch = {};
  for (const field of VENUE_DETAIL_FIELDS) {
    const value = normalized(field, draft[field]);
    const initial = normalized(field, saved[field]);
    if (value === initial || (initial === null && value === "")) continue;
    Object.assign(patch, { [field]: value });
  }
  return patch;
}

export function venueDetailProblems(
  patch: VenueDetailPatch,
): Partial<Record<VenueDetailField, string>> {
  const problems: Partial<Record<VenueDetailField, string>> = {};
  for (const field of VENUE_DETAIL_FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === null || value === "") {
      if (field !== "addressLine2") problems[field] = "required";
      continue;
    }
    if (["name", "addressLine1", "addressLine2", "city"].includes(field) && [...value].length > 200)
      problems[field] = "length";
    if (field === "dayCutover" && !CUTOVER.test(value)) problems[field] = "cutover";
    if (field === "timeZone") {
      try {
        const zone = new Intl.DateTimeFormat("en-GB", { timeZone: value }).resolvedOptions()
          .timeZone;
        if (/^[+-]/.test(zone)) problems[field] = "time_zone";
      } catch {
        problems[field] = "time_zone";
      }
    }
  }
  return problems;
}

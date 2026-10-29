import {
  parseUpdateSettings,
  parseUpdateSettingsDraft,
  policyError,
  safeInteger,
} from "./contracts.mjs";

/** @param {string} timeZone @param {string} clockDigest */
export function initialUpdateSettings(timeZone, clockDigest) {
  return parseUpdateSettings({
    version: 1,
    revision: 0,
    automatic: true,
    start: "03:00",
    end: "05:00",
    timeZone,
    clockDigest,
    clockReviewRequired: false,
  });
}

/** @param {unknown} current @param {unknown} draft @param {number} expectedRevision */
export function saveUpdateSettings(current, draft, expectedRevision) {
  const saved = parseUpdateSettings(current);
  const edit = parseUpdateSettingsDraft(draft);
  if (
    !safeInteger(expectedRevision) ||
    expectedRevision !== saved.revision ||
    expectedRevision === Number.MAX_SAFE_INTEGER
  )
    throw policyError("settings-revision");
  if (edit.reviewedClockDigest !== saved.clockDigest) throw policyError("clock-review");
  return {
    ...saved,
    revision: saved.revision + 1,
    automatic: edit.automatic,
    start: edit.start,
    end: edit.end,
    clockReviewRequired: false,
  };
}

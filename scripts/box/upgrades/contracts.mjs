/** @param {string} reason @param {string} [code] */
export function policyError(reason, code = "upgrade.invalid_settings") {
  return Object.assign(new Error(code), { code, reason });
}

/** @param {unknown} value @param {string[]} keys */
export function exactRecord(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** @param {unknown} value */
export function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/** @param {unknown} value */
export function digest(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/** @param {unknown} value */
function namedZone(value) {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(value)
  )
    return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** @param {unknown} start @param {unknown} end */
function hours(start, end) {
  if (start === null && end === null) return true;
  return (
    typeof start === "string" &&
    typeof end === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(start) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(end) &&
    start !== end
  );
}

/** @param {unknown} value @returns {UpdateSettings} */
export function parseUpdateSettings(value) {
  if (
    !exactRecord(value, [
      "version",
      "revision",
      "automatic",
      "start",
      "end",
      "timeZone",
      "clockDigest",
      "clockReviewRequired",
    ]) ||
    value.version !== 1 ||
    !safeInteger(value.revision) ||
    typeof value.automatic !== "boolean" ||
    !hours(value.start, value.end) ||
    !namedZone(value.timeZone) ||
    !digest(value.clockDigest) ||
    typeof value.clockReviewRequired !== "boolean"
  )
    throw policyError("settings-invalid");
  return { ...value };
}

/** @param {unknown} value @returns {UpdateSettingsDraft} */
export function parseUpdateSettingsDraft(value) {
  if (
    !exactRecord(value, ["automatic", "start", "end", "reviewedClockDigest"]) ||
    typeof value.automatic !== "boolean" ||
    !hours(value.start, value.end) ||
    !digest(value.reviewedClockDigest)
  )
    throw policyError("settings-invalid");
  return { ...value };
}

/**
 * Internal adapter envelope, not B3's signed wire format. The injected verifier
 * authenticates the manifest before this parser checks its usable inventory.
 * @param {unknown} value @param {string} source @param {string} platform @param {number} protocol
 */
export function parseVerifiedRelease(value, source, platform, protocol) {
  if (
    !exactRecord(value, [
      "releaseDigest",
      "sourceDigest",
      "platform",
      "minimumHostProtocol",
      "imageDigests",
      "requiresNewInstallation",
    ]) ||
    !digest(value.releaseDigest) ||
    value.sourceDigest !== source ||
    value.platform !== platform ||
    !safeInteger(value.minimumHostProtocol) ||
    value.minimumHostProtocol > protocol ||
    value.requiresNewInstallation !== false ||
    !Array.isArray(value.imageDigests) ||
    value.imageDigests.length === 0 ||
    value.imageDigests.length > 16 ||
    value.imageDigests.some(
      (item) => typeof item !== "string" || !/^sha256:[a-f0-9]{64}$/.test(item),
    ) ||
    new Set(value.imageDigests).size !== value.imageDigests.length
  )
    throw policyError("release-incompatible", "upgrade.invalid_release");
  return Object.freeze({ ...value, imageDigests: Object.freeze([...value.imageDigests]) });
}

/** @param {unknown} value @param {string} releaseDigest @param {number} nowMs */
export function parseHoldAnswer(value, releaseDigest, nowMs) {
  if (
    !exactRecord(value, ["kind", "releaseDigest", "checkedAt", "expiresAt", "proofDigest"]) ||
    !["clear", "held"].includes(value.kind) ||
    value.releaseDigest !== releaseDigest ||
    !safeInteger(value.checkedAt) ||
    !safeInteger(value.expiresAt) ||
    value.checkedAt > nowMs ||
    value.expiresAt <= nowMs ||
    !digest(value.proofDigest)
  )
    throw policyError("hold-unknown", "upgrade.invalid_hold");
  return Object.freeze({ ...value });
}

/**
 * @typedef {object} UpdateSettings
 * @property {1} version
 * @property {number} revision
 * @property {boolean} automatic
 * @property {string|null} start
 * @property {string|null} end
 * @property {string} timeZone
 * @property {string} clockDigest
 * @property {boolean} clockReviewRequired
 * @typedef {object} UpdateSettingsDraft
 * @property {boolean} automatic
 * @property {string|null} start
 * @property {string|null} end
 * @property {string} reviewedClockDigest
 */

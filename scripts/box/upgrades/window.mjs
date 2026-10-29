import { parseUpdateSettings, policyError } from "./contracts.mjs";

/** @param {object} local @param {string} zone */
function endpoint(local, zone) {
  const earlier = local.toZonedDateTime(zone, { disambiguation: "earlier" });
  const later = local.toZonedDateTime(zone, { disambiguation: "later" });
  if (earlier.epochMilliseconds === later.epochMilliseconds)
    return { ms: earlier.epochMilliseconds };
  return { reason: earlier.toPlainDateTime().equals(local) ? "endpoint-fold" : "endpoint-gap" };
}

/** @param {unknown} input @param {string} startDate */
export function resolveUpdateWindow(input, startDate) {
  const saved = parseUpdateSettings(input);
  let date;
  try {
    if (typeof startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate))
      throw policyError("window-date");
    date = globalThis.Temporal.PlainDate.from(startDate, { overflow: "reject" });
  } catch {
    throw policyError("window-date");
  }
  if (saved.clockReviewRequired) return { kind: "skip", reason: "clock-review" };
  if (saved.start === null) return { kind: "skip", reason: "window-unset" };
  const start = endpoint(date.toPlainDateTime(saved.start), saved.timeZone);
  const endDate = saved.end < saved.start ? date.add({ days: 1 }) : date;
  const end = endpoint(endDate.toPlainDateTime(saved.end), saved.timeZone);
  if (start.reason || end.reason) return { kind: "skip", reason: start.reason ?? end.reason };
  if (start.ms < 0 || end.ms <= start.ms) throw policyError("window-date");
  return {
    kind: "resolved",
    occurrence: {
      id: `${startDate}/${saved.timeZone}/${saved.revision}`,
      startDate,
      zone: saved.timeZone,
      revision: saved.revision,
      startMs: start.ms,
      endMs: end.ms,
    },
  };
}

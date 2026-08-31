/** The order-age escalation band for a KDS line/order/table. See the order-timing-alerts spec. */
export type TimingBand = "fresh" | "warm" | "overdue" | "forgotten";

export interface StationThresholds {
  warmAfterMinutes: number;
  overdueAfterMinutes: number;
  forgottenAfterMinutes: number;
}

export const BAND_RANK: Record<TimingBand, number> = {
  fresh: 0,
  warm: 1,
  overdue: 2,
  forgotten: 3,
};

/** Classify a line's age (now − queuedAt, in minutes) against its station's thresholds. At-threshold
 * counts as the higher band; a future queuedAt (clock skew) clamps to fresh. */
export function classifyBand(queuedAtMs: number, nowMs: number, t: StationThresholds): TimingBand {
  const elapsedMin = Math.max(0, (nowMs - queuedAtMs) / 60_000);
  if (elapsedMin >= t.forgottenAfterMinutes) return "forgotten";
  if (elapsedMin >= t.overdueAfterMinutes) return "overdue";
  if (elapsedMin >= t.warmAfterMinutes) return "warm";
  return "fresh";
}

/** The worst (highest-ranked) band in a set; fresh when empty. */
export function worstBand(bands: Iterable<TimingBand>): TimingBand {
  let worst: TimingBand = "fresh";
  for (const b of bands) if (BAND_RANK[b] > BAND_RANK[worst]) worst = b;
  return worst;
}

// Pure next-fire math for the backup sweep's wall-clock cadence (BR-1 Task 3). No timezone library:
// the local wall-clock parts of an instant come from `Intl.DateTimeFormat` in the venue's IANA zone,
// and the inverse (the epoch ms of a given local Y-M-D H:M) is resolved by a two-step fixed point over
// the offset the zone reports at the guess. A DST spring-forward hour that does not exist locally
// therefore resolves forward to the first instant that does (never landing inside the skipped hour),
// and a fall-back repeated hour resolves to one of the two — either is a valid fire. `nextFireMs`
// returns ONE absolute instant even when it is more than MAX_SLEEP_MS away; the loop sleeps toward it
// in <=1h chunks and recomputes, so a clock/tz/cutover change is picked up between chunks.

import { createHash } from "node:crypto";
import type { BackupSchedule } from "./backup-config.js";

export interface ScheduleClock {
  timeZone: string;
  /** "HH:MM" — the venue's business-day cutover, the anchor `at: "auto"` schedules off. */
  dayCutover: string;
}

export const AUTO_MARGIN_MINUTES = 30;
/** 1h cap on a single sleep: the loop wakes at least hourly to recompute the next fire, so a clock,
 * timezone or cutover change mid-wait is picked up rather than slept through. */
export const MAX_SLEEP_MS = 60 * 60 * 1000;
const AUTO_JITTER_MINUTES = 10;

/** Local wall-clock parts of an instant in a tz, via Intl (no tz dependency). */
function localParts(at: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday as string]!;
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    weekday: wd,
  };
}

/** The epoch ms of a given local Y-M-D H:M in tz. Resolves by fixed-point over the tz offset. */
function instantOfLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  // Start from the UTC guess, then correct by the offset the tz reports at that guess.
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const actual = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    guess += Date.UTC(year, month - 1, day, hour, minute, 0) - actual;
  }
  return guess;
}

function jitterMinutes(seed: string): number {
  const h = createHash("sha256").update(seed).digest();
  return h[0] % (AUTO_JITTER_MINUTES + 1); // 0..10, stable per seed
}

/**
 * The absolute epoch ms of the next fire for `schedule`, computed against the venue's wall clock. An
 * `interval` schedule is simply `now + ms`. A `wall-clock` schedule resolves the target local time
 * (`at.hour:at.minute`, or `dayCutover + AUTO_MARGIN_MINUTES + a node-stable jitter` for `"auto"`) and
 * scans today..+7 for the next allowed local day whose fire instant is strictly in the future.
 */
export function nextFireMs(
  schedule: BackupSchedule,
  clock: ScheduleClock,
  now: Date,
  jitterSeed: string,
): number {
  if (schedule.kind === "interval") return now.getTime() + schedule.ms;

  let hour: number;
  let minute: number;
  if (schedule.at === "auto") {
    const [ch, cm] = clock.dayCutover.split(":").map(Number);
    const total = ch * 60 + cm + AUTO_MARGIN_MINUTES + jitterMinutes(jitterSeed);
    hour = Math.floor(total / 60) % 24;
    minute = total % 60;
  } else {
    hour = schedule.at.hour;
    minute = schedule.at.minute;
  }

  const allowed = (wd: number) => schedule.days === "daily" || schedule.days.includes(wd);
  // Scan today..+7 for the next allowed local day whose fire instant is strictly in the future.
  for (let add = 0; add <= 7; add++) {
    const base = localParts(new Date(now.getTime() + add * 86400000), clock.timeZone);
    if (!allowed(base.weekday)) continue;
    const fire = instantOfLocal(base.year, base.month, base.day, hour, minute, clock.timeZone);
    if (fire > now.getTime()) return fire;
  }
  // Fallback: 24h out (defensive; the 7-day scan should always find one).
  return now.getTime() + 86400000;
}

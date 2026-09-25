import { createHash } from "node:crypto";
import type { BackupSchedule } from "./backup-config.js";

export interface ScheduleClock {
  timeZone: string;
  /** "HH:MM", the anchor `at: "auto"` schedules off. */
  dayCutover: string;
}

export const AUTO_MARGIN_MINUTES = 30;
/** The longest single sleep, so a clock jump is noticed within the hour. */
export const MAX_SLEEP_MS = 60 * 60 * 1000;
const AUTO_JITTER_MINUTES = 10;

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

function instantOfLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
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
  return h[0] % (AUTO_JITTER_MINUTES + 1);
}

/** `"auto"` fires at the day cutover plus `AUTO_MARGIN_MINUTES` plus a jitter stable per seed. */
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
  // Steps the local CIVIL date, not elapsed 24h: a spring-forward day is shorter than 24h, and
  // elapsed days can skip its date and could jump a week past an allowed weekday.
  const start = localParts(now, clock.timeZone);
  for (let add = 0; add <= 7; add++) {
    const civil = new Date(Date.UTC(start.year, start.month - 1, start.day + add));
    if (!allowed(civil.getUTCDay())) continue;
    const fire = instantOfLocal(
      civil.getUTCFullYear(),
      civil.getUTCMonth() + 1,
      civil.getUTCDate(),
      hour,
      minute,
      clock.timeZone,
    );
    if (fire > now.getTime()) return fire;
  }
  // Reached when no weekday is allowed.
  return now.getTime() + 86400000;
}

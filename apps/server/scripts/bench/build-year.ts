import { VENUE_FILE, WAL_SUFFIX, SHM_SUFFIX } from "@waitron/store";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { quoteIdent } from "@waitron/provisioning";
import { businessDayBounds } from "@waitron/shared";
import { installBenchClock } from "./bench-clock.js";
import { openBenchVenue, type BenchVenue } from "./bench-venue.js";
import { BENCH_PROFILE } from "./profile.js";
import { runtime } from "./runtime.js";
import { tradeDay, type DayResult } from "./trading-day.js";

export const WORKING_DIR = "venue";
export const COPY_DIR = "last-day";
export const SESSION_FILE = "bench-session.json";
export const VOLUME_FILE = "volume.json";
export const REQUEST_TIMINGS_FILE = "request-timings.jsonl";

export interface BuildYearOptions {
  /** An absolute folder outside the repository; the build owns everything in it. */
  out: string;
  days?: number;
  billsPerDay?: number;
  seed?: number;
  /** Called before each bill is seated, with the day's number from 1; a throw stops the build. */
  beforeBill?: (day: number, index: number) => void | Promise<void>;
  /** Called once a day's copy is in place, before the session counts it; a throw stops the build. */
  beforeSession?: (day: number) => void;
  /** Called after each day is finished and copied, with the day's time including the copy. */
  onDay?: (day: number, result: DayResult, ms: number) => void;
}

/** What `last-day/` holds: device tokens are stored hashed, so their cookies are kept here. */
export interface BenchSession {
  day: number;
  date: string;
  seed: number;
  billsPerDay: number;
  /** The bench clock when the day finished; a resume starts its clock here. */
  clockAt: string;
  deviceCookies: Record<string, string>;
}

/**
 * Trades `days` days into `out/venue`, copying the folder to `out/last-day` after each finished
 * day. A run that finds a session resumes from that copy: a stopped day's rows cannot be removed
 * from the append-only tables, so the working folder is always discarded, never traded on.
 */
export async function buildYear(options: BuildYearOptions): Promise<void> {
  const days = options.days ?? BENCH_PROFILE.days;
  const billsPerDay = options.billsPerDay ?? BENCH_PROFILE.billsPerDay;
  const seed = options.seed ?? 1;
  const working = join(options.out, WORKING_DIR);
  const session = readSession(options.out);
  if (session !== undefined) refuseOtherSettings(options.out, session, { days, billsPerDay, seed });

  dropUncountedTimings(options.out, session?.day ?? 0);
  rmSync(working, { recursive: true, force: true });
  if (session !== undefined) copyFolder(sessionCopy(options.out, session), working);
  // A folder holding fewer days than its volume.json describes must not pass for a finished build.
  if ((session?.day ?? 0) < days) rmSync(join(options.out, VOLUME_FILE), { force: true });

  const clock = installBenchClock(
    session === undefined ? new Date(dayBounds(dateOf(1)).startAt) : new Date(session.clockAt),
  );
  try {
    const venue = await openBenchVenue(working, {
      seed,
      ...(session === undefined ? {} : { deviceCookies: session.deviceCookies }),
    });
    try {
      for (let day = (session?.day ?? 0) + 1; day <= days; day++) {
        const started = performance.now();
        const result = await tradeDay(venue, dateOf(day), billsPerDay, {
          beforeBill: (index) => options.beforeBill?.(day, index),
        });
        const copying = performance.now();
        let dayMs = 0;
        await checkpoint(
          options.out,
          venue,
          {
            day,
            date: dateOf(day),
            seed,
            billsPerDay,
            clockAt: clock.now().toISOString(),
            deviceCookies: venue.deviceCookies(),
          },
          () => {
            const now = performance.now();
            dayMs = now - started;
            // `day` stays first: `dropUncountedTimings` reads it from the line's start.
            const line = {
              day,
              ...runtime(),
              date: dateOf(day),
              bills: result.bills.length,
              dayMs,
              checkpointMs: now - copying,
              routes: result.requestTimings,
            };
            appendFileSync(join(options.out, REQUEST_TIMINGS_FILE), `${JSON.stringify(line)}\n`);
            options.beforeSession?.(day);
          },
        );
        options.onDay?.(day, result, dayMs);
      }
    } finally {
      await venue.close();
    }
    writeVolume(options.out, { seed, days, billsPerDay });
  } finally {
    clock.uninstall();
  }
}

function refuseOtherSettings(
  out: string,
  session: BenchSession,
  wanted: { days: number; billsPerDay: number; seed: number },
): void {
  if (session.seed !== wanted.seed)
    throw new Error(`bench: ${out} was built with seed ${session.seed}, not ${wanted.seed}`);
  if (session.billsPerDay !== wanted.billsPerDay)
    throw new Error(
      `bench: ${out} was built with ${session.billsPerDay} bills a day, not ${wanted.billsPerDay}`,
    );
  if (session.day > wanted.days)
    throw new Error(
      `bench: ${out} has finished ${session.day} days, more than --days ${wanted.days}`,
    );
}

function dateOf(day: number): string {
  const at = new Date(`${BENCH_PROFILE.startDate}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + day - 1);
  return at.toISOString().slice(0, 10);
}

function dayBounds(date: string) {
  return businessDayBounds(
    { timeZone: BENCH_PROFILE.timeZone, dayCutover: BENCH_PROFILE.dayCutover, cutoverChanges: [] },
    date,
  );
}

/**
 * A day's timing line is written just before the session counts that day, so a stop between the
 * two leaves a line for a day the resume trades again. Only then is the file rewritten.
 */
function dropUncountedTimings(out: string, lastDay: number): void {
  const path = join(out, REQUEST_TIMINGS_FILE);
  if (!existsSync(path)) return;
  const whole = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
  const counted = whole.filter(
    (line) => Number(/^\{"day":(\d+),/.exec(line)?.[1] ?? Infinity) <= lastDay,
  );
  if (counted.length === whole.length) return;
  writeFileSync(`${path}.tmp`, counted.map((line) => `${line}\n`).join(""));
  renameSync(`${path}.tmp`, path);
}

function readSession(out: string): BenchSession | undefined {
  const path = join(out, SESSION_FILE);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as BenchSession;
}

/**
 * `last-day/`, once it holds the session's day. A stop after `checkpoint` moves `last-day/` aside
 * and before it writes the session leaves the session's day only in `last-day.old/`, which the next
 * checkpoint would delete, so it is moved back.
 */
function sessionCopy(out: string, session: BenchSession): string {
  const copy = join(out, COPY_DIR);
  const found = copyFor(out, session);
  if (found !== copy) {
    rmSync(copy, { recursive: true, force: true });
    renameSync(found, copy);
  }
  return copy;
}

/** The copy whose venue's last close is the session's day, whichever name it is under. */
function copyFor(out: string, session: BenchSession): string {
  const copy = join(out, COPY_DIR);
  const found: string[] = [];
  for (const candidate of [copy, `${copy}.old`]) {
    if (!existsSync(join(candidate, VENUE_FILE))) continue;
    const last = readVenue(candidate, (db) => {
      const row = db.prepare("select max(business_day) as day from daily_closes").get() as {
        day: string | null;
      };
      return row.day;
    });
    if (last === session.date) return candidate;
    found.push(`${candidate} ends on ${last ?? "no close"}`);
  }
  throw new Error(
    `bench: no copy ends on day ${session.date}: ${found.join("; ") || "none found"}`,
  );
}

function readVenue<T>(dir: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(join(dir, VENUE_FILE), { readOnly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

export function copyFolder(from: string, to: string): void {
  const args =
    process.platform === "darwin" ? ["-c", "-R", from, to] : ["--reflink=auto", "-R", from, to];
  execFileSync("cp", args);
}

/**
 * Replaces `last-day/` with a copy of the open working folder, then the session. Once a session
 * exists, expects `last-day/` to hold its day. A stop at any point leaves a copy of the day the
 * session names: at `last-day/`, or, after the swap and before the session, at `last-day.old/`.
 */
async function checkpoint(
  out: string,
  venue: BenchVenue,
  session: BenchSession,
  beforeSession: () => void,
): Promise<void> {
  const copy = join(out, COPY_DIR);
  const next = `${copy}.next`;
  const old = `${copy}.old`;
  rmSync(next, { recursive: true, force: true });
  await venue.checkpoint();
  // Nothing runs between the checkpoint and this synchronous copy, so no write can land in a
  // write-ahead file the copy then leaves out.
  copyFolder(join(out, WORKING_DIR), next);
  for (const name of readdirSync(next))
    if (name.endsWith(WAL_SUFFIX) || name.endsWith(SHM_SUFFIX)) rmSync(join(next, name));
  rmSync(old, { recursive: true, force: true });
  if (existsSync(copy)) renameSync(copy, old);
  renameSync(next, copy);
  beforeSession();
  writeAtomically(join(out, SESSION_FILE), session);
  rmSync(old, { recursive: true, force: true });
}

function writeAtomically(path: string, value: unknown): void {
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}

/** Counts read-only, since an open through the routes would add its own session rows. */
function writeVolume(
  out: string,
  build: { seed: number; days: number; billsPerDay: number },
): void {
  const working = join(out, WORKING_DIR);
  const rows = readVenue(working, (db) => {
    const tables = db
      .prepare(
        "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
      )
      .all() as { name: string }[];
    const counts: Record<string, number> = {};
    for (const { name } of tables)
      counts[name] = (
        db.prepare(`select count(*) as n from ${quoteIdent(name)}`).get() as { n: number }
      ).n;
    return counts;
  });
  writeAtomically(join(out, VOLUME_FILE), {
    ...runtime(),
    rows,
    totalRows: Object.values(rows).reduce((sum, n) => sum + n, 0),
    databaseBytes: statSync(join(working, VENUE_FILE)).size,
    seed: build.seed,
    gitCommit: gitCommit(),
    profile: { ...BENCH_PROFILE, days: build.days, billsPerDay: build.billsPerDay },
  });
}

export function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dirname(fileURLToPath(import.meta.url)),
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

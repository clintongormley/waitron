import { execFileSync } from "node:child_process";
import {
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
import { tradeDay, type DayResult } from "./trading-day.js";

export const WORKING_DIR = "venue";
export const COPY_DIR = "last-day";
export const SESSION_FILE = "bench-session.json";
export const VOLUME_FILE = "volume.json";
const VENUE_FILE = "venue.db";

export interface BuildYearOptions {
  /** An absolute folder outside the repository; the build owns everything in it. */
  out: string;
  days?: number;
  billsPerDay?: number;
  seed?: number;
  /** Called before each bill is seated, with the day's number from 1; a throw stops the build. */
  beforeBill?: (day: number, index: number) => void | Promise<void>;
  /** Called after each day is finished and copied, with the day's time including the copy. */
  onDay?: (day: number, result: DayResult, ms: number) => void;
}

/** What `last-day/` holds: device tokens are stored hashed, so their cookies are kept here. */
export interface BenchSession {
  day: number;
  date: string;
  seed: number;
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
  if (session !== undefined && session.seed !== seed)
    throw new Error(`bench: ${options.out} was built with seed ${session.seed}, not ${seed}`);

  rmSync(working, { recursive: true, force: true });
  if (session !== undefined) copyFolder(copyFor(options.out, session), working);

  const clock = installBenchClock(
    session === undefined ? new Date(dayBounds(dateOf(1)).startAt) : new Date(session.clockAt),
  );
  try {
    // Opened once for the whole build: each open starts attendance discovery again from the first
    // row of history, which makes every later day slower.
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
        await checkpoint(options.out, venue, {
          day,
          date: dateOf(day),
          seed,
          clockAt: clock.now().toISOString(),
          deviceCookies: venue.deviceCookies(),
        });
        options.onDay?.(day, result, performance.now() - started);
      }
    } finally {
      await venue.close();
    }
    writeVolume(options.out, { seed, days, billsPerDay });
  } finally {
    clock.uninstall();
  }
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

function readSession(out: string): BenchSession | undefined {
  const path = join(out, SESSION_FILE);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as BenchSession;
}

/**
 * The copy that holds the session's day. A stop while `checkpoint` swaps the copies can leave the
 * session naming the copy now at `last-day.old`, so the venue's last close decides, not the name.
 */
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
 * Replaces `last-day/` with a copy of the open working folder, then the session. A stop at any
 * point leaves either the old pair or the new one: the copy is made under another name first, and
 * the session names the day the copy holds only once the copy is in place.
 */
async function checkpoint(out: string, venue: BenchVenue, session: BenchSession): Promise<void> {
  const copy = join(out, COPY_DIR);
  const next = `${copy}.next`;
  const old = `${copy}.old`;
  rmSync(next, { recursive: true, force: true });
  await venue.checkpoint();
  // Nothing runs between the checkpoint and this synchronous copy, so no write can land in a
  // write-ahead file the copy then leaves out.
  copyFolder(join(out, WORKING_DIR), next);
  for (const name of readdirSync(next))
    if (name.endsWith("-wal") || name.endsWith("-shm")) rmSync(join(next, name));
  rmSync(old, { recursive: true, force: true });
  if (existsSync(copy)) renameSync(copy, old);
  renameSync(next, copy);
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

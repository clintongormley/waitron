import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { shifts } from "./schema/shifts.js";

/**
 * A shift's local wall date as `YYYY-MM-DD` — its stored UTC instant moved by its own wall offset.
 *
 * An unparseable `starts_at` gives NULL, not an error, so that row drops silently out of any window
 * built on this. The columns render as `"shifts"."starts_at"`, so a query using this fragment must
 * name the table `shifts` without an alias.
 */
export const shiftLocalDate: SQL = sql`date(${shifts.startsAt}, ${shifts.startsOffsetMinutes} || ' minutes')`;

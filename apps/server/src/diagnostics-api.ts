import type { Context, Hono } from "hono";
import { AppError } from "@waitron/shared";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { LOG_LEVELS, type LogLevel, type Logger } from "./logger.js";
import { maskPersonalData } from "./log-personal-data.js";
import { redactSecrets } from "./redact-secrets.js";
import { venueTimeZoneIn } from "./venue-time-zone.js";
import type { LogReader } from "./log-file.js";
import type { VerbosityController } from "./verbosity.js";
// This file THROWS `diagnostics.invalid_verbosity`, so it imports the host error registry.
import "./errors.js";

/**
 * Everything the dashboard's diagnostics HTTP routes need. The surface reads and writes only this
 * box's own records, so it wires no fiscal backend. `reader` reads back the box's rotating log files;
 * `verbosity` is the in-memory controller the logger reads `current()` from at each call.
 */
export interface DiagnosticsApiDeps {
  db: Database;
  reader: LogReader;
  verbosity: VerbosityController;
  now: () => Date;
}

const STATUS = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "diagnostics.invalid_verbosity": 400,
} as const;

/** The two levels an operator may raise diagnostic verbosity TO — `debug` (the point of the toggle)
 * and `info` (to drop back manually). `warn`/`error` are never a diagnostics target. */
const ALLOWED_LEVELS: readonly LogLevel[] = ["debug", "info"];
/** The verbosity window's bounds, in minutes: at least 1, at most 120 — debug is never left on
 * indefinitely (the verbosity controller reverts in-memory, but the bound keeps a single window short). */
const MIN_TTL_MINUTES = 1;
const MAX_TTL_MINUTES = 120;
/** The recent-log tail's bounds and default: clamp a caller's `?limit=` into `1..1000`, default 200. */
const MIN_LIMIT = 1;
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;
const ALL_LEVELS_WINDOW_MS = 5 * 60_000;
const LEVEL_RANK = new Map([...Object.entries(LOG_LEVELS), ["trace", 0], ["fatal", 50]]);

function maskLogField(key: string, value: unknown): unknown {
  const masked = maskPersonalData(key, value);
  return typeof masked === "string" ? redactSecrets(masked) : masked;
}

/**
 * Mounts the dashboard's diagnostics routes on an existing Hono app: read the recent log tail,
 * read the current verbosity, and raise verbosity for a bounded window. All three are gated
 * behind `system.manage` — `requireManagementSession` first (401 before any DB work), then
 * `authorizeManager` under `withTransaction`. Each handler is wrapped in the shared `run` boundary
 * so the whole surface maps errors identically.
 */
export function mountDiagnosticsApi(app: Hono, deps: DiagnosticsApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "diagnostics.failed");

  // The one authorize gate every route runs its request through: refuse an unauthenticated/forged
  // session (401) first, then open a transaction and confirm the session carries
  // `system.manage` (403 otherwise).
  const authorizedRead = <T>(c: Context, read: (tx: Transaction) => T | Promise<T>) => {
    const sessionId = requireManagementSession(c);
    return withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: "system.manage",
      });
      return read(tx);
    });
  };

  // Read the recent log tail. `?limit=` is clamped into `1..1000` (default 200): absent, empty, or
  // non-numeric text falls back to the default, and a finite value is truncated and bounded — so a
  // crafted limit can neither read nothing nor ask the reader for an unbounded slice.
  app.get("/management-api/diagnostics/recent", (c) =>
    run(c, log, async () => {
      const timeZone = await authorizedRead(c, venueTimeZoneIn);
      const q = c.req.query("limit");
      const raw = q === undefined || q === "" ? Number.NaN : Number(q);
      const limit = Number.isFinite(raw)
        ? Math.min(Math.max(Math.trunc(raw), MIN_LIMIT), MAX_LIMIT)
        : DEFAULT_LIMIT;
      const filter = c.req.query("level");
      const minimum = filter === "error" || filter === "info" ? filter : "warn";
      const cutoff =
        filter === "all" ? deps.now().getTime() - ALL_LEVELS_WINDOW_MS : Number.NEGATIVE_INFINITY;
      const tail = deps.reader
        .recent({ limit: MAX_LIMIT })
        .filter(
          (line) =>
            typeof line?.event === "string" &&
            typeof line.level === "string" &&
            typeof line.at === "string" &&
            Number.isFinite(Date.parse(line.at)),
        );
      const lines = tail
        .filter((line) =>
          filter === "all"
            ? Date.parse(line.at) >= cutoff
            : (LEVEL_RANK.get(line.level) ?? -1) >= LOG_LEVELS[minimum],
        )
        .slice(-limit);
      const oldestScannedAt = tail.length
        ? new Date(
            Math.max(cutoff, Math.min(...tail.map((line) => Date.parse(line.at)))),
          ).toISOString()
        : null;
      // A rotated file may predate the write-time masks.
      return c.body(
        JSON.stringify(
          {
            lines,
            timeZone,
            oldestScannedAt,
          },
          maskLogField,
        ),
        200,
        { "content-type": "application/json" },
      );
    }),
  );

  // Read the current verbosity level and when (if ever) it auto-reverts. `revertsAt` is an ISO string
  // while a raised window is active, or `null` when the level is the default with no pending revert.
  app.get("/management-api/diagnostics/verbosity", (c) =>
    run(c, log, async () => {
      await authorizedRead(c, () => undefined);
      return c.json({
        level: deps.verbosity.current(),
        revertsAt: deps.verbosity.revertsAt()?.toISOString() ?? null,
      });
    }),
  );

  // Raise verbosity to `level` for `ttlMinutes`. The body is validated on the server (the client is
  // never the gate): a `level` outside {debug,info} or a `ttlMinutes` outside `1..120` is refused as
  // `diagnostics.invalid_verbosity` naming the FIXED reason (`"level"`/`"ttl"`), never the raw input.
  app.post("/management-api/diagnostics/verbosity", (c) =>
    run(c, log, async () => {
      await authorizedRead(c, () => undefined);
      // `readJsonBody` (not `c.req.json()`) so an empty/malformed body coerces to `{}` and the field
      // guards below reject it as a clean 400 `diagnostics.invalid_verbosity`, never an opaque 500.
      const body = await readJsonBody<{ level?: unknown; ttlMinutes?: unknown }>(c);
      const level = body.level;
      if (typeof level !== "string" || !ALLOWED_LEVELS.includes(level as LogLevel)) {
        throw new AppError("diagnostics.invalid_verbosity", { reason: "level" });
      }
      const ttl = body.ttlMinutes;
      if (
        typeof ttl !== "number" ||
        !Number.isFinite(ttl) ||
        ttl < MIN_TTL_MINUTES ||
        ttl > MAX_TTL_MINUTES
      ) {
        throw new AppError("diagnostics.invalid_verbosity", { reason: "ttl" });
      }
      deps.verbosity.raise(level as LogLevel, ttl * 60_000);
      return c.body(null, 204);
    }),
  );
}

import type { Context, Hono } from "hono";
import { AppError } from "@waitron/shared";
import { asAppUser, withTenant, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { requireManagementSession } from "./management-session.js";
import type { LogLevel, Logger } from "./logger.js";
import type { LogReader } from "./log-file.js";
import type { VerbosityController } from "./verbosity.js";
// This file THROWS `diagnostics.invalid_verbosity`, so it imports the host error registry directly,
// the "every file that throws one of these imports ./errors.js" convention errors.ts states.
import "./errors.js";

/**
 * Everything the dashboard's diagnostics HTTP routes need. Like `ManagementApiDeps`, the surface reads
 * and writes only the tenant's own records, so it wires no fiscal backend or clock. `cfg.tenantId` is
 * the dashboard's own tenant (provisioning stamped it), scoping the `withTenant` authorize gate below.
 * `reader` reads back the box's rotating log files; `verbosity` is the in-memory controller `boot.ts`
 * built and the logger reads its `current()` at each call (which also owns its own default level).
 */
export interface DiagnosticsApiDeps {
  db: Database;
  cfg: { tenantId: string };
  reader: LogReader;
  verbosity: VerbosityController;
}

/**
 * Every AppError CODE the diagnostics API answers, and the HTTP status it maps to — the diagnostics
 * parallel of management-api.ts's `STATUS`. `management_session.required` (401, an absent/forged
 * cookie) and `authorization.not_permitted` (403, a session that holds no `diagnostics.view`) come
 * from the shared authorize gate; `diagnostics.invalid_verbosity` (400) is this surface's own
 * request-shape fault. A registered code absent here would default to 400 in the boundary.
 */
const STATUS = {
  "management_session.required": 401,
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

/**
 * Mounts the dashboard's diagnostics routes on an existing Hono app: read the recent log tail, read the
 * current verbosity, and raise verbosity for a bounded window. All three are gated behind
 * `diagnostics.view` — `requireManagementSession` first (401 before any DB work), then
 * `authorizeManager` under `withTenant` + `asAppUser` so RLS scopes the gate to this dashboard's own
 * tenant, mirroring `mountManagementApi`'s layout-`GET` shape. Each handler is wrapped in the shared
 * `run` boundary so the whole surface maps errors identically.
 */
export function mountDiagnosticsApi(app: Hono, deps: DiagnosticsApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "diagnostics.failed");

  // The one authorize gate every route runs its request through: refuse an unauthenticated/forged
  // session (401) first, then open a tenant-scoped transaction as the app role and confirm the
  // session carries `diagnostics.view` (403 otherwise). Extracted so the gate is applied identically
  // in exactly one place — the `withVenueAuth` seam management-api.ts uses.
  const authorize = async (c: Context): Promise<void> => {
    const sessionId = requireManagementSession(c);
    await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: "diagnostics.view",
      });
    });
  };

  // Read the recent log tail. `?limit=` is clamped into `1..1000` (default 200): absent, empty, or
  // non-numeric text falls back to the default, and a finite value is truncated and bounded — so a
  // crafted limit can neither read nothing nor ask the reader for an unbounded slice.
  app.get("/management-api/diagnostics/recent", (c) =>
    run(c, log, async () => {
      await authorize(c);
      const q = c.req.query("limit");
      const raw = q === undefined || q === "" ? Number.NaN : Number(q);
      const limit = Number.isFinite(raw)
        ? Math.min(Math.max(Math.trunc(raw), MIN_LIMIT), MAX_LIMIT)
        : DEFAULT_LIMIT;
      return c.json({ lines: deps.reader.recent({ limit }) });
    }),
  );

  // Read the current verbosity level and when (if ever) it auto-reverts. `revertsAt` is an ISO string
  // while a raised window is active, or `null` when the level is the default with no pending revert.
  app.get("/management-api/diagnostics/verbosity", (c) =>
    run(c, log, async () => {
      await authorize(c);
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
      await authorize(c);
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

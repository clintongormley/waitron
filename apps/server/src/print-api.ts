// Side-effect only: loads this host's errors.ts augmentation for the apps/server code THESE routes
// throw directly — `management.request_invalid` (the body/query screens, via `request-screens.js` and
// the local field screens). The enrol flood guard (`enrol-rate-limit.js`, which carries its own
// errors.js) is built HERE with this surface's own `agent.pairing_rate_limited` code, so a rate-limited
// enrol answers in the `agent.*` namespace directly (no catch-and-translate) and `device.*` never
// appears on this surface. The printing codes this surface answers —
// `printer.*`/`agent.*`, `agent.pairing_rate_limited` included — are declared in
// @waitron/printing's own errors.ts and reach here through the VALUE imports of its verbs below
// (enrolAgent/generateAgentCode/createPrinter/updatePrinter/deactivatePrinter/claimPrintJobs/
// reportPrintJob and, transitively, requireAgent's authenticateAgent); `shared.invalid_id` (thrown by
// `requireUuidParam`) loads via the AppError value import. The device-api sibling relies on the same
// transitive reachability. See the note atop errors.ts.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, desc, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  asAppUser,
  drawerOpenPolicy,
  locations,
  printAgents,
  printJobs,
  printers,
  printTicketScope,
  printTransport,
  receiptPrintMode,
  tills,
  withTenant,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  claimPrintJobs,
  createPrinter,
  deactivatePrinter,
  enqueuePrintJob,
  enrolAgent,
  esc,
  generateAgentCode,
  listPrinters,
  reportPrintJob,
  updatePrinter,
  type CreatePrinterInput,
  type UpdatePrinterInput,
} from "@waitron/printing";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
import {
  attachPrinterToStation,
  detachPrinterFromStation,
  listStationPrinters,
} from "./station-printers.js";
import { readJsonBody } from "./read-json-body.js";
import { requireManagementSession } from "./management-session.js";
import { requireAgent } from "./print-agent-session.js";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { requireBodyUuid, requireEnum, requireUuidParam } from "./request-screens.js";
import type { Logger } from "./logger.js";

/**
 * Everything `mountPrintApi` needs. `cfg` carries this venue's tenant + location — the scope every
 * `withTenant` below runs under (RLS confines each read/write to this server's one tenant) and the two
 * fields the `@waitron/printing` verbs stamp onto minted codes / created printers (`PrintAgentConfig`
 * / `PrintConfig`). No `nodeId`: `print_jobs` carries no sync-capture trigger in this slice (§4,
 * single-writer-per-row until replication lands), so there is no `sync_log.origin_id` to attribute. No
 * cookie config: the AGENT surface authenticates with a Bearer token (never a cookie), and the
 * MANAGEMENT surface reuses the browser management session the sibling gated APIs already carry.
 */
export interface PrintApiDeps {
  db: Database;
  cfg: { tenantId: string; locationId: string };
  /**
   * The redemption rate-limiter for `POST /print-api/agent/enrol` — the SAME per-process, in-memory,
   * GLOBAL fixed-window guard the device enrol route uses (`enrol-rate-limit.ts`), built here with THIS
   * surface's own throw code. Optional and injected ONLY by tests (which pass a limiter over a
   * controllable clock, and MUST give it `code: "agent.pairing_rate_limited"` to match production);
   * production omits it and `mountPrintApi` builds the default (`ENROL_RATE_MAX` per
   * `ENROL_RATE_WINDOW_MS`, code `agent.pairing_rate_limited`). The limiter throws
   * `agent.pairing_rate_limited` directly, so the print enrolment flow answers every pairing outcome in
   * ONE namespace (`agent.*`) with no catch-and-translate, never leaking `device.*`.
   */
  enrolRateLimiter?: EnrolRateLimiter;
}

/**
 * The ONE permission that gates every print-MANAGEMENT route (the agent codes, the printers CRUD, and
 * the job list) — one named constant referenced at each gated route rather than an inline literal, the
 * `purchasing-api.ts` / `device-api.ts` seam. `printer.manage` maps to `manager` + `admin`
 * (permissions.ts) — central printer administration is an admin act, never a till operator's. The
 * AGENT API itself is device-authed (`requireAgent`), deliberately NOT gated on this (design §7).
 */
const PRINTER_MANAGE_PERMISSION: Permission = "printer.manage";

/** How many recent jobs the management job list returns — a bound on the dashboard's status read, not
 * a tuning knob (the surface shows recent activity, not the whole history). */
const RECENT_JOBS_LIMIT = 100;

/** The fixed ESC/POS ticket the dashboard's test-print button enqueues (design §6) — a self-test the
 * operator triggers to confirm a printer + its agent are wired up end to end. Built ONCE at module
 * load (the bytes are deterministic); `enqueuePrintJob` copies them into each job's `bytea`. Kept
 * deliberately minimal — init, two lines, a paper feed, a full cut. */
const TEST_PRINT_PAYLOAD = esc().init().line("Waitron").line("Test print").feed(3).cut().bytes();

/**
 * Every AppError CODE these routes answer, and the HTTP status it maps to. CLIENT faults only: a
 * genuine SERVER fault reaches `run` as a NON-AppError and becomes an opaque `server.internal` 500. A
 * registered code absent from this table defaults to 400 via `run`. Each surface owns its own STATUS
 * map (error-boundary.ts) — this one is the `printer.*`/`agent.*` surface's.
 *
 *  - Agent auth/enrol: `agent.unauthorized` (the `requireAgent` fold of missing/unknown/revoked, 401),
 *    `agent.pairing_invalid` (an unknown/consumed/foreign code, 404 — a not-found, oracle-free) and
 *    `agent.pairing_expired` (a code that WAS ours but lapsed, 410 Gone — distinct by design),
 *    `agent.pairing_rate_limited` (the enrol flood guard, 429, thrown BEFORE any DB work — the limiter
 *    is built with this surface's own code, so it throws `agent.*` directly with no translation).
 *  - Printer/agent management: `printer.not_found` (an absent printer id, 404),
 *    `printer.invalid_config` (a transport short of its required fields, 422 Unprocessable — the config
 *    is well-formed JSON but semantically invalid), `agent.not_found` (an absent agent id on revoke, or
 *    a printer bound to an unknown agent — the composite FK mapped friendly, 404).
 *  - Station ↔ printer mapping (KDS-4 §3e): `station.not_found` (an absent/deactivated station on
 *    attach, 404 — the KDS-1 code, param `{ stationId }`) and `printer.not_found` (an absent/inactive
 *    printer on attach, 404, reused from above). Detach/list never live-check, so they throw neither.
 *  - The management-gate codes, mirroring `device-api.ts`: `management_session.*` (401),
 *    `person.suspended`/`authorization.not_permitted` (403), plus `management.request_invalid` (400)
 *    from the body/enum screens and `shared.invalid_id` (400) from the path-id screen.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "agent.unauthorized": 401,
  "agent.pairing_invalid": 404,
  "agent.pairing_expired": 410,
  "agent.pairing_rate_limited": 429,
  "printer.not_found": 404,
  "printer.invalid_config": 422,
  "agent.not_found": 404,
  "station.not_found": 404,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
};

// The one error boundary every print route wraps its handler in — the shared `createErrorBoundary`
// closed over this surface's `STATUS` map and its `print.failed` log tag.
const run = createErrorBoundary(STATUS, "print.failed");

/** Screen a REQUIRED body field as a string, refusing an absent/wrong-typed one as
 * `management.request_invalid` naming the field (never a downstream `text`/500). */
function requireString(v: unknown, field: string): string {
  if (typeof v !== "string") throw new AppError("management.request_invalid", { field });
  return v;
}

/** Screen an OPTIONAL body string: `undefined` (absent) passes through untouched; any present value
 * must be a string, else `management.request_invalid` naming the field. */
function optionalString(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  return requireString(v, field);
}

/** Screen an OPTIONAL, NULLABLE body string (an update that may CLEAR a connection field): `undefined`
 * passes untouched, `null` clears, any other value must be a string. */
function nullableOptionalString(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return requireString(v, field);
}

/** Screen an OPTIONAL, NULLABLE body integer (an update to `port`, which may be cleared): `undefined`
 * passes untouched, `null` clears, any other value must be an integer number. */
function nullableOptionalInt(v: unknown, field: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new AppError("management.request_invalid", { field });
  }
  return v;
}

/** Screen an OPTIONAL, NULLABLE body UUID (an update that may re-bind or clear `agentId`): `undefined`
 * passes untouched, `null` clears, any other value must be a UUID-shaped string (else a non-uuid would
 * `22P02` in the `uuid` column → an opaque 500) via `requireBodyUuid`. */
function nullableOptionalUuid(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return requireBodyUuid(v, field);
}

/** Screen an OPTIONAL body boolean: `undefined` passes untouched; any present value must be a boolean. */
function optionalBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new AppError("management.request_invalid", { field });
  return v;
}

/** Screen an OPTIONAL body UUID (a create's `agentId`, which is either present-and-well-formed or
 * absent — never an explicit `null` on create): `undefined` passes untouched, any present value must be
 * UUID-shaped (else a non-uuid would `22P02` the `uuid` column → an opaque 500) via `requireBodyUuid`. */
function optionalUuid(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  return requireBodyUuid(v, field);
}

/**
 * Mounts the three print route groups on an existing Hono app — the `mountDeviceApi` convention (the
 * unauthenticated enrol seam, the token-gated agent group, the `printer.manage`-gated management
 * group), attached to the SAME app. Every handler is wrapped in `run` so the whole surface maps errors
 * identically:
 *
 *  1. UNAUTHENTICATED agent enrol (`POST /print-api/agent/enrol`) — redeems a pairing code
 *     (`enrolAgent`) and returns `{ agentId, token }` in the BODY (the agent stores the token; it never
 *     rides a cookie). Rate-limited FIRST, before any DB work, reusing the device enrol guard.
 *  2. AGENT-GATED routes (`GET /print-api/agent/jobs`, `POST /print-api/agent/jobs/:id/result`) — each
 *     calls `requireAgent` (Bearer, 401 otherwise; a REVOKED agent fails instantly) and then acts only
 *     within the authenticated agent's OWN printers' scope. The claim CLAIMS-and-COMMITS within the
 *     request (Controller Ruling 6): the server holds NO lock or transaction across the remote agent's
 *     push — the agent pushes the bytes itself and REPORTs the outcome in a separate request.
 *  3. `printer.manage`-GATED management routes (the agent codes, the printers CRUD, the job list) —
 *     each calls `requireManagementSession` (401) then funnels its DB work through the local `gated`
 *     helper, which `authorizeManager`s `printer.manage` (403) before the op runs, in exactly one place.
 */
export function mountPrintApi(app: Hono, deps: PrintApiDeps, log: Logger): void {
  // The GLOBAL, in-memory, per-process enrol rate-limiter (design §7 / the device enrol precedent).
  // Built ONCE here so it is one bucket for the whole mounted API; a test may inject its own limiter
  // over a controllable clock, production omits it and gets `createEnrolRateLimiter({ code })` throwing
  // THIS surface's own `agent.pairing_rate_limited` (429), so the enrol route needs no catch-and-translate.
  const enrolLimiter =
    deps.enrolRateLimiter ?? createEnrolRateLimiter({ code: "agent.pairing_rate_limited" });

  // Open a tenant-scoped transaction as the app role, confirm the caller's management session carries
  // `printer.manage`, then run `fn`. Every management route funnels its DB work through here so the gate
  // is applied identically and in exactly one place (the device-api / purchasing-api seam). Proven by
  // deletion: removing the `authorizeManager(...)` call makes a staff session succeed on every gated
  // route (print-api.rls.test.ts records the RED/GREEN).
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: PRINTER_MANAGE_PERMISSION,
      });
      return fn(tx);
    });

  // ── Agent enrol (UNAUTHENTICATED) ────────────────────────────────────────────────────────────────
  app.post("/print-api/agent/enrol", (c) =>
    run(c, log, async () => {
      // Rate-limit FIRST — before the body is parsed and before `enrolAgent`'s locking DELETE — so an
      // enrol flood is refused (429 `agent.pairing_rate_limited`) with ZERO DB work, keeping a flood on
      // this unauthenticated route from starving the sale path (CLAUDE.md §5). The device enrol route's
      // exact posture; this limiter is built with THIS surface's own code (see `enrolLimiter` above), so
      // the throttle answers in the `agent.*` namespace directly — no catch-and-translate needed.
      enrolLimiter.check();
      const body = await readJsonBody<{ code?: unknown }>(c);
      const code = requireString(body.code, "code");
      const enrolled = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return enrolAgent(tx, deps.cfg, { code });
      });
      // The token is the agent's ONLY secret and leaves the process ONLY here, in the response body —
      // the agent stores it and presents it as a Bearer thereafter. `agentId` is the non-secret
      // selector half (also embedded in the token), returned so the agent can log/identify itself.
      return c.json({ agentId: enrolled.agentId, token: enrolled.token }, 200);
    }),
  );

  // ── Claim this agent's queued jobs (AGENT-GATED) ─────────────────────────────────────────────────
  app.get("/print-api/agent/jobs", (c) =>
    run(c, log, async () => {
      const { agentId } = await requireAgent({ db: deps.db, cfg: deps.cfg }, c);
      // CLAIM-and-COMMIT within the request (Controller Ruling 6): the locking claim runs inside this
      // `withTenant` transaction, which COMMITS when the handler returns — the HTTP response is the
      // commit boundary. The server then holds NO lock or transaction across the remote agent's socket
      // write; the agent pushes the bytes and REPORTs via `/result`. `claimPrintJobs` scopes to the
      // authenticated agent's OWN printers, so a cross-agent claim returns an empty batch.
      const claimed = await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return claimPrintJobs(tx, deps.cfg, agentId);
      });
      // The OPAQUE payload bytes ride as base64 over JSON (the agent decodes and pushes them verbatim);
      // the printer connection facts travel alongside so the agent's transport knows where to send.
      return c.json({
        jobs: claimed.map((job) => ({
          id: job.id,
          printerId: job.printer_id,
          transport: job.transport,
          host: job.host,
          port: job.port,
          usbPath: job.usb_path,
          payload: Buffer.from(job.payload).toString("base64"),
        })),
      });
    }),
  );

  // ── Report one job's delivery outcome (AGENT-GATED) ──────────────────────────────────────────────
  app.post("/print-api/agent/jobs/:id/result", (c) =>
    run(c, log, async () => {
      const { agentId } = await requireAgent({ db: deps.db, cfg: deps.cfg }, c);
      // A non-uuid job id is a clear client bug (the agent builds this URL from a claimed job's id) →
      // a clean `shared.invalid_id` 400, never a `22P02` 500 in the `uuid` column.
      const jobId = requireUuidParam(c.req.param("id"), "PrintJobId");
      const body = await readJsonBody<{ status?: unknown; error?: unknown }>(c);
      // `status` is the ONE field the agent MUST get right for the report to mean anything — screened to
      // exactly `done`/`failed` (a bad/absent one → 400 naming the field). `error` (a `failed`
      // diagnostic) is optional; the report records it into `last_error` and bumps `attempts`.
      const status = requireEnum(body.status, "status", ["done", "failed"] as const);
      const outcome =
        status === "done"
          ? ({ status: "done" } as const)
          : ({ status: "failed", error: requireString(body.error ?? "", "error") } as const);
      // AGENT-SCOPED (design §3c / Ruling 6): `reportPrintJob` only mutates a job served by THIS agent's
      // printers, so a cross-agent report changes nothing. The response is a plain 204 whether or not a
      // row matched — an idempotent status sink (a job that is not this agent's, already terminal, or
      // unknown is a no-op), never disclosing which job ids exist. The agent-scope is proven by deletion.
      await withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
        await asAppUser(tx);
        return reportPrintJob(tx, deps.cfg, { agentId, jobId, outcome });
      });
      return c.body(null, 204);
    }),
  );

  // ── Mint an agent pairing code (printer.manage) ──────────────────────────────────────────────────
  app.post("/management-api/print-agents/codes", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ label?: unknown }>(c);
      const label = requireString(body.label, "label");
      // The plaintext code leaves ONLY here, once, for the operator to read into the agent's config
      // (generateAgentCode stores only its SHA-256). Shown once — the dashboard surfaces it and forgets.
      const result = await gated(sessionId, (tx) => generateAgentCode(tx, deps.cfg, { label }));
      return c.json(result, 201);
    }),
  );

  // ── List this tenant's print agents (printer.manage) ─────────────────────────────────────────────
  app.get("/management-api/print-agents", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // No explicit tenant filter — isolation is entirely `withTenant` + `asAppUser` RLS. Newest
      // enrolment first. The `token_hash` is NEVER selected — a secret never leaves the row.
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            id: printAgents.id,
            name: printAgents.name,
            active: printAgents.active,
            lastSeenAt: printAgents.lastSeenAt,
            enrolledAt: printAgents.enrolledAt,
          })
          .from(printAgents)
          .orderBy(desc(printAgents.enrolledAt)),
      );
      return c.json(rows);
    }),
  );

  // ── Revoke a print agent (printer.manage) ────────────────────────────────────────────────────────
  app.post("/management-api/print-agents/:id/revoke", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrintAgentId");
      // Revoke = flip `active = false` (instant — `requireAgent` rejects it), NEVER a hard DELETE: an
      // agent is a durable identity referenced by printers/jobs and `app_user` holds no DELETE. 0 rows
      // (unknown or RLS-hidden id) → `agent.not_found`.
      const updated = await gated(sessionId, (tx) =>
        tx
          .update(printAgents)
          .set({ active: false })
          .where(and(eq(printAgents.tenantId, deps.cfg.tenantId), eq(printAgents.id, id)))
          .returning({ id: printAgents.id }),
      );
      if (updated.length === 0) throw new AppError("agent.not_found", { id });
      return c.body(null, 204);
    }),
  );

  // ── Create a printer (printer.manage) ────────────────────────────────────────────────────────────
  app.post("/management-api/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      // Screen the SHAPE here; `createPrinter` owns the required-field check (`printer.invalid_config`)
      // and the DB owns the transport CHECK + agent FK (mapped friendly). A non-uuid `agentId` is
      // screened here so it never `22P02`s the `uuid` column.
      const input: CreatePrinterInput = {
        name: requireString(body.name, "name"),
        transport: requireEnum(body.transport, "transport", printTransport.enumValues),
      };
      const agentId = optionalUuid(body.agentId, "agentId");
      if (agentId !== undefined) input.agentId = agentId;
      const host = optionalString(body.host, "host");
      if (host !== undefined) input.host = host;
      const port = nullableOptionalInt(body.port, "port");
      if (port !== undefined && port !== null) input.port = port;
      const usbPath = optionalString(body.usbPath, "usbPath");
      if (usbPath !== undefined) input.usbPath = usbPath;
      const pollId = optionalString(body.pollId, "pollId");
      if (pollId !== undefined) input.pollId = pollId;
      const created = await gated(sessionId, (tx) => createPrinter(tx, deps.cfg, input));
      return c.json(created, 201);
    }),
  );

  // ── List this tenant's printers (printer.manage) ─────────────────────────────────────────────────
  app.get("/management-api/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => listPrinters(tx, deps.cfg));
      return c.json(rows);
    }),
  );

  // ── Update a printer (printer.manage) ────────────────────────────────────────────────────────────
  app.patch("/management-api/printers/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      // Every field OPTIONAL (a PATCH touches only what it names); the connection fields + `agentId`
      // accept an explicit `null` to CLEAR them. `updatePrinter` 404s a missing id and maps the DB
      // CHECK / agent FK to `printer.invalid_config` / `agent.not_found`.
      const patch: UpdatePrinterInput = {};
      const name = optionalString(body.name, "name");
      if (name !== undefined) patch.name = name;
      if (body.transport !== undefined) {
        patch.transport = requireEnum(body.transport, "transport", printTransport.enumValues);
      }
      const agentId = nullableOptionalUuid(body.agentId, "agentId");
      if (agentId !== undefined) patch.agentId = agentId;
      const host = nullableOptionalString(body.host, "host");
      if (host !== undefined) patch.host = host;
      const port = nullableOptionalInt(body.port, "port");
      if (port !== undefined) patch.port = port;
      const usbPath = nullableOptionalString(body.usbPath, "usbPath");
      if (usbPath !== undefined) patch.usbPath = usbPath;
      const pollId = nullableOptionalString(body.pollId, "pollId");
      if (pollId !== undefined) patch.pollId = pollId;
      if (body.ticketScope !== undefined) {
        patch.ticketScope = requireEnum(
          body.ticketScope,
          "ticketScope",
          printTicketScope.enumValues,
        );
      }
      const active = optionalBool(body.active, "active");
      if (active !== undefined) patch.active = active;
      await gated(sessionId, (tx) => updatePrinter(tx, deps.cfg, id, patch));
      return c.body(null, 204);
    }),
  );

  // ── Deactivate a printer (printer.manage) ────────────────────────────────────────────────────────
  app.post("/management-api/printers/:id/deactivate", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      await gated(sessionId, (tx) => deactivatePrinter(tx, deps.cfg, id));
      return c.body(null, 204);
    }),
  );

  // ── Test-print a printer (printer.manage) ────────────────────────────────────────────────────────
  app.post("/management-api/printers/:id/test-print", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      // A dashboard DIAGNOSTIC (design §6): enqueue ONE known ESC/POS payload on this printer via the
      // same never-block outbox path a fire/sale uses — the agent runtime delivers it asynchronously, so
      // a broken/offline printer can never make this request hang (CLAUDE.md §5). `enqueuePrintJob`'s own
      // DB-only pre-check 404s an absent id as `printer.not_found`; no new code lives here.
      const result = await gated(sessionId, (tx) =>
        enqueuePrintJob(tx, deps.cfg, id, TEST_PRINT_PAYLOAD),
      );
      // 202 Accepted: the job is QUEUED for asynchronous delivery, not printed within the request.
      return c.json(result, 202);
    }),
  );

  // ── Recent print jobs (printer.manage) ───────────────────────────────────────────────────────────
  app.get("/management-api/print-jobs", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // The dashboard's status read (design §6: last delivered, failing printers). Newest first,
      // bounded — recent activity, not the whole history. No `payload` (opaque bytes are not status).
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            id: printJobs.id,
            printerId: printJobs.printerId,
            status: printJobs.status,
            attempts: printJobs.attempts,
            lastError: printJobs.lastError,
            createdAt: printJobs.createdAt,
            deliveredAt: printJobs.deliveredAt,
          })
          .from(printJobs)
          .orderBy(desc(printJobs.createdAt))
          .limit(RECENT_JOBS_LIMIT),
      );
      return c.json(rows);
    }),
  );

  // ── Attach a printer to a station (printer.manage) ───────────────────────────────────────────────
  // KDS-4 §3a/§3e — record that a fire at `:sid` prints at `:pid`. Station-centric (the mapping is
  // symmetric; attach/detach stay on the station route). Both ids are `requireUuidParam`-screened to a
  // clean `shared.invalid_id` (400) before any query — un-screened a non-uuid would `22P02` the `uuid`
  // column → an opaque 500. `attachPrinterToStation` live-checks BOTH ends (`station.not_found` /
  // `printer.not_found`, 404) and is idempotent (ON CONFLICT DO NOTHING), so re-attaching a pair is a
  // 204 no-op. Runs through the shared `gated` helper so `printer.manage` is enforced identically.
  app.post("/management-api/stations/:sid/printers/:pid", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const stationId = requireUuidParam(c.req.param("sid"), "StationId");
      const printerId = requireUuidParam(c.req.param("pid"), "PrinterId");
      await gated(sessionId, (tx) =>
        attachPrinterToStation(tx, deps.cfg, { stationId, printerId }),
      );
      return c.body(null, 204);
    }),
  );

  // ── Detach a printer from a station (printer.manage) ─────────────────────────────────────────────
  // The symmetric counterpart to attach. `detachPrinterFromStation` is a PURE idempotent DELETE — it
  // does NOT live-check either end (a mapping to a since-retired station/printer must stay detachable),
  // so it throws no domain code and detaching an absent pair is a 204 no-op. Same id screens + `gated`.
  app.delete("/management-api/stations/:sid/printers/:pid", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const stationId = requireUuidParam(c.req.param("sid"), "StationId");
      const printerId = requireUuidParam(c.req.param("pid"), "PrinterId");
      await gated(sessionId, (tx) =>
        detachPrinterFromStation(tx, deps.cfg, { stationId, printerId }),
      );
      return c.body(null, 204);
    }),
  );

  // ── List a station's printers (printer.manage) ───────────────────────────────────────────────────
  // The station-centric read: which printers a station prints to (the config editor's per-station view).
  // `:sid` is `requireUuidParam`-screened first. `listStationPrinters` scopes by RLS + `cfg.tenantId`.
  app.get("/management-api/stations/:sid/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const stationId = requireUuidParam(c.req.param("sid"), "StationId");
      const rows = await gated(sessionId, (tx) => listStationPrinters(tx, deps.cfg, { stationId }));
      return c.json(rows);
    }),
  );

  // ── List a printer's stations (printer.manage) ───────────────────────────────────────────────────
  // The R-J mirror (design §5): which stations a printer serves — what the dashboard printer-editor's
  // stations multi-select reads to show a printer's current mapping. Same verb, filtered on `printerId`.
  app.get("/management-api/printers/:pid/stations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const printerId = requireUuidParam(c.req.param("pid"), "PrinterId");
      const rows = await gated(sessionId, (tx) => listStationPrinters(tx, deps.cfg, { printerId }));
      return c.json(rows);
    }),
  );

  // ── List this tenant's tills (printer.manage) ────────────────────────────────────────────────────
  // Counter receipt/drawer §3d/§5 — the DATA SOURCE for the dashboard's per-till receipt-printer picker
  // (it does not exist elsewhere). Returns each till as `{ id, label, locationId, receiptPrinterId }`:
  // `label` projects `tills.name` (the till's display name — the column is `name`, the picker calls it a
  // label), `locationId` is the till's location (so the picker can offer that location's printers), and
  // `receiptPrinterId` the currently-set receipt printer (null = none) so the picker reflects the
  // persisted value across a reload. Lives beside the sibling `PATCH …/tills/:id/receipt-printer`,
  // funnelled through the SAME `gated` helper so `printer.manage` is enforced identically (the
  // by-deletion proof on that helper covers this route too). Tenant-scoped by `gated`'s
  // `withTenant` + `asAppUser` (RLS), with an explicit `tenant_id` predicate beside it — the same
  // belt-and-braces the sibling till/location writes carry. Ordered by name for a stable list.
  app.get("/management-api/tills", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            id: tills.id,
            label: tills.name,
            locationId: tills.locationId,
            receiptPrinterId: tills.receiptPrinterId,
          })
          .from(tills)
          .where(eq(tills.tenantId, deps.cfg.tenantId))
          .orderBy(tills.name),
      );
      return c.json(rows);
    }),
  );

  // ── Set a till's receipt printer (printer.manage) ────────────────────────────────────────────────
  // Counter receipt/drawer §3d/§5 — the dashboard's per-till "receipt printer" picker. Points a till at
  // one of its OWN location's printers (which is also the cash-drawer kick — deli-hardware §6), or clears
  // it (`printerId: null` — a till with no printer just doesn't print, §2). Lives beside the sibling
  // printer routes here, funnelled through the SAME `gated` helper so `printer.manage` is enforced
  // identically (the by-deletion proof on that helper covers this route too). `:id` is
  // `requireUuidParam`-screened (`shared.invalid_id`, 400) before any query; a present `printerId` must
  // be UUID-shaped (else a `22P02` → 500) via `requireBodyUuid`. A named printer is validated to be an
  // ACTIVE printer in the till's OWN location (the picker's source) — absent/inactive/foreign/other-location
  // → `printer.not_found` (404, reused from Slice A), which also keeps the composite FK from 23503-ing an
  // opaque 500. An unknown till, and a body missing `printerId` entirely, are `management.request_invalid`
  // (400) — there is no `till.*` code (retired at the node-id rekey, errors.ts), and naming a
  // non-existent till in a config PATCH is a request-shape fault, the generic code these routes already use.
  app.patch("/management-api/tills/:id/receipt-printer", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const tillId = requireUuidParam(c.req.param("id"), "TillId");
      const body = await readJsonBody<{ printerId?: unknown }>(c);
      // REQUIRED field, either a printer uuid (set) or explicit null (clear). Absent → request_invalid.
      if (!("printerId" in body)) {
        throw new AppError("management.request_invalid", { field: "printerId" });
      }
      const printerId =
        body.printerId === null ? null : requireBodyUuid(body.printerId, "printerId");
      await gated(sessionId, async (tx) => {
        // The till must exist in this tenant (RLS-scoped). Read its location so a named printer is
        // validated against the till's OWN location — "from the location's printers" (§5).
        const [till] = await tx
          .select({ locationId: tills.locationId })
          .from(tills)
          .where(and(eq(tills.tenantId, deps.cfg.tenantId), eq(tills.id, tillId)));
        if (till === undefined) {
          throw new AppError("management.request_invalid", { field: "tillId" });
        }
        if (printerId !== null) {
          const [printer] = await tx
            .select({ id: printers.id })
            .from(printers)
            .where(
              and(
                eq(printers.tenantId, deps.cfg.tenantId),
                eq(printers.id, printerId),
                eq(printers.locationId, till.locationId),
                eq(printers.active, true),
              ),
            );
          if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });
        }
        await tx
          .update(tills)
          .set({ receiptPrinterId: printerId })
          .where(and(eq(tills.tenantId, deps.cfg.tenantId), eq(tills.id, tillId)));
      });
      return c.body(null, 204);
    }),
  );

  // ── Set a location's receipt print mode (printer.manage) ─────────────────────────────────────────
  // Counter receipt/drawer §3d/§5 — the dashboard's per-location print-mode toggle
  // (`auto`/`on_request`/`never`, which the print-on-sale hook reads). Same `gated` / `printer.manage`
  // gate + `requireUuidParam` id screen as the till route above. `mode` is screened to the
  // `receipt_print_mode` enum's members (`management.request_invalid`, 400, before the enum column). An
  // unknown/foreign (RLS-hidden) location is `management.request_invalid` (400) — there is no `location.*`
  // code, the same request-shape treatment the unknown-till case above takes.
  app.patch("/management-api/locations/:id/receipt-print-mode", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationRowId = requireUuidParam(c.req.param("id"), "LocationId");
      const body = await readJsonBody<{ mode?: unknown }>(c);
      const mode = requireEnum(body.mode, "mode", receiptPrintMode.enumValues);
      await gated(sessionId, async (tx) => {
        const updated = await tx
          .update(locations)
          .set({ receiptPrintMode: mode })
          .where(and(eq(locations.tenantId, deps.cfg.tenantId), eq(locations.id, locationRowId)))
          .returning({ id: locations.id });
        if (updated.length === 0) {
          throw new AppError("management.request_invalid", { field: "locationId" });
        }
      });
      return c.body(null, 204);
    }),
  );

  // ── Set a location's cash-drawer-open policy (printer.manage) ─────────────────────────────────────
  // Cash-drawer-authorization §5 — the dashboard's per-location drawer-policy toggle (`gated`/`open`,
  // which the till's drawer-open authorize() hook reads). One-for-one SIBLING of the receipt-print-mode
  // route above: same `gated` / `printer.manage` gate + `requireUuidParam` id screen. `policy` is
  // screened to the `drawer_open_policy` enum's members (`management.request_invalid`, 400, before the
  // enum column). An unknown/foreign (RLS-hidden) location is `management.request_invalid` (400) — there
  // is no `location.*` code, the same request-shape treatment the receipt-print-mode route takes.
  app.patch("/management-api/locations/:id/drawer-open-policy", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const locationRowId = requireUuidParam(c.req.param("id"), "LocationId");
      const body = await readJsonBody<{ policy?: unknown }>(c);
      const policy = requireEnum(body.policy, "policy", drawerOpenPolicy.enumValues);
      await gated(sessionId, async (tx) => {
        const updated = await tx
          .update(locations)
          .set({ drawerOpenPolicy: policy })
          .where(and(eq(locations.tenantId, deps.cfg.tenantId), eq(locations.id, locationRowId)))
          .returning({ id: locations.id });
        if (updated.length === 0) {
          throw new AppError("management.request_invalid", { field: "locationId" });
        }
      });
      return c.body(null, 204);
    }),
  );
}

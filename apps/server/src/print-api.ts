// Side-effect only: loads this host's errors.ts augmentation for the codes THESE routes throw directly
// — `management.request_invalid` (the body/query screens, via `request-screens.js`) and
// `device.pairing_rate_limited` (the enrol flood guard, via `enrol-rate-limit.js`, which throws it at
// the TOP of the enrol handler). The printing codes this surface answers — `printer.*`/`agent.*` — are
// declared in @waitron/printing's own errors.ts and reach here through the VALUE imports of its verbs
// below (enrolAgent/generateAgentCode/createPrinter/updatePrinter/deactivatePrinter/claimPrintJobs/
// reportPrintJob and, transitively, requireAgent's authenticateAgent); `shared.invalid_id` (thrown by
// `requireUuidParam`) loads via the AppError value import. The device-api sibling relies on the same
// transitive reachability. See the note atop errors.ts.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, desc, eq } from "drizzle-orm";
import { AppError, isAppError } from "@waitron/shared";
import {
  asAppUser,
  printAgents,
  printJobs,
  printTicketScope,
  printTransport,
  withTenant,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  claimPrintJobs,
  createPrinter,
  deactivatePrinter,
  enrolAgent,
  generateAgentCode,
  listPrinters,
  reportPrintJob,
  updatePrinter,
  type CreatePrinterInput,
  type UpdatePrinterInput,
} from "@waitron/printing";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "./error-boundary.js";
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
   * GLOBAL fixed-window guard the device enrol route uses (`enrol-rate-limit.ts`). Optional and
   * injected ONLY by tests (which pass a limiter over a controllable clock); production omits it and
   * `mountPrintApi` builds the default (`ENROL_RATE_MAX` per `ENROL_RATE_WINDOW_MS`). The shared
   * limiter throws the device-namespaced `device.pairing_rate_limited`; the enrol route TRANSLATES that
   * to this surface's own `agent.pairing_rate_limited` (see the route), so the print enrolment flow
   * answers every pairing outcome in ONE namespace (`agent.*`), never leaking `device.*`.
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

/**
 * Every AppError CODE these routes answer, and the HTTP status it maps to. CLIENT faults only: a
 * genuine SERVER fault reaches `run` as a NON-AppError and becomes an opaque `server.internal` 500. A
 * registered code absent from this table defaults to 400 via `run`. Each surface owns its own STATUS
 * map (error-boundary.ts) — this one is the `printer.*`/`agent.*` surface's.
 *
 *  - Agent auth/enrol: `agent.unauthorized` (the `requireAgent` fold of missing/unknown/revoked, 401),
 *    `agent.pairing_invalid` (an unknown/consumed/foreign code, 404 — a not-found, oracle-free) and
 *    `agent.pairing_expired` (a code that WAS ours but lapsed, 410 Gone — distinct by design),
 *    `agent.pairing_rate_limited` (the enrol flood guard, 429, thrown BEFORE any DB work — the enrol
 *    route translates the shared limiter's device-namespaced throw to this `agent.*` code).
 *  - Printer/agent management: `printer.not_found` (an absent printer id, 404),
 *    `printer.invalid_config` (a transport short of its required fields, 422 Unprocessable — the config
 *    is well-formed JSON but semantically invalid), `agent.not_found` (an absent agent id on revoke, or
 *    a printer bound to an unknown agent — the composite FK mapped friendly, 404).
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
  // over a controllable clock, production omits it and gets the default `createEnrolRateLimiter()`.
  const enrolLimiter = deps.enrolRateLimiter ?? createEnrolRateLimiter();

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
      // enrol flood is refused (429) with ZERO DB work, keeping a flood on this unauthenticated route
      // from starving the sale path (CLAUDE.md §5). The device enrol route's exact posture. The shared
      // limiter throws the DEVICE-namespaced `device.pairing_rate_limited`; TRANSLATE it to this
      // surface's own `agent.pairing_rate_limited` so the print enrolment flow answers every pairing
      // outcome in ONE namespace (codes name the domain concept, CLAUDE.md §1/§3). Any other throw
      // (there is none today) propagates unchanged.
      try {
        enrolLimiter.check();
      } catch (error) {
        // `createEnrolRateLimiter().check()` throws ONLY `device.pairing_rate_limited`
        // (enrol-rate-limit.ts), so the guard below is defense-in-depth: it is unreachable today (the
        // catch always sees exactly that code) but kept so a future limiter that threw something else
        // would propagate it verbatim rather than be mislabelled. v8-ignored as documented-unreachable
        // (the boot.ts / chain.ts shape); the reachable translation on the next line stays counted and
        // IS exercised by the rate-limit test.
        /* v8 ignore start */
        if (!isAppError(error) || error.code !== "device.pairing_rate_limited") throw error;
        /* v8 ignore stop */
        throw new AppError("agent.pairing_rate_limited", {});
      }
      const body: { code?: unknown } =
        (await c.req.json<{ code?: unknown }>().catch(() => ({}))) ?? {};
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
      const body: { status?: unknown; error?: unknown } =
        (await c.req.json<{ status?: unknown; error?: unknown }>().catch(() => ({}))) ?? {};
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
      const body: { label?: unknown } =
        (await c.req.json<{ label?: unknown }>().catch(() => ({}))) ?? {};
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
      const body: Record<string, unknown> =
        (await c.req.json<Record<string, unknown>>().catch(() => ({}))) ?? {};
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
      const body: Record<string, unknown> =
        (await c.req.json<Record<string, unknown>>().catch(() => ({}))) ?? {};
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
}

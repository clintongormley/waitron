// Load server-owned error codes; imported printing verbs load the printing registry.
import "./errors.js";
import { createPrinterProbes } from "./printer-probes.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { AppError, resolveActiveLocale } from "@waitron/shared";
import type { SupportedLocale } from "@waitron/shared";
import {
  asAppUser,
  drawerOpenPolicy,
  locations,
  printAgents,
  printCharacterSet,
  printJobs,
  printPaperWidth,
  printResolution,
  printers,
  printTicketScope,
  printTransport,
  receiptPrintMode,
  tills,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  claimPrintJobs,
  canResendPrintJob,
  resendPrintJob,
  columnsFor,
  createPrinter,
  deactivatePrinter,
  dpiValue,
  enqueuePrintJob,
  listPrinters,
  MAX_DELIVERY_ATTEMPTS,
  reportPrintJob,
  updatePrinter,
  type CreatePrinterInput,
  type UpdatePrinterInput,
} from "@waitron/printing";
import { authorizeManager, resolveManagementSession, type Permission } from "@waitron/identity";
import { routableServers, type SignedMembershipDocument } from "@waitron/membership";
import { createErrorBoundary } from "@waitron/server-kit";
import {
  attachPrinterToStation,
  detachPrinterFromStation,
  listStationPrinters,
} from "./station-printers.js";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import { requireAgent } from "./print-agent-session.js";
import { createJoinRequest, readAgentJoinStatus } from "./join-requests.js";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import type { PairingMode } from "./pairing-mode.js";
import { isUuid } from "./till-session.js";
import type { TillConfig } from "./till-config.js";
import { requireBodyUuid, requireEnum, requireString, requireUuidParam } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { previewPrintJob } from "./print-job-preview.js";
import { formatTestPage } from "./test-page.js";
import { formatSampleReceipt } from "./sample-receipt.js";
import { formatCharacterTableTest } from "./character-table-test.js";
import { resolveLoginLocale } from "./login-locale.js";

/**
 * The deployment holds one taxpayer per database. Everything `mountPrintApi` needs. `cfg` is the FULL
 * `TillConfig` (branded ids), not a `{ locationId }` subset: the shared join verbs
 * (`createJoinRequest`, `readAgentJoinStatus`, and the accept verb in join-api.ts) are typed `cfg:
 * TillConfig` and read `cfg.locationId`, and the pull route echoes `cfg.nodeId` so the
 * agent can tell which node it is talking to. `readMembership` reads the venue's held chart so the pull
 * can list its routable servers (the agent follows the primary across a failover, mirroring the till's
 * `GET /api/till`). `pairingMode` is the venue-wide window the knock is admitted under — the SAME holder
 * `boot.ts` hands the device and shared-join mounts, so "venue-wide" is a property of the wiring. No
 * cookie config: the AGENT surface authenticates with a Bearer token (never a cookie), and the
 * MANAGEMENT surface reuses the browser management session the sibling gated APIs already carry.
 */
export interface PrintApiDeps {
  db: Database;
  cfg: TillConfig;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  pairingMode: PairingMode;
  /**
   * The knock rate-limiter for `POST /print-api/agent/join` — the SAME per-process, in-memory, GLOBAL
   * fixed-window guard the device knock uses (`enrol-rate-limit.ts`). Optional and injected ONLY by
   * tests (which pass a limiter over a controllable clock); production omits it and `mountPrintApi`
   * builds the default (`ENROL_RATE_MAX` per `ENROL_RATE_WINDOW_MS`, code `device.join_rate_limited`).
   * Both knock surfaces throw the shared `device.join_rate_limited` (429): the agent client reads the
   * HTTP status, not the code string, so there is no per-surface throttle code to mint.
   */
  enrolRateLimiter?: EnrolRateLimiter;
  /** Fallback language for test instructions when neither the user nor the browser has a preference. */
  venueLocale: SupportedLocale;
}

/** Printer configuration and history reads use printer.manage; document resends use print.resend. */
const PRINTER_MANAGE_PERMISSION: Permission = "printer.manage";

/** Completed history is bounded; unfinished jobs must remain visible regardless of age. */
const RECENT_JOBS_LIMIT = 100;

/**
 * Every AppError CODE these routes answer, and the HTTP status it maps to. CLIENT faults only: a
 * genuine SERVER fault reaches `run` as a NON-AppError and becomes an opaque `server.internal` 500. A
 * registered code absent from this table defaults to 400 via `run`. Each surface owns its own STATUS
 * map (error-boundary.ts) — this one is the `printer.*`/`agent.*` surface's.
 *
 *  - Agent auth: `agent.unauthorized` (the `requireAgent` fold of missing/unknown/revoked, 401).
 *  - The knock (join-and-accept, the shared join_requests mechanism): `device.pairing_closed` (a knock
 *    while the venue's window is shut, 403 — the ORDINARY state, not an anomaly), `device.join_full`
 *    (the database already holds the per-KIND cap of pending requests, 429) and
 *    `device.join_rate_limited` (the knock flood guard, 429, thrown BEFORE any DB work). These are the
 *    SHARED device knock codes: the agent joins through the same mechanism a device does, and its client
 *    reads the HTTP status, not the code string, so there is no `agent.*` sibling to mint.
 *  - Printer/agent management: `printer.not_found` (an absent printer id, 404),
 *    `printer.invalid_config` (a transport short of its required fields, 422 Unprocessable — the config
 *    is well-formed JSON but semantically invalid), `printer.already_registered` (a second registration
 *    of a device already keyed in this venue — the partial local_key UNIQUE mapped friendly, 409), and
 *    `agent.not_found` (an absent agent id on revoke, 404 — printers no longer store an agent binding).
 *  - Station ↔ printer mapping (KDS-4 §3e): `station.not_found` (an absent/deactivated station on
 *    attach, 404 — the KDS-1 code, param `{ stationId }`) and `printer.not_found` (an absent/inactive
 *    printer on attach, 404, reused from above). Detach/list never live-check, so they throw neither.
 *  - The management-gate codes, mirroring `device-api.ts`: `management_session.*` (401),
 *    `person.suspended`/`authorization.not_permitted` (403), plus `management.request_invalid` (400)
 *    from the body/enum screens and `shared.invalid_id` (400) from the path-id screen.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "agent.unauthorized": 401,
  // The shared knock refusals. `pairing_closed` is a 403 (the door is shut, not the caller unknown);
  // `join_full` and `join_rate_limited` are 429, thrown before any DB work.
  "device.pairing_closed": 403,
  "device.join_full": 429,
  "device.join_rate_limited": 429,
  "printer.not_found": 404,
  "printer.probe_busy": 429,
  "print_job.not_found": 404,
  "print_job.not_resendable": 409,
  "printer.invalid_config": 422,
  // A second registration of a physical device already registered in this venue — the partial UNIQUE
  // (location_id, local_key), mapped friendly by `createPrinter`/`updatePrinter` (§9).
  "printer.already_registered": 409,
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

/** Screen an optional ESC/POS character-table byte. */
function optionalByte(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 0xff) {
    throw new AppError("management.request_invalid", { field });
  }
  return v;
}

/** Screen an OPTIONAL body boolean: `undefined` passes untouched; any present value must be a boolean. */
function optionalBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new AppError("management.request_invalid", { field });
  return v;
}

/**
 * The inventory the agent posts on every pull (design §8, mirroring `@waitron/print-agent`'s wire
 * shapes — kept as LOCAL interfaces because `@waitron/print-agent` is a database-free process this
 * server must not import at runtime). `visible` is the box's cheap always-on presence (attached USB
 * serials, paired Bluetooth MACs — each carries a `localKey`); `scanned` is the expensive windowed
 * discovery result, which may be any transport and need not carry a `localKey` (a fresh network printer
 * answers with host/port, an unpaired Bluetooth device with a name). Both feed the in-memory discovered
 * inventory; only `visible` keys feed the claim's eligibility (§5).
 */
interface VisibleDeviceWire {
  transport: "usb" | "bluetooth";
  localKey: string;
  make?: string;
  model?: string;
  name?: string;
}
interface DiscoveredDeviceWire {
  transport: string;
  localKey?: string;
  host?: string;
  port?: number;
  make?: string;
  model?: string;
  name?: string;
  /** True when the agent saw A4/letter media over IPP: an office printer, not a receipt printer. */
  pagePrinter?: true;
}

/** An optional string on a wire object: present-and-a-string passes through, anything else is dropped
 * (the wire is untrusted; a malformed field is discarded, not a 400 — the agent is a first-party box
 * but the screen keeps a bad report from poisoning the in-memory store). */
function wireString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Shape-screen the posted `visible` array into `VisibleDeviceWire[]`, DROPPING malformed entries: a
 * present `transport` of exactly `usb`/`bluetooth` and a string `localKey` are required (an entry short
 * of either is discarded). */
function screenVisible(raw: unknown): VisibleDeviceWire[] {
  if (!Array.isArray(raw)) return [];
  const out: VisibleDeviceWire[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const d = entry as Record<string, unknown>;
    if ((d.transport !== "usb" && d.transport !== "bluetooth") || typeof d.localKey !== "string") {
      continue;
    }
    out.push({
      transport: d.transport,
      localKey: d.localKey,
      make: wireString(d.make),
      model: wireString(d.model),
      name: wireString(d.name),
    });
  }
  return out;
}

/** Shape-screen the posted `scanned` array into `DiscoveredDeviceWire[]`, DROPPING malformed entries: a
 * present `transport` that is one of the known `print_transport` members is required; `localKey`/`host`
 * (strings), `port` (an integer) and `pagePrinter` (exactly `true`) are optional and dropped when malformed. */
function screenScanned(raw: unknown): DiscoveredDeviceWire[] {
  if (!Array.isArray(raw)) return [];
  const members = printTransport.enumValues as readonly string[];
  const out: DiscoveredDeviceWire[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const d = entry as Record<string, unknown>;
    if (typeof d.transport !== "string" || !members.includes(d.transport)) continue;
    out.push({
      transport: d.transport,
      localKey: wireString(d.localKey),
      host: wireString(d.host),
      port: typeof d.port === "number" && Number.isInteger(d.port) ? d.port : undefined,
      make: wireString(d.make),
      model: wireString(d.model),
      name: wireString(d.name),
      pagePrinter: d.pagePrinter === true ? true : undefined,
    });
  }
  return out;
}

/**
 * Mounts the three print route groups on an existing Hono app — the `mountDeviceApi` convention (the
 * unauthenticated knock + status seam, the token-gated agent group, the permission-gated management
 * group), attached to the SAME app. Every handler is wrapped in `run` so the whole surface maps errors
 * identically:
 *
 *  1. UNAUTHENTICATED join, a KNOCK and a POLL (the shared join_requests mechanism, mirroring the
 *     device knock). `POST /print-api/agent/join` asks to join: refused unless an admin has the venue's
 *     pairing window open, else it mints a pending request and returns `{ token, verificationNumber }`
 *     in the BODY (the agent stores the token and presents it as a Bearer; it never rides a cookie).
 *     `GET /print-api/agent/join/status` is the joiner asking whether it is in yet, on that Bearer.
 *     Approval is an ADMIN act on another surface (`join-api.ts`'s accept route), never anything the
 *     agent does for itself. The knock is rate-limited FIRST, then window-gated, both before any DB work.
 *  2. AGENT-GATED routes (`POST /print-api/agent/jobs`, `POST /print-api/agent/jobs/:id/result`) — each
 *     calls `requireAgent` (Bearer, 401 otherwise; a REVOKED agent fails instantly). The pull is a POST
 *     carrying the box's live inventory (`visible`/`scanned`, design §8): the server records it and
 *     claims by DERIVED eligibility (§5) — a usb/bluetooth printer only for the box that sees its
 *     `local_key`, a network_tcp printer for any box at its location. The claim CLAIMS-and-COMMITS within
 *     the request (Controller Ruling 6): the server holds NO lock or transaction across the remote
 *     agent's push — the agent pushes the bytes itself and REPORTs the outcome in a separate request.
 *     The pull also carries the venue's `nodeId` + routable `servers` so the agent follows the primary,
 *     and `discoveryUntil` so the box knows to actively scan while the window is open.
 *  3. `printer.manage`-GATED management routes (the agents list/revoke, the printers CRUD, the job list) —
 *     each calls `requireManagementSession` (401) then funnels its DB work through the local `gated`
 *     helper, which checks `printer.manage` (403), or `print.resend` for document resends, before the op runs.
 */
export function mountPrintApi(app: Hono, deps: PrintApiDeps, log: Logger): void {
  // The GLOBAL, in-memory, per-process knock rate-limiter (design §7 / the device knock precedent).
  // Built ONCE here so it is one bucket for the whole mounted API; a test may inject its own limiter
  // over a controllable clock, production omits it and gets the default `createEnrolRateLimiter()`
  // throwing the shared `device.join_rate_limited` (429).
  const enrolLimiter = deps.enrolRateLimiter ?? createEnrolRateLimiter();

  // Transient venue state (spec §6): the discovered inventory + the discovery window live in memory — no
  // table (owner, 2026-09-09). Agent polls rebuild them within ~2s of a restart.
  interface DiscoveredEntry {
    agentId: string;
    transport: string;
    localKey?: string;
    host?: string;
    port?: number;
    make?: string;
    model?: string;
    name?: string;
    pagePrinter?: true;
    lastSeenAt: number;
  }
  const discovered = new Map<string, DiscoveredEntry>(); // key: `${agentId}:${transport}:${localKey ?? host+":"+port}`
  const printerProbes = createPrinterProbes();
  let discoveryUntil = 0; // epoch ms; 0 = closed
  const DISCOVERY_WINDOW_MS = 3 * 60_000;
  const DISCOVERED_TTL_MS = 15_000;

  const gated = <T>(
    sessionId: string,
    fn: (tx: Transaction) => Promise<T>,
    permission: Permission = PRINTER_MANAGE_PERMISSION,
  ): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission,
      });
      return fn(tx);
    });

  // ── Knock (UNAUTHENTICATED) ──────────────────────────────────────────────────────────────────────
  app.post("/print-api/agent/join", (c) =>
    run(c, log, async () => {
      // Rate limit, then the window, BOTH before the body is parsed and before any DB work — so a flood
      // on this unauthenticated route draws no connection from the pool and creates no row (CLAUDE.md §5,
      // nothing external may block a sale). The device knock's exact ordering (`device-api.ts`); this
      // surface has no devMode auto-accept, so the window is always consulted.
      enrolLimiter.check();
      if (!deps.pairingMode.isOpen()) {
        deps.pairingMode.noteRefused();
        throw new AppError("device.pairing_closed", {});
      }
      const body = await readJsonBody<{ name?: unknown }>(c);
      const name = requireString(body.name, "name");
      const made = await withTransaction(deps.db, async (tx) => {
        await asAppUser(tx);
        return createJoinRequest(tx, deps.cfg, { kind: "print_agent", label: name });
      });
      // The token is `${joinId}.${secret}`: the joinId becomes the agent id (accept carries it onto the
      // `print_agents` row), so the Bearer the agent holds from now works unchanged after approval. The
      // secret is the agent's ONLY secret and leaves the process ONLY here, in the response body.
      return c.json(
        { token: `${made.joinId}.${made.token}`, verificationNumber: made.verificationNumber },
        201,
      );
    }),
  );

  // ── Am I in yet? (the joiner's own Bearer) ───────────────────────────────────────────────────────
  // Bearer, but NOT `requireAgent`: a pending token names a `join_requests` row, not yet a
  // `print_agents` one, so it must resolve through `readAgentJoinStatus`, not `authenticateAgent`.
  // Pending, approved and not_approved are the only three answers, and the last folds denied, lapsed and
  // never-existed together — the joiner's recovery (restart → re-join) is identical in every case.
  app.get("/print-api/agent/join/status", (c) =>
    run(c, log, async () => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
      const dot = bearer.indexOf(".");
      const joinId = dot > 0 ? bearer.slice(0, dot) : "";
      const secret = dot > 0 ? bearer.slice(dot + 1) : "";
      // A non-uuid selector names nothing — answered `not_approved` HERE, before it reaches a bare-uuid
      // comparison (which would `22P02` → an opaque 500), the device sibling's guard.
      if (!isUuid(joinId)) return c.json({ status: "not_approved" as const });
      const status = await withTransaction(deps.db, async (tx) => {
        await asAppUser(tx);
        return readAgentJoinStatus(tx, deps.cfg, joinId, secret);
      });
      return c.json({ status });
    }),
  );

  // ── Claim this agent's due jobs, carrying the box's live inventory (AGENT-GATED) ─────────────────
  // A POST, not a GET (design §8): the body carries the box's current inventory — the devices it can
  // already reach (`visible`) and, while a discovery window is open, what an active scan turned up
  // (`scanned`). The server records both in its in-memory discovered store and uses the visible USB/BT
  // keys as the claim's eligibility set (§5): a usb/bluetooth printer is claimed only by the box that
  // currently SEES its `local_key`, while a network_tcp printer is claimed by any box at the printer's
  // location.
  app.post("/print-api/agent/jobs", (c) =>
    run(c, log, async () => {
      const { agentId } = await requireAgent({ db: deps.db }, c);
      const body = await readJsonBody<{ visible?: unknown; scanned?: unknown; host?: unknown }>(c);
      const reportedHost = optionalString(body.host, "host");
      const host = reportedHost === undefined ? undefined : reportedHost.trim() || null;
      const visible = screenVisible(body.visible);
      const scanned = screenScanned(body.scanned);

      // Upsert the reported devices into the in-memory discovered inventory, stamping `lastSeenAt` so a
      // device the box stops reporting ages out of the dashboard's list by the TTL (read side below).
      const now = Date.now();
      const remember = (d: DiscoveredEntry): void => {
        const locator = d.localKey ?? `${d.host}:${d.port}`;
        discovered.set(`${agentId}:${d.transport}:${locator}`, d);
      };
      for (const v of visible) {
        remember({ agentId, ...v, lastSeenAt: now });
      }
      for (const s of scanned) {
        remember({ agentId, ...s, lastSeenAt: now });
      }

      // The eligibility keys: the local ids of the usb/bluetooth devices the box currently SEES. A
      // network printer's `scanned`/`visible` entry never contributes a claim key (network_tcp is
      // location-scoped, not key-scoped, §5).
      const visibleKeys = visible
        .filter((v) => v.transport === "usb" || v.transport === "bluetooth")
        .map((v) => v.localKey);

      // CLAIM-and-COMMIT within the request (Controller Ruling 6): the locking claim runs inside this
      // `withTransaction` transaction, which COMMITS when the handler returns — the HTTP response is the
      // commit boundary. The server then holds NO lock or transaction across the remote agent's socket
      // write; the agent pushes the bytes and REPORTs via `/result`.
      // TODO(multi-location): `deps.cfg.locationId` is THIS server's location, which equals the agent's
      // under one-location-per-DB. A future multi-location tenant reads the agent's own
      // `print_agents.location_id` instead of the server's.
      const claimed = await withTransaction(deps.db, async (tx) => {
        await asAppUser(tx);
        if (host !== undefined) {
          await tx
            .update(printAgents)
            .set({ host })
            .where(
              and(eq(printAgents.id, agentId), sql`${printAgents.host} is distinct from ${host}`),
            );
        }
        return claimPrintJobs(tx, agentId, {
          locationId: deps.cfg.locationId,
          visibleKeys,
        });
      });
      // The OPAQUE payload bytes ride as base64 over JSON (the agent decodes and pushes them verbatim);
      // the printer connection facts travel alongside so the agent's transport knows where to send — for
      // a usb/bluetooth job the box `resolve`s `localKey` to a device sink, for network_tcp it uses
      // host/port. `nodeId` + `servers` mirror the till's `GET /api/till` pull (till-api.ts): the agent
      // polls each routable server to follow the primary across a failover, and `nodeId` tells which it
      // is now on. `discoveryUntil` echoes the open window (null when shut) so the box knows to scan.
      const held = await deps.readMembership();
      const networkProbes = printerProbes.current();
      return c.json({
        nodeId: deps.cfg.nodeId,
        servers: routableServers(held),
        jobs: claimed.map((job) => ({
          id: job.id,
          printerId: job.printer_id,
          transport: job.transport,
          host: job.host,
          port: job.port,
          localKey: job.local_key,
          payload: Buffer.from(job.payload).toString("base64"),
        })),
        discoveryUntil: discoveryUntil > Date.now() ? discoveryUntil : null,
        ...(networkProbes.length ? { networkProbes } : {}),
      });
    }),
  );

  // ── Report one job's delivery outcome (AGENT-GATED) ──────────────────────────────────────────────
  app.post("/print-api/agent/jobs/:id/result", (c) =>
    run(c, log, async () => {
      const { agentId } = await requireAgent({ db: deps.db }, c);
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
      await withTransaction(deps.db, async (tx) => {
        await asAppUser(tx);
        return reportPrintJob(tx, { agentId, jobId, outcome });
      });
      return c.body(null, 204);
    }),
  );

  // ── List this tenant's print agents (printer.manage) ─────────────────────────────────────────────
  app.get("/management-api/print-agents", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Every agent in the database is this tenant's (one tenant per database). Newest enrolment
      // first. The `token_hash` is NEVER selected — a secret never leaves the row.
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            id: printAgents.id,
            name: printAgents.name,
            host: printAgents.host,
            active: printAgents.active,
            // Which node self-enrolled this agent over loopback, or NULL when a human enrolled it via
            // knock-and-accept (on-node auto-enrolment design §3) — the provenance the dashboard shows.
            nodeId: printAgents.nodeId,
            lastSeenAt: printAgents.lastSeenAt,
            enrolledAt: printAgents.enrolledAt,
          })
          .from(printAgents)
          .orderBy(desc(printAgents.enrolledAt)),
      );
      return c.json(rows);
    }),
  );

  app.patch("/management-api/print-agents/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrintAgentId");
      const body = await readJsonBody<{ name?: unknown }>(c);
      const name = requireString(body.name, "name").trim();
      if (name === "") throw new AppError("management.request_invalid", { field: "name" });
      const rows = await gated(sessionId, (tx) =>
        tx
          .update(printAgents)
          .set({ name })
          .where(eq(printAgents.id, id))
          .returning({ id: printAgents.id }),
      );
      if (rows.length === 0) throw new AppError("agent.not_found", { id });
      return c.body(null, 204);
    }),
  );

  // ── Revoke a print agent (printer.manage) ────────────────────────────────────────────────────────
  app.post("/management-api/print-agents/:id/revoke", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrintAgentId");
      // Revoke = flip `active = false` (instant — `requireAgent` rejects it), NEVER a hard
      // DELETE: an agent is a durable identity referenced by job claims and `app_user` holds
      // no DELETE. 0 rows (unknown id) → `agent.not_found`.
      const updated = await gated(sessionId, (tx) =>
        tx
          .update(printAgents)
          .set({ active: false })
          .where(eq(printAgents.id, id))
          .returning({ id: printAgents.id }),
      );
      if (updated.length === 0) throw new AppError("agent.not_found", { id });
      return c.body(null, 204);
    }),
  );

  // ── Allow a revoked print agent again (printer.manage) ───────────────────────────────────────────
  // The reverse of revoke: `active := true`. Revoke stopped being reversible by re-enrol once an
  // on-node agent refuses to auto-re-enrol while revoked (design §4) — without this action a mistaken
  // revoke of the box's own agent would permanently kill printing. 0 rows (unknown id) → agent.not_found.
  app.post("/management-api/print-agents/:id/allow", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrintAgentId");
      const updated = await gated(sessionId, (tx) =>
        tx
          .update(printAgents)
          .set({ active: true })
          .where(eq(printAgents.id, id))
          .returning({ id: printAgents.id }),
      );
      if (updated.length === 0) throw new AppError("agent.not_found", { id });
      return c.body(null, 204);
    }),
  );

  // ── Open the venue discovery window (printer.manage) ─────────────────────────────────────────────
  // The operator clicks "Scan for printers" (design §6): opens a short venue-wide window, held as a
  // `discoveryUntil` timestamp in server memory (like the pairing window), which the agent pull echoes so
  // each box runs its expensive active scan `while now < discoveryUntil`. `gated` authorises
  // `printer.manage` (a session DB read) but does no printer/job work; the window is a memory write.
  app.post("/management-api/printer-discovery/start", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, async () => {}); // authorises printer.manage; no printer/job work
      discoveryUntil = Date.now() + DISCOVERY_WINDOW_MS;
      return c.json({ discoveryUntil });
    }),
  );

  app.post("/management-api/printer-discovery/probe", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, async () => {});
      const body = await readJsonBody<Record<string, unknown>>(c);
      return c.json(printerProbes.add(body));
    }),
  );

  // ── The merged discovered-printer list (printer.manage) ──────────────────────────────────────────
  // The dashboard's create flow (design §6/§10): every device the agents currently report, each carrying
  // the registered printer it matches (`printerId` — a usb/bluetooth device on its `local_key`, a network
  // device on host:port) and the time of the report that last carried it (`lastSeenAt`). Stale entries
  // (a device the box stopped reporting) are pruned by the TTL first. Two reads back the merge — the
  // registered printers' ids and connection columns, and the agents' names.
  app.get("/management-api/discovered-printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const now = Date.now();
      for (const [k, e] of discovered)
        if (now - e.lastSeenAt > DISCOVERED_TTL_MS) discovered.delete(k);
      const { registered, agents } = await gated(sessionId, async (tx) => ({
        registered: await tx
          .select({
            id: printers.id,
            localKey: printers.localKey,
            host: printers.host,
            port: printers.port,
          })
          .from(printers),
        agents: await tx.select({ id: printAgents.id, name: printAgents.name }).from(printAgents),
      }));
      const names = new Map(agents.map((a) => [a.id, a.name]));
      // A usb/bluetooth device matches a registered printer on its stable local key; a network printer
      // has none and is keyed on host:port (packages/db/src/schema/printers.ts), so a scan result of one
      // already registered matches on that pair — same host on another port is a different printer.
      const byKey = new Map<string, string>();
      const byHostPort = new Map<string, string>();
      // A null port (a PATCH may clear the column's 9100 default) prints on 9100 — the transport's
      // default — so it matches a scan on 9100 too.
      for (const r of registered) {
        if (r.localKey !== null) byKey.set(r.localKey, r.id);
        if (r.host !== null) byHostPort.set(`${r.host}:${r.port ?? 9100}`, r.id);
      }
      const printerIdOf = (e: DiscoveredEntry): string | null =>
        (e.localKey !== undefined ? byKey.get(e.localKey) : undefined) ??
        (e.host !== undefined ? byHostPort.get(`${e.host}:${e.port ?? 9100}`) : undefined) ??
        null;
      // Each agent checks on its own and a failed check leaves a device unmarked, so an address is an
      // office printer for every agent's entry once any agent reporting that address marked it.
      const pagePrinterAddresses = new Set<string>();
      for (const e of discovered.values())
        if (e.pagePrinter && e.host !== undefined)
          pagePrinterAddresses.add(`${e.host}:${e.port ?? 9100}`);
      return c.json(
        [...discovered.values()].map((e) => {
          const printerId = printerIdOf(e);
          return {
            agentId: e.agentId,
            agentName: names.get(e.agentId) ?? null,
            transport: e.transport,
            localKey: e.localKey,
            host: e.host,
            port: e.port,
            make: e.make,
            model: e.model,
            name: e.name,
            pagePrinter:
              e.host !== undefined && pagePrinterAddresses.has(`${e.host}:${e.port ?? 9100}`)
                ? (true as const)
                : undefined,
            alreadyRegistered: printerId !== null,
            printerId,
            lastSeenAt: new Date(e.lastSeenAt).toISOString(),
          };
        }),
      );
    }),
  );

  // ── Create a printer (printer.manage) ────────────────────────────────────────────────────────────
  app.post("/management-api/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      // Screen the SHAPE here; `createPrinter` owns the required-field check (`printer.invalid_config`)
      // and the DB owns the transport CHECK + the partial `local_key` UNIQUE (mapped friendly to
      // `printer.already_registered`). Which agent serves a printer is DERIVED at run time from the
      // devices it sees (design §3), never stored — the body carries no `agentId`.
      const input: CreatePrinterInput = {
        name: requireString(body.name, "name"),
        transport: requireEnum(body.transport, "transport", printTransport.enumValues),
      };
      const host = optionalString(body.host, "host");
      if (host !== undefined) input.host = host;
      const port = nullableOptionalInt(body.port, "port");
      if (port !== undefined && port !== null) input.port = port;
      const localKey = optionalString(body.localKey, "localKey");
      if (localKey !== undefined) input.localKey = localKey;
      const pollId = optionalString(body.pollId, "pollId");
      if (pollId !== undefined) input.pollId = pollId;
      if (body.paperWidth !== undefined) {
        input.paperWidth = requireEnum(body.paperWidth, "paperWidth", printPaperWidth.enumValues);
      }
      if (body.resolution !== undefined) {
        input.resolution = requireEnum(body.resolution, "resolution", printResolution.enumValues);
      }
      if (body.characterSet !== undefined) {
        input.characterSet = requireEnum(
          body.characterSet,
          "characterSet",
          printCharacterSet.enumValues,
        );
      }
      const characterTable = optionalByte(body.characterTable, "characterTable");
      if (characterTable !== undefined) input.characterTable = characterTable;
      const created = await gated(sessionId, (tx) => createPrinter(tx, deps.cfg, input));
      return c.json(created, 201);
    }),
  );

  // ── List this tenant's printers (printer.manage) ─────────────────────────────────────────────────
  app.get("/management-api/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, async (tx) => {
        const configured = await listPrinters(tx, deps.cfg);
        // Aggregate the full tenant history: the queue includes only bounded completed history.
        const summaries = await tx.execute<{
          printer_id: string;
          pending_jobs: number;
          last_print_at: number | null;
        }>(sql`
          select printer_id,
            count(*) filter (where status in ('queued', 'printing')
              or (status = 'failed' and attempts < ${MAX_DELIVERY_ATTEMPTS}))::int as pending_jobs,
            (extract(epoch from max(delivered_at)) * 1000)::double precision as last_print_at
          from print_jobs
          group by printer_id`);
        const byPrinter = new Map(summaries.rows.map((row) => [row.printer_id, row]));
        return configured.map((printer) => {
          const summary = byPrinter.get(printer.id);
          return {
            ...printer,
            pendingJobs: summary?.pending_jobs ?? 0,
            lastPrintAt:
              summary?.last_print_at == null ? null : new Date(summary.last_print_at).toISOString(),
          };
        });
      });
      return c.json(rows);
    }),
  );

  // ── Update a printer (printer.manage) ────────────────────────────────────────────────────────────
  app.patch("/management-api/printers/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      // Every field OPTIONAL (a PATCH touches only what it names); the connection fields accept an
      // explicit `null` to CLEAR them. `updatePrinter` 404s a missing id and maps the DB CHECK / the
      // partial `local_key` UNIQUE to `printer.invalid_config` / `printer.already_registered`. No
      // `agentId`: which agent serves a printer is derived at run time (design §3), never stored.
      const patch: UpdatePrinterInput = {};
      const name = optionalString(body.name, "name");
      if (name !== undefined) patch.name = name;
      if (body.transport !== undefined) {
        patch.transport = requireEnum(body.transport, "transport", printTransport.enumValues);
      }
      const host = nullableOptionalString(body.host, "host");
      if (host !== undefined) patch.host = host;
      const port = nullableOptionalInt(body.port, "port");
      if (port !== undefined) patch.port = port;
      const localKey = nullableOptionalString(body.localKey, "localKey");
      if (localKey !== undefined) patch.localKey = localKey;
      const pollId = nullableOptionalString(body.pollId, "pollId");
      if (pollId !== undefined) patch.pollId = pollId;
      if (body.ticketScope !== undefined) {
        patch.ticketScope = requireEnum(
          body.ticketScope,
          "ticketScope",
          printTicketScope.enumValues,
        );
      }
      if (body.paperWidth !== undefined) {
        patch.paperWidth = requireEnum(body.paperWidth, "paperWidth", printPaperWidth.enumValues);
      }
      if (body.resolution !== undefined) {
        patch.resolution = requireEnum(body.resolution, "resolution", printResolution.enumValues);
      }
      if (body.characterSet !== undefined) {
        patch.characterSet = requireEnum(
          body.characterSet,
          "characterSet",
          printCharacterSet.enumValues,
        );
      }
      const characterTable = optionalByte(body.characterTable, "characterTable");
      if (characterTable !== undefined) patch.characterTable = characterTable;
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
      // Use the dashboard's language resolution for the operator's instructions. Delivery stays
      // asynchronous through the print outbox, independently of the printer's connection.
      const result = await gated(sessionId, async (tx) => {
        const session = await resolveManagementSession(tx, sessionId, { touch: false });
        const locale = resolveActiveLocale(
          session.locale,
          resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale),
        );
        return enqueuePrintJob(tx, deps.cfg, id, formatTestPage({ locale }));
      });
      // 202 Accepted: the job is QUEUED for asynchronous delivery, not printed within the request.
      return c.json(result, 202);
    }),
  );

  // ── Sample receipt with the editor's current draft settings (printer.manage) ───────────────────
  app.post("/management-api/printers/:id/sample-receipt", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const characterTable = optionalByte(body.characterTable, "characterTable");
      if (characterTable === undefined) {
        throw new AppError("management.request_invalid", { field: "characterTable" });
      }
      const payload = formatSampleReceipt({
        paperWidth: requireEnum(body.paperWidth, "paperWidth", printPaperWidth.enumValues),
        resolution: requireEnum(body.resolution, "resolution", printResolution.enumValues),
        characterSet: requireEnum(body.characterSet, "characterSet", printCharacterSet.enumValues),
        characterTable,
      });
      const result = await gated(sessionId, (tx) => enqueuePrintJob(tx, deps.cfg, id, payload));
      return c.json(result, 202);
    }),
  );

  app.post("/management-api/printers/:id/character-table-test", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const startTable = optionalByte(body.startTable, "startTable");
      if (startTable === undefined) {
        throw new AppError("management.request_invalid", { field: "startTable" });
      }
      const result = await gated(sessionId, (tx) =>
        enqueuePrintJob(tx, deps.cfg, id, formatCharacterTableTest(startTable)),
      );
      return c.json(result, 202);
    }),
  );

  // ── Print queue and recent completions (printer.manage) ─────────────────────────────────────────
  app.get("/management-api/print-jobs", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => {
        const recentCompleted = tx
          .select({ id: printJobs.id })
          .from(printJobs)
          .where(eq(printJobs.status, "done"))
          .orderBy(sql`${printJobs.deliveredAt} desc nulls last`, desc(printJobs.id))
          .limit(RECENT_JOBS_LIMIT);
        const recentFailed = tx
          .select({ id: printJobs.id })
          .from(printJobs)
          .where(
            and(eq(printJobs.status, "failed"), gte(printJobs.attempts, MAX_DELIVERY_ATTEMPTS)),
          )
          .orderBy(desc(printJobs.createdAt), desc(printJobs.id))
          .limit(RECENT_JOBS_LIMIT);
        return tx
          .select({
            id: printJobs.id,
            printerId: printJobs.printerId,
            status: printJobs.status,
            kind: printJobs.kind,
            attempts: printJobs.attempts,
            lastError: printJobs.lastError,
            createdAt: printJobs.createdAt,
            deliveredAt: printJobs.deliveredAt,
          })
          .from(printJobs)
          .where(
            or(
              and(ne(printJobs.status, "done"), ne(printJobs.status, "failed")),
              and(eq(printJobs.status, "failed"), lt(printJobs.attempts, MAX_DELIVERY_ATTEMPTS)),
              inArray(printJobs.id, recentCompleted),
              inArray(printJobs.id, recentFailed),
            ),
          )
          .orderBy(desc(printJobs.createdAt), desc(printJobs.id));
      });
      return c.json(
        rows.map(({ kind, ...job }) => ({
          ...job,
          canResend: canResendPrintJob({ ...job, kind }),
        })),
      );
    }),
  );

  app.post("/management-api/print-jobs/:id/resend", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrintJobId");
      const result = await gated(sessionId, (tx) => resendPrintJob(tx, id), "print.resend");
      return c.json(result, 202);
    }),
  );

  app.get("/management-api/print-jobs/:id/preview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrintJobId");
      const [job] = await gated(sessionId, (tx) =>
        tx
          .select({
            payload: printJobs.payload,
            paperWidth: printers.paperWidth,
            resolution: printers.resolution,
            characterSet: printers.characterSet,
          })
          .from(printJobs)
          .innerJoin(printers, eq(printers.id, printJobs.printerId))
          .where(eq(printJobs.id, id)),
      );
      if (job === undefined) throw new AppError("print_job.not_found", { id });
      // The printer's CURRENT settings: a job built for 42 columns previews as it would print now.
      return c.json(
        previewPrintJob(job.payload, {
          columns: columnsFor(job.paperWidth),
          dpi: dpiValue(job.resolution),
          characterSet: job.characterSet,
        }),
      );
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
      await gated(sessionId, (tx) => attachPrinterToStation(tx, { stationId, printerId }));
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

  // ── List a station's printers (printer.manage)
  // ─────────────────────────────────────────────────── The station-centric read: which printers
  // a station prints to (the config editor's per-station view). `:sid` is
  // `requireUuidParam`-screened first.
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

  // ── List this tenant's tills (printer.manage)
  // ──────────────────────────────────────────────────── Counter receipt/drawer §3d/§5 — the DATA
  // SOURCE for the dashboard's per-till receipt-printer picker (it does not exist elsewhere).
  // Returns each till as `{ id, label, locationId, receiptPrinterId }`: `label` projects
  // `tills.name` (the till's display name — the column is `name`, the picker calls it a label),
  // `locationId` is the till's location (so the picker can offer that location's printers), and
  // `receiptPrinterId` the currently-set receipt printer (null = none) so the picker reflects the
  // persisted value across a reload. Lives beside the sibling `PATCH
  // …/tills/:id/receipt-printer`, funnelled through the SAME `gated` helper so `printer.manage`
  // is enforced identically (the by-deletion proof on that helper covers this route too). Runs in
  // `gated`'s `withTransaction` + `asAppUser` transaction. Ordered by name for a stable list.
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
  // → `printer.not_found` (404, reused from Slice A), which also keeps the FK from 23503-ing an
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
        // The till must exist. Read its location so a named printer is validated against the till's
        // OWN location — "from the location's printers" (§5).
        const [till] = await tx
          .select({ locationId: tills.locationId })
          .from(tills)
          .where(eq(tills.id, tillId));
        if (till === undefined) {
          throw new AppError("management.request_invalid", { field: "tillId" });
        }
        if (printerId !== null) {
          const [printer] = await tx
            .select({ id: printers.id })
            .from(printers)
            .where(
              and(
                eq(printers.id, printerId),
                eq(printers.locationId, till.locationId),
                eq(printers.active, true),
              ),
            );
          if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });
        }
        await tx.update(tills).set({ receiptPrinterId: printerId }).where(eq(tills.id, tillId));
      });
      return c.body(null, 204);
    }),
  );

  // ── Set a location's receipt print mode (printer.manage)
  // ───────────────────────────────────────── Counter receipt/drawer §3d/§5 — the dashboard's
  // per-location print-mode toggle (`auto`/`on_request`/`never`, which the print-on-sale hook
  // reads). Same `gated` / `printer.manage` gate + `requireUuidParam` id screen as the till route
  // above. `mode` is screened to the `receipt_print_mode` enum's members
  // (`management.request_invalid`, 400, before the enum column). An unknown location is
  // `management.request_invalid` (400) — there is no `location.*` code, the same request-shape treatment the unknown-till case above takes.
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
          .where(eq(locations.id, locationRowId))
          .returning({ id: locations.id });
        if (updated.length === 0) {
          throw new AppError("management.request_invalid", { field: "locationId" });
        }
      });
      return c.body(null, 204);
    }),
  );

  // ── Set a location's cash-drawer-open policy (printer.manage)
  // ───────────────────────────────────── Cash-drawer-authorization §5 — the dashboard's
  // per-location drawer-policy toggle (`gated`/`open`, which the till's drawer-open authorize()
  // hook reads). One-for-one SIBLING of the receipt-print-mode route above: same `gated` /
  // `printer.manage` gate + `requireUuidParam` id screen. `policy` is screened to the
  // `drawer_open_policy` enum's members (`management.request_invalid`, 400, before the enum
  // column). An unknown location is `management.request_invalid` (400) — there is no `location.*`
  // code, the same request-shape treatment the receipt-print-mode route takes.
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
          .where(eq(locations.id, locationRowId))
          .returning({ id: locations.id });
        if (updated.length === 0) {
          throw new AppError("management.request_invalid", { field: "locationId" });
        }
      });
      return c.body(null, 204);
    }),
  );
}

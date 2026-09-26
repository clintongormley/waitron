// Load server-owned error codes; imported printing verbs load the printing registry.
import "./errors.js";
import { createPrinterProbes } from "./printer-probes.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { AppError, resolveActiveLocale } from "@waitron/shared";
import type { SupportedLocale } from "@waitron/shared";
import {
  drawerOpenPolicy,
  drawerOpens,
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
  esc,
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

export interface PrintApiDeps {
  db: Database;
  cfg: TillConfig;
  readMembership: () => Promise<SignedMembershipDocument | null>;
  pairingMode: PairingMode;
  /** Injected by tests over a controllable clock; production gets the default limiter. */
  enrolRateLimiter?: EnrolRateLimiter;
  /** Fallback language for test instructions when neither the user nor the browser has a preference. */
  venueLocale: SupportedLocale;
  /** This node's advertised LAN addresses, for its self-enrolled print agent. */
  listIpv4?: () => string[];
}

const PRINTER_MANAGE_PERMISSION: Permission = "printer.manage";

const RECENT_JOBS_LIMIT = 100;

/**
 * A code absent from this table answers 400; an error that is not an AppError answers an opaque
 * `server.internal` 500. The agent joins through the device knock and its client reads the HTTP
 * status, not the code, so the knock refusals reuse the `device.*` codes.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "agent.unauthorized": 401,
  "device.pairing_closed": 403,
  "device.join_full": 429,
  "device.join_rate_limited": 429,
  "printer.not_found": 404,
  "printer.probe_busy": 429,
  "print_job.not_found": 404,
  "print_job.not_resendable": 409,
  "printer.invalid_config": 422,
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

const run = createErrorBoundary(STATUS, "print.failed");

function optionalString(v: unknown, field: string): string | undefined {
  if (v === undefined) return undefined;
  return requireString(v, field);
}

function optionalAgentSetupUrl(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  const raw = requireString(value, "setupUrl");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("management.request_invalid", { field: "setupUrl" });
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    ["localhost", "0.0.0.0", "[::]", "[::1]"].includes(url.hostname) ||
    url.hostname.startsWith("127.")
  ) {
    throw new AppError("management.request_invalid", { field: "setupUrl" });
  }
  return url.origin;
}

function optionalAgentSetupPort(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new AppError("management.request_invalid", { field: "setupPort" });
  }
  return value;
}

function nullableOptionalString(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return requireString(v, field);
}

function nullableOptionalInt(v: unknown, field: string): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new AppError("management.request_invalid", { field });
  }
  return v;
}

function optionalByte(v: unknown, field: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 0xff) {
    throw new AppError("management.request_invalid", { field });
  }
  return v;
}

function optionalBool(v: unknown, field: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new AppError("management.request_invalid", { field });
  return v;
}

/**
 * The inventory the agent posts on every pull. `visible` is what the box can already reach, each with
 * a `localKey`; `scanned` is a discovery result of any transport. Only `visible` keys feed the claim's
 * eligibility.
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

/** A malformed wire field is dropped, not refused, so a bad report cannot poison the in-memory store. */
function wireString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

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

export function mountPrintApi(app: Hono, deps: PrintApiDeps, log: Logger): void {
  // Built once, so it is one bucket for the whole mounted API.
  const enrolLimiter = deps.enrolRateLimiter ?? createEnrolRateLimiter();

  // The discovered inventory and the discovery window live in memory only; agent polls rebuild them
  // after a restart.
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
  const discovered = new Map<string, DiscoveredEntry>();
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
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission,
      });
      return fn(tx);
    });

  app.post("/print-api/agent/join", (c) =>
    run(c, log, async () => {
      // Rate limit, then the window, both before any DB work, so a flood on this unauthenticated route
      // creates no row.
      enrolLimiter.check();
      if (!deps.pairingMode.isOpen()) {
        deps.pairingMode.noteRefused();
        throw new AppError("device.pairing_closed", {});
      }
      const body = await readJsonBody<{ name?: unknown }>(c);
      const name = requireString(body.name, "name");
      const made = await withTransaction(deps.db, async (tx) => {
        return createJoinRequest(tx, deps.cfg, { kind: "print_agent", label: name });
      });
      // The joinId becomes the agent id on accept, so this Bearer works unchanged after approval. The
      // secret leaves the process only here.
      return c.json(
        { token: `${made.joinId}.${made.token}`, verificationNumber: made.verificationNumber },
        201,
      );
    }),
  );

  // Bearer, but not `requireAgent`: a pending token names a `join_requests` row, not yet a
  // `print_agents` one.
  app.get("/print-api/agent/join/status", (c) =>
    run(c, log, async () => {
      const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
      const dot = bearer.indexOf(".");
      const joinId = dot > 0 ? bearer.slice(0, dot) : "";
      const secret = dot > 0 ? bearer.slice(dot + 1) : "";
      if (!isUuid(joinId)) return c.json({ status: "not_approved" as const });
      const status = await withTransaction(deps.db, async (tx) => {
        return readAgentJoinStatus(tx, deps.cfg, joinId, secret);
      });
      return c.json({ status });
    }),
  );

  // A usb/bluetooth printer is claimed only by the box that currently sees its `local_key`; a
  // network_tcp printer by any box at the printer's location.
  app.post("/print-api/agent/jobs", (c) =>
    run(c, log, async () => {
      const { agentId } = await requireAgent({ db: deps.db }, c);
      const body = await readJsonBody<{
        visible?: unknown;
        scanned?: unknown;
        host?: unknown;
        setupUrl?: unknown;
        setupPort?: unknown;
      }>(c);
      const reportedHost = optionalString(body.host, "host");
      const host = reportedHost === undefined ? undefined : reportedHost.trim() || null;
      const setupUrl = optionalAgentSetupUrl(body.setupUrl);
      const setupPort = optionalAgentSetupPort(body.setupPort);
      const visible = screenVisible(body.visible);
      const scanned = screenScanned(body.scanned);

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

      const visibleKeys = visible
        .filter((v) => v.transport === "usb" || v.transport === "bluetooth")
        .map((v) => v.localKey);

      // The claim commits within this request: no transaction is held across the agent's socket write,
      // and the agent reports the outcome in a separate request.
      // TODO(multi-location): this is the server's location, not the agent's `print_agents.location_id`.
      const claimed = await withTransaction(deps.db, async (tx) => {
        if (host !== undefined || setupUrl !== undefined || setupPort !== undefined) {
          await tx
            .update(printAgents)
            .set({ host, setupUrl, setupPort })
            .where(
              and(
                eq(printAgents.id, agentId),
                or(
                  host === undefined
                    ? undefined
                    : sql`${printAgents.host} is distinct from ${host}`,
                  setupUrl === undefined
                    ? undefined
                    : sql`${printAgents.setupUrl} is distinct from ${setupUrl}`,
                  setupPort === undefined
                    ? undefined
                    : sql`${printAgents.setupPort} is distinct from ${setupPort}`,
                ),
              ),
            );
        }
        return claimPrintJobs(tx, agentId, {
          locationId: deps.cfg.locationId,
          visibleKeys,
        });
      });
      // `servers` lets the agent follow the primary across a failover, as the till's pull does.
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

  app.post("/print-api/agent/jobs/:id/result", (c) =>
    run(c, log, async () => {
      const { agentId } = await requireAgent({ db: deps.db }, c);
      const jobId = requireUuidParam(c.req.param("id"), "PrintJobId");
      const body = await readJsonBody<{ status?: unknown; error?: unknown }>(c);
      const status = requireEnum(body.status, "status", ["done", "failed"] as const);
      const outcome =
        status === "done"
          ? ({ status: "done" } as const)
          : ({ status: "failed", error: requireString(body.error ?? "", "error") } as const);
      // `reportPrintJob` changes only a printing job this agent claimed. The 204 is the same whether or
      // not a row matched, so it discloses no job ids.
      await withTransaction(deps.db, async (tx) => {
        return reportPrintJob(tx, { agentId, jobId, outcome });
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/print-agents", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // `token_hash` is never selected.
      const rows = await gated(sessionId, (tx) =>
        tx
          .select({
            id: printAgents.id,
            name: printAgents.name,
            host: printAgents.host,
            setupUrl: printAgents.setupUrl,
            setupPort: printAgents.setupPort,
            active: printAgents.active,
            nodeId: printAgents.nodeId,
            lastSeenAt: printAgents.lastSeenAt,
            enrolledAt: printAgents.enrolledAt,
          })
          .from(printAgents)
          .orderBy(desc(printAgents.enrolledAt)),
      );
      const address = deps.listIpv4?.()[0];
      return c.json(
        rows.map(({ setupPort, ...row }) => ({
          ...row,
          setupUrl:
            row.setupUrl ??
            (row.nodeId === deps.cfg.nodeId && setupPort !== null && address !== undefined
              ? new URL(`http://${address}:${setupPort}`).origin
              : null),
        })),
      );
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

  app.post("/management-api/print-agents/:id/revoke", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrintAgentId");
      // Never a hard delete: job claims reference the agent.
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

  // Self-enrol does not reactivate a revoked row, so without this a mistaken revoke of the box's own
  // agent would stop its printing for good.
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

  app.post("/management-api/printer-discovery/start", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, async () => {});
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
      const byKey = new Map<string, string>();
      const byHostPort = new Map<string, string>();
      // A null port prints on the transport's default 9100, so it matches a scan on 9100.
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

  app.post("/management-api/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      // Only the shape is screened here; `createPrinter` owns the required-field check.
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
      const hasCashDrawer = optionalBool(body.hasCashDrawer, "hasCashDrawer");
      if (hasCashDrawer !== undefined) input.hasCashDrawer = hasCashDrawer;
      const created = await gated(sessionId, (tx) => createPrinter(tx, deps.cfg, input));
      return c.json(created, 201);
    }),
  );

  app.get("/management-api/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, async (tx) => {
        const configured = await listPrinters(tx, deps.cfg);
        // Aggregated over the full history, unlike the job list's bounded completed history.
        // `max(delivered_at)` is the latest instant only because every writer stores the canonical
        // `toISOString()` spelling.
        const summaries = await tx.execute<{
          printer_id: string;
          pending_jobs: number;
          last_print_at: string | null;
          last_print_agent_id: string | null;
        }>(sql`
          select printer_id,
            cast(count(*) filter (where status in ('queued', 'printing')
              or (status = 'failed' and attempts < ${MAX_DELIVERY_ATTEMPTS})) as int) as pending_jobs,
            max(delivered_at) as last_print_at,
            (select latest.claimed_by from print_jobs latest
              where latest.printer_id = jobs.printer_id and latest.delivered_at is not null
              order by latest.delivered_at desc, latest.id desc limit 1) as last_print_agent_id
          from print_jobs jobs
          group by printer_id`);
        const byPrinter = new Map(summaries.rows.map((row) => [row.printer_id, row]));
        return configured.map((printer) => {
          const summary = byPrinter.get(printer.id);
          return {
            ...printer,
            pendingJobs: summary?.pending_jobs ?? 0,
            lastPrintAgentId: summary?.last_print_agent_id ?? null,
            lastPrintAt:
              summary?.last_print_at == null ? null : new Date(summary.last_print_at).toISOString(),
          };
        });
      });
      return c.json(rows);
    }),
  );

  app.patch("/management-api/printers/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      // The connection fields accept an explicit `null` to clear them.
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
      const hasCashDrawer = optionalBool(body.hasCashDrawer, "hasCashDrawer");
      if (hasCashDrawer !== undefined) patch.hasCashDrawer = hasCashDrawer;
      const active = optionalBool(body.active, "active");
      if (active !== undefined) patch.active = active;
      await gated(sessionId, (tx) => updatePrinter(tx, deps.cfg, id, patch));
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/printers/:id/deactivate", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      await gated(sessionId, (tx) => deactivatePrinter(tx, deps.cfg, id));
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/printers/:id/test-drawer", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const result = await gated(sessionId, async (tx) => {
        const { authorizedBy } = await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "cash.drawer",
        });
        const queued = await enqueuePrintJob(tx, deps.cfg, id, esc().kick().bytes(), "drawer");
        await tx.insert(drawerOpens).values({
          printerId: id,
          personId: authorizedBy,
          authorizedBy,
          reason: "calibration",
        });
        return queued;
      });
      return c.json(result, 202);
    }),
  );

  app.post("/management-api/printers/:id/test-print", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const result = await gated(sessionId, async (tx) => {
        const session = await resolveManagementSession(tx, sessionId, { touch: false });
        const locale = resolveActiveLocale(
          session.locale,
          resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale),
        );
        return enqueuePrintJob(tx, deps.cfg, id, formatTestPage({ locale }));
      });
      return c.json(result, 202);
    }),
  );

  // Prints with the editor's current draft settings, not the saved ones.
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
      const result = await gated(sessionId, async (tx) => {
        const session = await resolveManagementSession(tx, sessionId, { touch: false });
        const locale = resolveActiveLocale(
          session.locale,
          resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale),
        );
        const queued = await enqueuePrintJob(
          tx,
          deps.cfg,
          id,
          formatCharacterTableTest({
            startTable,
            locale,
            calibrationLocale: deps.venueLocale,
          }),
        );
        return { ...queued, calibrationLocale: deps.venueLocale };
      });
      return c.json(result, 202);
    }),
  );

  // Unfinished jobs are listed whatever their age; completed and exhausted history is bounded.
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
            characterTable: printers.characterTable,
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
          characterTable: job.characterTable,
        }),
      );
    }),
  );

  app.post("/management-api/stations/:sid/printers/:pid", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const stationId = requireUuidParam(c.req.param("sid"), "StationId");
      const printerId = requireUuidParam(c.req.param("pid"), "PrinterId");
      await gated(sessionId, (tx) => attachPrinterToStation(tx, { stationId, printerId }));
      return c.body(null, 204);
    }),
  );

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

  app.get("/management-api/stations/:sid/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const stationId = requireUuidParam(c.req.param("sid"), "StationId");
      const rows = await gated(sessionId, (tx) => listStationPrinters(tx, deps.cfg, { stationId }));
      return c.json(rows);
    }),
  );

  app.get("/management-api/printers/:pid/stations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const printerId = requireUuidParam(c.req.param("pid"), "PrinterId");
      const rows = await gated(sessionId, (tx) => listStationPrinters(tx, deps.cfg, { printerId }));
      return c.json(rows);
    }),
  );

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

  // An unknown till is `management.request_invalid`: there is no `till.*` code.
  app.patch("/management-api/tills/:id/receipt-printer", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const tillId = requireUuidParam(c.req.param("id"), "TillId");
      const body = await readJsonBody<{ printerId?: unknown }>(c);
      // Required: a printer id sets, an explicit null clears.
      if (!("printerId" in body)) {
        throw new AppError("management.request_invalid", { field: "printerId" });
      }
      const printerId =
        body.printerId === null ? null : requireBodyUuid(body.printerId, "printerId");
      await gated(sessionId, async (tx) => {
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

  // An unknown location is `management.request_invalid`: there is no `location.*` code.
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

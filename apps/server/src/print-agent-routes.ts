import { withTransaction, printAgents } from "@waitron/db";
import { routableServers } from "@waitron/membership";
import type { InvoicePrintClaim } from "@waitron/print-agent";
import {
  type Logger,
  readJsonBody,
  requireString,
  requireUuidParam,
  requireEnum,
} from "@waitron/server-kit";
import { AppError, isUuid, steadyNow } from "@waitron/shared";
import { and, eq, or, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { isDeepStrictEqual } from "node:util";
import { withinTtl } from "./discovery-listing.js";
import type { EnrolRateLimiter } from "./enrol-rate-limit.js";
import { claimInvoicePrintJobs, reportInvoicePrintJob } from "./invoice-print.js";
import { discardLapsedRequests, createJoinRequest, readAgentJoinStatus } from "./join-requests.js";
import { publishState } from "./live-publish.js";
import {
  type DiscoveredDeviceWire,
  type AgentBluetooth,
  optionalAgentSetupUrl,
  optionalAgentSetupPort,
  screenVisible,
  screenScanned,
  screenPairedBluetooth,
  screenBluetoothOutcomes,
  screenBluetooth,
} from "./print-agent-reports.js";
import { requireAgent } from "./print-agent-session.js";
import type { PrintApiDeps } from "./print-api-deps.js";
import { run } from "./print-api-errors.js";
import type { DiscoveredEntry } from "./print-discovery-types.js";
import { optionalString } from "./print-request-fields.js";
import type { createPrinterBluetoothCommands } from "./printer-bluetooth-commands.js";
import type { createPrinterProbes } from "./printer-probes.js";

function readInvoicePrintClaim(value: unknown): InvoicePrintClaim | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("management.request_invalid", { field: "invoiceClaim" });
  }
  const claim = value as Record<string, unknown>;
  if (typeof claim.token !== "string" || !isUuid(claim.token) || Object.keys(claim).length !== 1) {
    throw new AppError("management.request_invalid", { field: "invoiceClaim" });
  }
  return { token: claim.token };
}

export function mountPrintAgentRoutes(
  app: Hono,
  deps: PrintApiDeps,
  enrolLimiter: EnrolRateLimiter,
  discovered: Map<string, DiscoveredEntry>,
  keyOf: (agentId: string, transport: string, locator: string) => string,
  description: (entry: DiscoveredEntry | undefined, now: number) => { paired: boolean } | undefined,
  queueKeyOf: (device: DiscoveredDeviceWire) => string | undefined,
  agentBluetooth: ReadonlyMap<string, { value: AgentBluetooth; at: number }>,
  rememberAgentBluetooth: (agentId: string, value: AgentBluetooth, at: number) => void,
  AGENT_BLUETOOTH_TTL_MS: number,
  waitForJobs: (
    agentId: string,
    visibleKeys: string[],
    initial: Awaited<ReturnType<typeof claimInvoicePrintJobs>>,
    wait: number,
    signal: AbortSignal,
  ) => ReturnType<typeof claimInvoicePrintJobs>,
  printerProbes: ReturnType<typeof createPrinterProbes>,
  bluetoothCommands: ReturnType<typeof createPrinterBluetoothCommands>,
  discoveryLeftMs: () => number,
  log: Logger,
): void {
  app.post("/print-api/agent/join", (c) =>
    run(c, log, async () => {
      // Rate limit, then the window, both before any DB work, so a flood on this unauthenticated route
      // creates no row.
      enrolLimiter.check();
      const opening = deps.pairingMode.opening();
      if (opening === null) throw new AppError("device.pairing_closed", {});
      const body = await readJsonBody<{ name?: unknown; previouslyDenied?: unknown }>(c);
      const name = requireString(body.name, "name");
      if (body.previouslyDenied !== undefined && typeof body.previouslyDenied !== "boolean")
        throw new AppError("management.request_invalid", { field: "previouslyDenied" });
      let dropped: string[] = [];
      const made = await withTransaction(deps.db, async (tx) => {
        if (deps.pairingMode.opening() !== opening) throw new AppError("device.pairing_closed", {});
        dropped = await discardLapsedRequests(tx, deps.cfg, deps.pairingMode);
        const request = await createJoinRequest(tx, deps.cfg, { kind: "print_agent", label: name });
        if (body.previouslyDenied === true) deps.pairingMode.markPreviouslyDenied(request.joinId);
        return request;
      });
      for (const id of dropped) deps.pairingMode.dropClaim(id);
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
      const status = await readAgentJoinStatus(deps.db, deps.cfg, joinId, secret, deps.pairingMode);
      if (status === "denied") return c.json({ status: "not_approved", denied: true });
      if (status === "revoked") return c.json({ status: "not_approved", revoked: true });
      return c.json({ status });
    }),
  );

  // A usb/bluetooth printer is claimed only by a box whose `visible` report lists its `local_key`;
  // a network_tcp printer by any box. A box that says it cannot print
  // over Bluetooth has its paired Bluetooth printers' due jobs ended failed instead, unless another
  // box reported it can print to that printer within `DISCOVERED_TTL_MS`. The jobs are ended anyway
  // when that report is older than the window or, being held in memory, lost to a server restart.
  app.post("/print-api/agent/jobs", (c) =>
    run(c, log, async () => {
      if (deps.stopping?.aborted) return c.body(null, 503);
      const { agentId } = await requireAgent({ db: deps.db }, c);
      const rawWait = c.req.query("wait");
      const wait = rawWait === undefined ? 0 : Number(rawWait);
      if (
        rawWait !== undefined &&
        (!/^\d+$/.test(rawWait) || !Number.isInteger(wait) || wait < 1 || wait > 25)
      )
        throw new AppError("management.request_invalid", { field: "wait" });
      const body = await readJsonBody<{
        visible?: unknown;
        scanned?: unknown;
        host?: unknown;
        setupUrl?: unknown;
        setupPort?: unknown;
        pairedBluetooth?: unknown;
        bluetoothOutcomes?: unknown;
        bluetooth?: unknown;
      }>(c);
      const reportedHost = optionalString(body.host, "host");
      const host = reportedHost === undefined ? undefined : reportedHost.trim() || null;
      const setupUrl = optionalAgentSetupUrl(body.setupUrl);
      const setupPort = optionalAgentSetupPort(body.setupPort);
      const visible = screenVisible(body.visible);
      const scanned = screenScanned(body.scanned);
      const pairedBluetooth = screenPairedBluetooth(body.pairedBluetooth);
      const bluetoothOutcomes = screenBluetoothOutcomes(body.bluetoothOutcomes);
      const unpaired = bluetoothCommands.unpaired(
        agentId,
        bluetoothOutcomes,
        pairedBluetooth.map((entry) => entry.localKey),
      );

      const now = steadyNow();
      const lastSeenAt = Date.now();
      // A successful unpair clears the earlier pairing report. A report in this pull is newer.
      for (const address of unpaired) {
        const key = keyOf(agentId, "bluetooth", address);
        const prior = discovered.get(key);
        if (prior !== undefined)
          discovered.set(key, { ...prior, pairedAt: undefined, pairedPrinterLike: undefined });
      }
      // A visible or scanned report replaces the description, never another kind of report's stamp;
      // a visible report carries no printer mark, so it keeps the one already held.
      const descriptionsBefore = new Map<string, ReturnType<typeof description>>();
      const rememberDescription = (key: string): void => {
        if (!descriptionsBefore.has(key))
          descriptionsBefore.set(key, description(discovered.get(key), now));
      };
      const describedThisPull = new Set<string>();
      const remember = (d: DiscoveredDeviceWire, stamp: "scannedAt" | "visibleAt"): void => {
        const locator = d.ippOnly ? queueKeyOf(d) : undefined;
        const key = keyOf(agentId, d.transport, locator ?? d.localKey ?? `${d.host}:${d.port}`);
        const prior = discovered.get(key);
        rememberDescription(key);
        discovered.set(key, {
          agentId,
          ...d,
          ...(stamp === "visibleAt" && prior?.printerLike ? { printerLike: true } : {}),
          ...(describedThisPull.has(key) && prior?.office?.printable && !d.office?.printable
            ? { office: prior.office, pagePrinter: prior.pagePrinter }
            : {}),
          lastSeenAt,
          reportedAt: now,
          scannedAt: prior?.scannedAt,
          pairedAt: prior?.pairedAt,
          pairedPrinterLike: prior?.pairedPrinterLike,
          visibleAt: prior?.visibleAt,
          [stamp]: now,
        });
        describedThisPull.add(key);
      };
      for (const v of visible) remember(v, "visibleAt");
      for (const s of scanned) remember(s, "scannedAt");
      // Only a complete snapshot can say a previously paired address is absent.
      if (
        Array.isArray(body.pairedBluetooth) &&
        pairedBluetooth.length === body.pairedBluetooth.length
      ) {
        const paired = new Set(pairedBluetooth.map((entry) => entry.localKey));
        for (const [key, entry] of discovered) {
          if (
            entry.agentId === agentId &&
            entry.transport === "bluetooth" &&
            !paired.has(entry.localKey!)
          ) {
            rememberDescription(key);
            discovered.set(key, { ...entry, pairedAt: undefined, pairedPrinterLike: undefined });
          }
        }
      }
      for (const { printerLike: pairedPrinterLike, ...p } of pairedBluetooth) {
        const key = keyOf(agentId, "bluetooth", p.localKey);
        const prior = discovered.get(key);
        rememberDescription(key);
        const stamps = { lastSeenAt, reportedAt: now, pairedAt: now, pairedPrinterLike };
        discovered.set(
          key,
          prior === undefined
            ? { agentId, transport: "bluetooth", ...p, ...stamps }
            : { ...prior, name: prior.name ?? p.name, ...stamps },
        );
      }
      if (
        deps.bus &&
        [...descriptionsBefore].some(
          ([key, before]) => !isDeepStrictEqual(before, description(discovered.get(key), now)),
        )
      )
        publishState(deps.bus, "printer_discovery", log);

      const bluetooth = screenBluetooth(body.bluetooth);
      if (bluetooth !== undefined) {
        const prior = agentBluetooth.get(agentId);
        rememberAgentBluetooth(agentId, bluetooth, now);
        if (
          deps.bus &&
          (prior?.value !== bluetooth || !withinTtl(prior.at, now, AGENT_BLUETOOTH_TTL_MS))
        )
          publishState(deps.bus, "print_agents", log);
      }

      const visibleKeys = visible
        .filter((v) => v.transport === "usb" || v.transport === "bluetooth")
        .map((v) => v.localKey);

      // The claim commits within this request: no transaction is held across the agent's socket write,
      // and the agent reports the outcome in a separate request.
      let claimed = await withTransaction(deps.db, async (tx) => {
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
        return claimInvoicePrintJobs(
          tx,
          agentId,
          {
            visibleKeys,
          },
          deps.now?.(),
        );
      });
      bluetoothCommands.accept(agentId, bluetoothOutcomes);
      claimed = await waitForJobs(agentId, visibleKeys, claimed, wait, c.req.raw.signal);
      // `servers` lets the agent follow the primary across a failover, as the till's pull does.
      const held = await deps.readMembership();
      const networkProbes = printerProbes.current();
      const commands = bluetoothCommands.current(agentId);
      const discoveryLeft = discoveryLeftMs();
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
          ...(job.invoiceClaim === undefined ? {} : { invoiceClaim: job.invoiceClaim }),
        })),
        discoveryExpiresInMs: discoveryLeft > 0 ? discoveryLeft : null,
        ...(networkProbes.length ? { networkProbes } : {}),
        ...(commands.length ? { bluetoothCommands: commands } : {}),
      });
    }),
  );

  app.post("/print-api/agent/jobs/:id/result", (c) =>
    run(c, log, async () => {
      const { agentId } = await requireAgent({ db: deps.db }, c);
      const jobId = requireUuidParam(c.req.param("id"), "PrintJobId");
      const body = await readJsonBody<{
        status?: unknown;
        error?: unknown;
        invoiceClaim?: unknown;
      }>(c);
      const status = requireEnum(body.status, "status", ["done", "failed"] as const);
      const outcome =
        status === "done"
          ? ({ status: "done" } as const)
          : ({ status: "failed", error: requireString(body.error ?? "", "error") } as const);
      const invoiceClaim = readInvoicePrintClaim(body.invoiceClaim);
      await withTransaction(deps.db, async (tx) => {
        await reportInvoicePrintJob(tx, { agentId, jobId, outcome, invoiceClaim }, deps.now?.());
      });
      return c.body(null, 204);
    }),
  );
}

import { publishState } from "./live-publish.js";
// Load server-owned error codes; imported printing verbs load the printing registry.
import "./errors.js";
import { createPrinterProbes } from "./printer-probes.js";
import { createPageTestPages } from "./page-test-pages.js";
import { createPrinterBluetoothCommands } from "./printer-bluetooth-commands.js";
import type { Hono } from "hono";
import { and, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { AppError, steadyNow } from "@waitron/shared";
import {
  receiptRollColumns,
  invoiceDeliveries,
  printAgents,
  printJobs,
  isReceiptPrinter,
  printers,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { MAX_DELIVERY_ATTEMPTS, PRINT_RETRY_MAX_WAIT_MS, textGrid } from "@waitron/printing";
import { authorizeManager, withPassiveManagementRead, type Permission } from "@waitron/identity";
import { requireManagementSession } from "@waitron/server-kit";
import { claimInvoicePrintJobs } from "./invoice-print.js";
import { createEnrolRateLimiter } from "./enrol-rate-limit.js";
import type { Logger } from "./logger.js";
import { previewPrintJob } from "./print-job-preview.js";
import { DEMO_PRINTER_KEY } from "./demo-printer.js";
import { DISCOVERED_TTL_MS, isListed as listedAt, withinTtl } from "./discovery-listing.js";
import { mountPagePrintersApi, type PagePrinterQueue } from "./page-printers-api.js";
import type { PagePrinterDiscovery } from "./page-printers.js";
import { mountPagePrintApi } from "./page-print-api.js";
import type { PrintApiDeps } from "./print-api-deps.js";
import { run } from "./print-api-errors.js";
import type { DiscoveredEntry } from "./print-discovery-types.js";
import type { AgentBluetooth, DiscoveredDeviceWire } from "./print-agent-reports.js";
import { mountPrintAgentRoutes } from "./print-agent-routes.js";
import { mountPrintAgentManagementRoutes } from "./print-agent-management-routes.js";
import { mountPrintDiscoveryRoutes } from "./print-discovery-routes.js";
import { mountPrintPrintersRoutes } from "./print-printers-routes.js";
import { RECENT_JOBS_LIMIT, mountPrintJobsRoutes } from "./print-jobs-routes.js";
import { mountPrintAssignmentRoutes } from "./print-assignments-routes.js";

const PRINTER_MANAGE_PERMISSION: Permission = "hardware.manage";

export function mountPrintApi(app: Hono, deps: PrintApiDeps, log: Logger): void {
  // Built once, so it is one bucket for the whole mounted API.
  const enrolLimiter = deps.enrolRateLimiter ?? createEnrolRateLimiter();

  // The discovered inventory and the discovery window live in memory only; agent polls rebuild them
  // after a restart.
  const description = (entry: DiscoveredEntry | undefined, now: number) =>
    entry === undefined
      ? undefined
      : {
          ...Object.fromEntries(
            Object.entries(entry).filter(
              ([key]) =>
                !["lastSeenAt", "reportedAt", "scannedAt", "pairedAt", "visibleAt"].includes(key),
            ),
          ),
          paired: entry.transport === "bluetooth" && isListed(entry.pairedAt, now),
        };
  const discovered = new Map<string, DiscoveredEntry>();
  const agentBluetooth = new Map<
    string,
    { value: AgentBluetooth; at: number; expiry: ReturnType<typeof setTimeout> }
  >();
  // Longer than the scan list's: an agent printing a batch does not pull again until it has finished.
  const AGENT_BLUETOOTH_TTL_MS = 60_000;
  const forgetAgentBluetooth = (agentId: string): void => {
    clearTimeout(agentBluetooth.get(agentId)?.expiry);
    agentBluetooth.delete(agentId);
  };
  // An open dashboard learns of a report going stale only from this event.
  const rememberAgentBluetooth = (agentId: string, value: AgentBluetooth, at: number): void => {
    forgetAgentBluetooth(agentId);
    const expiry = setTimeout(() => {
      agentBluetooth.delete(agentId);
      if (deps.bus) publishState(deps.bus, "print_agents", log);
    }, AGENT_BLUETOOTH_TTL_MS + 1);
    expiry.unref();
    agentBluetooth.set(agentId, { value, at, expiry });
  };
  const printerProbes = createPrinterProbes();
  const testPages = deps.testPages ?? createPageTestPages();
  const bluetoothCommands = createPrinterBluetoothCommands();
  const pullWakes = new Set<(agentId?: string) => void>();
  const wakePulls = (agentId?: string): void => {
    for (const wake of pullWakes) wake(agentId);
  };
  let discoveryEnd = -Infinity; // on the steady clock
  const DISCOVERY_WINDOW_MS = 3 * 60_000;
  const isFresh = (at: number | undefined, now: number): boolean =>
    withinTtl(at, now, DISCOVERED_TTL_MS);
  const listedBluetooth = (agentId: string, now: number): AgentBluetooth | null => {
    const report = agentBluetooth.get(agentId);
    return report !== undefined && withinTtl(report.at, now, AGENT_BLUETOOTH_TTL_MS)
      ? report.value
      : null;
  };
  const visibleNow = (now = steadyNow()): Set<string> =>
    new Set(
      [...discovered.values()]
        .filter((entry) => isFresh(entry.visibleAt, now))
        .map((entry) => `${entry.transport}:${entry.localKey}`),
    );
  /** Whether an agent can reach `printer` now: a USB or Bluetooth one only while one reports it. */
  const seen = (
    printer: { transport: string; localKey: string | null },
    visible = visibleNow(),
  ): boolean =>
    (printer.transport !== "usb" && printer.transport !== "bluetooth") ||
    printer.localKey === DEMO_PRINTER_KEY ||
    visible.has(`${printer.transport}:${printer.localKey}`);
  /** 0 when closed. Capped because floating-point subtraction can overshoot the window's length. */
  const discoveryLeftMs = (): number =>
    Math.max(0, Math.min(DISCOVERY_WINDOW_MS, Math.ceil(discoveryEnd - steadyNow())));
  /** The discovered list's own freshness, which also bounds the Pair and Forget it offers. */
  const isListed = (at: number | undefined, now: number): boolean =>
    listedAt(at, now, discoveryEnd);
  const keyOf = (agentId: string, transport: string, locator: string): string =>
    `${agentId}:${transport}:${locator}`;
  const queueKeyOf = (device: DiscoveredDeviceWire): string | undefined => {
    const queue = device.ipp ?? device.office;
    return device.host === undefined || queue === undefined
      ? undefined
      : JSON.stringify([device.host.toLowerCase(), queue.port, queue.resourcePath]);
  };
  const reportedFresh = (
    agentId: string,
    address: string,
    stamp: "scannedAt" | "pairedAt",
  ): boolean =>
    isListed(discovered.get(keyOf(agentId, "bluetooth", address))?.[stamp], steadyNow());
  // Host names and IPv6 literals compare without regard to case.
  const addressOf = (host: string, port: number | undefined): string =>
    `${host.toLowerCase()}:${port ?? 9100}`;
  /**
   * The addresses any listed entry marks as an office printer: its own address when it is marked,
   * reports IPP only, or carries an office report, and the IPP queue that report names. Each agent
   * asks on its own and a failed query leaves a raw device unmarked, so one agent's mark covers
   * every agent's entry for the address.
   */
  const officeAddresses = (now: number): Set<string> => {
    const marked = new Set<string>();
    for (const e of discovered.values()) {
      if (e.host === undefined || !isListed(e.reportedAt, now)) continue;
      if (e.pagePrinter || e.ippOnly || e.office !== undefined)
        marked.add(addressOf(e.host, e.port));
      if (e.office !== undefined) marked.add(addressOf(e.host, e.office.port));
    }
    return marked;
  };
  const waitForJobs = async (
    agentId: string,
    visibleKeys: string[],
    initial: Awaited<ReturnType<typeof claimInvoicePrintJobs>>,
    wait: number,
    signal: AbortSignal,
  ): Promise<typeof initial> => {
    if (wait === 0 || !deps.bus || initial.length > 0) return initial;
    let notify = (): void => {};
    let changed = false;
    let reply = false;
    let ended = signal.aborted || deps.stopping?.aborted === true;
    const wake = (): void => {
      changed = true;
      notify();
    };
    const end = (): void => {
      ended = true;
      wake();
    };
    const wakeAgent = (id?: string): void => {
      if (id === undefined || id === agentId) {
        reply = true;
        wake();
      }
    };
    const unsubscribe = deps.bus.subscribe((event) => {
      if (event.kind === "close") {
        end();
        return;
      }
      const resources = event.change.resources;
      const printJob = resources.some(({ type }) => type === "print_jobs");
      // A job adds its printer to the event so the dashboard updates the queue. Only a separate
      // printer change needs an empty reply so the agent checks for office pages.
      const pageChange = resources.some(
        ({ type }) => type === "invoice_deliveries" || (type === "printers" && !printJob),
      );
      if (pageChange) reply = true;
      if (printJob || pageChange) wake();
    });
    pullWakes.add(wakeAgent);
    signal.addEventListener("abort", end, { once: true });
    deps.stopping?.addEventListener("abort", end, { once: true });
    let lastClaimAt: number;
    const claim = () => {
      lastClaimAt = Date.now();
      return withTransaction(deps.db, (tx) =>
        ended
          ? Promise.resolve([])
          : claimInvoicePrintJobs(tx, agentId, { visibleKeys }, deps.now?.()),
      );
    };
    try {
      // Subscribe before rechecking so work arriving after the first claim cannot be missed.
      let claimed = await claim();
      // Leave a normal retry interval before the inventory's freshness expires.
      const deadline = performance.now() + Math.min(wait * 1_000, DISCOVERED_TTL_MS - 2_000);
      while (claimed.length === 0 && !ended && !reply) {
        if (changed) {
          changed = false;
          claimed = await claim();
          continue;
        }
        let remaining = deadline - performance.now();
        if (remaining <= 0) break;
        // A retry can become due between the last claim and this read.
        const lastClaim = new Date(lastClaimAt!).toISOString();
        const retryAhead = new Date(lastClaimAt! + PRINT_RETRY_MAX_WAIT_MS).toISOString();
        const pending = await deps.db
          .select({
            status: printJobs.status,
            kind: printJobs.kind,
            createdAt: printJobs.createdAt,
            claimedAt: printJobs.claimedAt,
            nextAttemptAt: printJobs.nextAttemptAt,
            printerId: printJobs.printerId,
          })
          .from(printJobs)
          .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
          .where(
            and(
              isNull(printers.deletedAt),
              or(
                inArray(printJobs.status, ["printing", "queued"]),
                and(
                  eq(printJobs.status, "failed"),
                  eq(printJobs.kind, "document"),
                  lt(printJobs.attempts, MAX_DELIVERY_ATTEMPTS),
                  gt(printJobs.nextAttemptAt, lastClaim),
                  lte(printJobs.nextAttemptAt, retryAhead),
                  eq(printers.active, true),
                  or(
                    eq(printers.transport, "network_tcp"),
                    visibleKeys.length === 0
                      ? undefined
                      : and(
                          inArray(printers.transport, ["usb", "bluetooth"]),
                          inArray(printers.localKey, visibleKeys),
                        ),
                  ),
                ),
              ),
            ),
          );
        const retryingPrinters = new Set(
          pending.filter((job) => job.status === "failed").map((job) => job.printerId),
        );
        for (const job of pending) {
          if (job.status === "failed") {
            remaining = Math.min(remaining, Date.parse(job.nextAttemptAt!) - Date.now());
            continue;
          }
          if (job.status === "queued" && job.kind === "document") {
            // This printer's retry wakes the hold while later documents wait behind it.
            if (!retryingPrinters.has(job.printerId)) remaining = Math.min(remaining, 2_000);
            continue;
          }
          const at =
            job.status === "queued"
              ? Date.parse(job.createdAt) + 30_000
              : Date.parse(job.claimedAt ?? "") + 60_000;
          remaining = Math.min(
            remaining,
            Number.isFinite(at) && at > Date.now() ? at - Date.now() : 2_000,
          );
        }
        const [delivery] = await deps.db
          .select({ id: invoiceDeliveries.id })
          .from(invoiceDeliveries)
          .where(
            and(
              eq(invoiceDeliveries.medium, "a4"),
              inArray(invoiceDeliveries.status, ["queued", "sending"]),
            ),
          )
          .limit(1);
        // Pending pages and discovery retain their two-second maintenance cadence on this same hold.
        if (
          delivery ||
          testPages.anyWaiting() ||
          testPages.printingOn().length > 0 ||
          bluetoothCommands.current(agentId).length > 0 ||
          printerProbes.current().length > 0 ||
          discoveryLeftMs() > 0
        )
          remaining = Math.min(remaining, 2_000);
        if (changed || ended || reply) continue;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, Math.max(1, remaining));
          notify = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        const timedOut = !changed;
        changed = false;
        if (!ended) claimed = await claim();
        if (timedOut) break;
      }
      return claimed;
    } finally {
      unsubscribe();
      pullWakes.delete(wakeAgent);
      signal.removeEventListener("abort", end);
      deps.stopping?.removeEventListener("abort", end);
    }
  };
  const requireAgentRow = async (tx: Transaction, id: string): Promise<void> => {
    const [row] = await tx
      .select({ id: printAgents.id })
      .from(printAgents)
      .where(eq(printAgents.id, id));
    if (row === undefined) throw new AppError("agent.not_found", { id });
  };

  const gated = <T>(
    sessionId: string,
    fn: (tx: Transaction, personId: string) => Promise<T>,
    permission: Permission = PRINTER_MANAGE_PERMISSION,
  ): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission,
      });
      return fn(tx, authorizedBy);
    });

  mountPrintAgentRoutes(
    app,
    deps,
    enrolLimiter,
    discovered,
    keyOf,
    description,
    queueKeyOf,
    agentBluetooth,
    rememberAgentBluetooth,
    AGENT_BLUETOOTH_TTL_MS,
    waitForJobs,
    printerProbes,
    bluetoothCommands,
    discoveryLeftMs,
    log,
  );

  mountPrintAgentManagementRoutes(
    app,
    deps,
    gated,
    listedBluetooth,
    forgetAgentBluetooth,
    requireAgentRow,
    reportedFresh,
    bluetoothCommands,
    wakePulls,
    log,
  );

  app.post("/management-api/printer-discovery/start", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, async () => {});
      discoveryEnd = steadyNow() + DISCOVERY_WINDOW_MS;
      wakePulls();
      return c.json({ discoveryUntil: Date.now() + DISCOVERY_WINDOW_MS });
    }),
  );

  // Called on a timer while Add a printer is open, so it must not keep an unattended dashboard
  // signed in; the window's own expiry stops scanning once the dialog stops renewing it.
  app.post("/management-api/printer-discovery/renew", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await withPassiveManagementRead(() => gated(sessionId, async () => {}));
      discoveryEnd = steadyNow() + DISCOVERY_WINDOW_MS;
      wakePulls();
      return c.json({ discoveryUntil: Date.now() + DISCOVERY_WINDOW_MS });
    }),
  );

  mountPrintDiscoveryRoutes(
    app,
    gated,
    discovered,
    isListed,
    addressOf,
    queueKeyOf,
    printerProbes,
    bluetoothCommands,
    wakePulls,
    log,
  );

  // Of this agent's entries naming the queue, the latest report wins; within one pull a printable
  // report stands over an unprintable one (the raw and IPP entries of one device both carry it).
  const findPagePrinterDiscovery = (queue: PagePrinterQueue): PagePrinterDiscovery | undefined => {
    let found: PagePrinterDiscovery | undefined;
    for (const e of discovered.values()) {
      if (e.agentId !== queue.agentId || e.host === undefined || e.office === undefined) continue;
      if (e.host.toLowerCase() !== queue.host.toLowerCase()) continue;
      if (e.office.port !== queue.port || e.office.resourcePath !== queue.resourcePath) continue;
      if (
        found === undefined ||
        e.reportedAt > found.reportedAt ||
        (e.reportedAt === found.reportedAt && e.office.printable)
      ) {
        found = { agentId: e.agentId, host: e.host, office: e.office, reportedAt: e.reportedAt };
      }
    }
    return found;
  };
  mountPagePrintersApi(
    app,
    {
      db: deps.db,
      findDiscovery: findPagePrinterDiscovery,
      discoveryWindow: () => ({ now: steadyNow(), discoveryEnd }),
      testPages,
      wakeAgent: wakePulls,
      ...(deps.now === undefined ? {} : { now: deps.now }),
    },
    log,
  );
  mountPagePrintApi(
    app,
    {
      db: deps.db,
      readInvoiceDocument: deps.readInvoiceDocument,
      testPages,
      ...(deps.receiptQrText === undefined ? {} : { receiptQrText: deps.receiptQrText }),
      ...(deps.renderInvoicePage === undefined ? {} : { render: deps.renderInvoicePage }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
    },
    log,
  );

  mountPrintPrintersRoutes(
    app,
    deps,
    gated,
    officeAddresses,
    addressOf,
    reportedFresh,
    bluetoothCommands,
    wakePulls,
    log,
  );

  if (deps.cfg.practiceMode === true) {
    app.get("/management-api/demo-printer/jobs", (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const rows = await withPassiveManagementRead(() =>
          gated(sessionId, (tx) =>
            tx
              .select({
                id: printJobs.id,
                kind: printJobs.kind,
                createdAt: printJobs.createdAt,
                payload: printJobs.payload,
                ...receiptRollColumns,
              })
              .from(printJobs)
              .innerJoin(printers, and(isReceiptPrinter(), eq(printJobs.printerId, printers.id)))
              .where(
                and(
                  eq(printers.localKey, DEMO_PRINTER_KEY),
                  eq(printJobs.status, "done"),
                  sql`length(${printJobs.payload}) > 0`,
                ),
              )
              .orderBy(desc(printJobs.createdAt), sql`print_jobs.rowid desc`)
              .limit(RECENT_JOBS_LIMIT),
          ),
        );
        return c.json(
          rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            createdAt: row.createdAt,
            preview:
              row.kind === "drawer"
                ? null
                : previewPrintJob(row.payload!, {
                    widthDots: textGrid(row.paperWidth, row.resolution).widthDots,
                  }),
          })),
        );
      }),
    );
  }

  mountPrintJobsRoutes(app, deps, gated, visibleNow, seen, testPages, log);

  mountPrintAssignmentRoutes(app, gated, log);
}

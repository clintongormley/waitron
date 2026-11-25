import { printers, isReceiptPrinter, printAgents } from "@waitron/db";
import type { OfficePrinterReport } from "@waitron/print-agent";
import { type Logger, requireManagementSession, readJsonBody } from "@waitron/server-kit";
import { steadyNow } from "@waitron/shared";
import { desc, sql } from "drizzle-orm";
import type { Hono } from "hono";
import type { DiscoveredDeviceWire } from "./print-agent-reports.js";
import type { PrintPermissionGate } from "./print-api-deps.js";
import { run } from "./print-api-errors.js";
import type { DiscoveredEntry } from "./print-discovery-types.js";
import type { createPrinterBluetoothCommands } from "./printer-bluetooth-commands.js";
import type { createPrinterProbes } from "./printer-probes.js";

export function mountPrintDiscoveryRoutes(
  app: Hono,
  gated: PrintPermissionGate,
  discovered: Map<string, DiscoveredEntry>,
  isListed: (at: number | undefined, now: number) => boolean,
  addressOf: (host: string, port: number | undefined) => string,
  queueKeyOf: (device: DiscoveredDeviceWire) => string | undefined,
  printerProbes: ReturnType<typeof createPrinterProbes>,
  bluetoothCommands: ReturnType<typeof createPrinterBluetoothCommands>,
  wakePulls: (agentId?: string) => void,
  log: Logger,
): void {
  app.post("/management-api/printer-discovery/probe", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await gated(sessionId, async () => {});
      const body = await readJsonBody<Record<string, unknown>>(c);
      const probe = printerProbes.add(body);
      wakePulls();
      return c.json(probe);
    }),
  );

  app.get("/management-api/discovered-printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const now = steadyNow();
      for (const [k, e] of discovered) if (!isListed(e.reportedAt, now)) discovered.delete(k);
      const { registered, agents } = await gated(sessionId, async (tx) => ({
        registered: await tx
          .select({
            id: printers.id,
            localKey: printers.localKey,
            host: printers.host,
            port: printers.port,
            transport: printers.transport,
            name: printers.name,
            active: printers.active,
            deletedAt: printers.deletedAt,
          })
          .from(printers)
          .where(isReceiptPrinter())
          .orderBy(
            desc(sql`${printers.deletedAt} is null`),
            desc(printers.deletedAt),
            desc(printers.active),
          ),
        agents: await tx.select({ id: printAgents.id, name: printAgents.name }).from(printAgents),
      }));
      const names = new Map(agents.map((a) => [a.id, a.name]));
      type Registered = (typeof registered)[number];
      const byKey = new Map<string, Registered>();
      const byHostPort = new Map<string, Registered>();
      for (const row of registered) {
        if (row.localKey !== null) {
          const key = `${row.transport}:${row.localKey}`;
          if (!byKey.has(key)) byKey.set(key, row);
        }
        if (row.transport === "network_tcp" && row.host !== null) {
          const key = `${row.host}:${row.port ?? 9100}`;
          if (!byHostPort.has(key)) byHostPort.set(key, row);
        }
      }
      const matchOf = (entry: DiscoveredEntry): Registered | undefined =>
        entry.ippOnly
          ? undefined
          : entry.localKey !== undefined
            ? byKey.get(`${entry.transport}:${entry.localKey}`)
            : byHostPort.get(`${entry.host}:${entry.port ?? 9100}`);
      const pagePrinterAddresses = new Set<string>();
      const pagePrinterQueues = new Set<string>();
      const reportsByQueue = new Map<string, { agentId: string; office: OfficePrinterReport }[]>();
      for (const e of discovered.values()) {
        if (e.host === undefined) continue;
        const address = addressOf(e.host, e.port);
        if (e.pagePrinter) pagePrinterAddresses.add(address);
        const queue = queueKeyOf(e);
        if (e.pagePrinter && queue !== undefined) pagePrinterQueues.add(queue);
        if (queue !== undefined && e.office?.printable) {
          const reports = reportsByQueue.get(queue) ?? [];
          reports.push({ agentId: e.agentId, office: e.office });
          reportsByQueue.set(queue, reports);
        }
      }
      const officeOf = (e: DiscoveredEntry): OfficePrinterReport | undefined => {
        if (e.office?.printable || e.host === undefined) return e.office;
        const queue = queueKeyOf(e);
        return (
          (queue === undefined
            ? undefined
            : reportsByQueue.get(queue)?.find((r) => r.agentId !== e.agentId)?.office) ?? e.office
        );
      };
      return c.json(
        [...discovered.values()].map((e) => {
          const match = matchOf(e);
          const printerId = match?.deletedAt === null ? match.id : null;
          const address = e.transport === "bluetooth" ? e.localKey : undefined;
          const office = officeOf(e);
          const queue = queueKeyOf(e);
          const pagePrinter = e.ippOnly
            ? queue !== undefined && pagePrinterQueues.has(queue)
            : e.host !== undefined && pagePrinterAddresses.has(addressOf(e.host, e.port));
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
            serverName: e.serverName,
            pagePrinter: pagePrinter ? (true as const) : undefined,
            ipp: e.ipp,
            ippOnly: e.ippOnly,
            office,
            // The page-printer POST reads only the named agent's own report (findPagePrinterDiscovery).
            officeLent: office !== e.office ? (true as const) : undefined,
            printerLike:
              address === undefined
                ? undefined
                : (e.printerLike ?? (isListed(e.pairedAt, now) ? e.pairedPrinterLike : undefined)),
            paired:
              address !== undefined && isListed(e.pairedAt, now) ? (true as const) : undefined,
            bluetoothCommand:
              address === undefined ? undefined : bluetoothCommands.latest(e.agentId, address),
            retainedName: match && match.deletedAt !== null ? match.name : undefined,
            alreadyRegistered: printerId !== null,
            printerId,
            lastSeenAt: new Date(e.lastSeenAt).toISOString(),
          };
        }),
      );
    }),
  );
}

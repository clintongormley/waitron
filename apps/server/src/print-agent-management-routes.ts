import { type Transaction, printAgents } from "@waitron/db";
import { isBluetoothAddress, isBluetoothPin } from "@waitron/print-agent";
import {
  type Logger,
  requireManagementSession,
  requireUuidParam,
  readJsonBody,
  requireString,
} from "@waitron/server-kit";
import { AppError, steadyNow } from "@waitron/shared";
import { desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { AgentBluetooth } from "./print-agent-reports.js";
import type { PrintApiDeps, PrintPermissionGate } from "./print-api-deps.js";
import { run } from "./print-api-errors.js";
import type { createPrinterBluetoothCommands } from "./printer-bluetooth-commands.js";

function requireBluetoothAddress(value: unknown): string {
  if (typeof value !== "string" || !isBluetoothAddress(value)) {
    throw new AppError("management.request_invalid", { field: "address" });
  }
  return value.toUpperCase();
}

export function mountPrintAgentManagementRoutes(
  app: Hono,
  deps: PrintApiDeps,
  gated: PrintPermissionGate,
  listedBluetooth: (agentId: string, now: number) => AgentBluetooth | null,
  forgetAgentBluetooth: (agentId: string) => void,
  requireAgentRow: (tx: Transaction, id: string) => Promise<void>,
  reportedFresh: (agentId: string, address: string, stamp: "scannedAt" | "pairedAt") => boolean,
  bluetoothCommands: ReturnType<typeof createPrinterBluetoothCommands>,
  wakePulls: (agentId?: string) => void,
  log: Logger,
): void {
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
      const now = steadyNow();
      return c.json(
        rows.map(({ setupPort, ...row }) => {
          const onThisBox = row.nodeId !== null && row.nodeId === deps.cfg.nodeId;
          return {
            ...row,
            onThisBox,
            bluetooth: listedBluetooth(row.id, now),
            setupUrl:
              row.setupUrl ??
              (onThisBox && setupPort !== null && address !== undefined
                ? new URL(`http://${address}:${setupPort}`).origin
                : null),
          };
        }),
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
      forgetAgentBluetooth(id);
      return c.body(null, 204);
    }),
  );

  // Self-enrol does not reactivate a revoked row, so without this a mistaken revoke of a box's own
  // agent, the spare's included, would stop its printing for good.
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

  // The same discovery window governs the scan for Pair and the pairing report for Delete.
  app.post("/management-api/print-agents/:id/bluetooth/pair", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const agentId = requireUuidParam(c.req.param("id"), "PrintAgentId");
      const body = await readJsonBody<{ address?: unknown; pin?: unknown }>(c);
      const address = requireBluetoothAddress(body.address);
      if (typeof body.pin !== "string" || !isBluetoothPin(body.pin)) {
        throw new AppError("management.request_invalid", { field: "pin" });
      }
      const pin = body.pin;
      const command = await gated(sessionId, async (tx) => {
        await requireAgentRow(tx, agentId);
        if (!reportedFresh(agentId, address, "scannedAt")) {
          throw new AppError("printer.bluetooth_not_discovered", { address });
        }
        return bluetoothCommands.enqueue(agentId, "pair", address, pin);
      });
      wakePulls(agentId);
      return c.json({ command }, 202);
    }),
  );
}

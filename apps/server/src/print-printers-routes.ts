import "./errors.js";
import {
  receiptPrintTransport,
  printPaperWidth,
  printResolution,
  printers,
  isReceiptPrinter,
  printAgents,
  drawerOpens,
  receiptRollColumns,
} from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import {
  isSharedDisplay,
  listDeviceProfiles,
  readProfilePrinterLists,
  setPrinterPortable,
  setProfilePrinterLists,
} from "@waitron/layouts";
import { readReceiptLanguage } from "@waitron/menu";
import { cardReaders } from "@waitron/payments";
import { isBluetoothAddress } from "@waitron/print-agent";
import {
  type CreatePrinterInput,
  createPrinter,
  listPrinters,
  type UpdatePrinterInput,
  updatePrinter,
  enqueuePrintJob,
  esc,
} from "@waitron/printing";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  requireString,
  requireEnum,
  requireUuidParam,
  requireBodyUuid,
} from "@waitron/server-kit";
import { AppError, steadyNow } from "@waitron/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Hono } from "hono";
import { readPrinterHolders } from "./device-equipment.js";
import { readPrinterJobSummaries } from "./printer-job-summaries.js";
import { formatEquipmentLabel } from "./equipment-label.js";
import type { PrintApiDeps, PrintPermissionGate } from "./print-api-deps.js";
import { run, runEquipmentLabel } from "./print-api-errors.js";
import {
  optionalString,
  nullableOptionalInt,
  optionalBool,
  nullableOptionalString,
} from "./print-request-fields.js";
import type {
  createPrinterBluetoothCommands,
  BluetoothCommandStatus,
} from "./printer-bluetooth-commands.js";
import { readPrinterDeleteImpact, deletePrinter } from "./printer-delete.js";
import { layOutPrinterTestPage } from "./printer-test-page.js";
import { formatSampleReceipt } from "./sample-receipt.js";
import { resolveSessionLocale } from "./session-locale.js";
import { formatTestPage } from "./test-page.js";

/**
 * The claim matches `local_key` against the upper-cased keys `screenVisible` keeps, case-sensitively,
 * so a registered Bluetooth address is stored upper-cased by the same rule.
 */
function storedLocalKey(transport: string, localKey: string): string {
  return transport === "bluetooth" && isBluetoothAddress(localKey)
    ? localKey.toUpperCase()
    : localKey;
}
function requirePickupRoles(value: unknown): ("receipt" | "payment_slip")[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (role) => typeof role !== "string" || (role !== "receipt" && role !== "payment_slip"),
    )
  ) {
    throw new AppError("management.request_invalid", { field: "pickupRoles" });
  }
  return [...new Set(value)] as ("receipt" | "payment_slip")[];
}

export function mountPrintPrintersRoutes(
  app: Hono,
  deps: PrintApiDeps,
  gated: PrintPermissionGate,
  officeAddresses: (now: number) => Set<string>,
  addressOf: (host: string, port: number | undefined) => string,
  reportedFresh: (agentId: string, address: string, stamp: "scannedAt" | "pairedAt") => boolean,
  bluetoothCommands: ReturnType<typeof createPrinterBluetoothCommands>,
  wakePulls: (agentId?: string) => void,
  log: Logger,
): void {
  app.post("/management-api/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      // Only the shape is screened here; `createPrinter` owns the required-field check.
      const input: CreatePrinterInput = {
        name: requireString(body.name, "name"),
        transport: requireEnum(body.transport, "transport", receiptPrintTransport.enumValues),
      };
      const host = optionalString(body.host, "host");
      if (host !== undefined) input.host = host;
      const port = nullableOptionalInt(body.port, "port");
      if (port !== undefined && port !== null) input.port = port;
      const localKey = optionalString(body.localKey, "localKey");
      if (localKey !== undefined) input.localKey = storedLocalKey(input.transport, localKey);
      const pollId = optionalString(body.pollId, "pollId");
      if (pollId !== undefined) input.pollId = pollId;
      if (body.paperWidth !== undefined) {
        input.paperWidth = requireEnum(body.paperWidth, "paperWidth", printPaperWidth.enumValues);
      }
      if (body.resolution !== undefined) {
        input.resolution = requireEnum(body.resolution, "resolution", printResolution.enumValues);
      }
      const hasCashDrawer = optionalBool(body.hasCashDrawer, "hasCashDrawer");
      if (hasCashDrawer !== undefined) input.hasCashDrawer = hasCashDrawer;
      const portable = optionalBool(body.portable, "portable");
      if (portable !== undefined) input.portable = portable;
      if (body.pickupRoles !== undefined) input.pickupRoles = requirePickupRoles(body.pickupRoles);
      const created = await gated(sessionId, (tx) => {
        // Weaker than its name: it matches only the host text (ignoring case) and port an agent
        // reported recently; a different port, a name instead of an address, or an edit through
        // PATCH is accepted.
        if (
          input.transport === "network_tcp" &&
          input.host !== undefined &&
          officeAddresses(steadyNow()).has(addressOf(input.host, input.port))
        ) {
          throw new AppError("printer.office_printer", {});
        }
        if (input.transport === "bluetooth" && input.localKey !== undefined)
          bluetoothCommands.refuseWhileForgetting(input.localKey);
        return createPrinter(tx, input);
      });
      return c.json(created, 201);
    }),
  );

  app.put("/management-api/printers/:id/profiles", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const { profileIds } = await readJsonBody<{ profileIds?: unknown }>(c);
      if (!Array.isArray(profileIds))
        throw new AppError("management.request_invalid", { field: "profileIds" });
      const ids = [
        ...new Set(profileIds.map((profileId) => requireBodyUuid(profileId, "profileIds"))),
      ];
      await gated(sessionId, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "venue.configure",
        });
        // Both printer kinds are assigned here, each to its own lists.
        const [printer] = await tx
          .select({ kind: printers.kind })
          .from(printers)
          .where(
            and(
              eq(printers.id, id),
              inArray(printers.kind, ["receipt", "a4"]),
              eq(printers.active, true),
              isNull(printers.deletedAt),
            ),
          );
        if (!printer) throw new AppError("printer.not_found", { id });
        const profiles = await listDeviceProfiles(tx);
        const eligible = new Set(
          profiles
            .filter((profile) => !isSharedDisplay(profile.formFactor))
            .map((profile) => profile.id),
        );
        if (ids.some((profileId) => !eligible.has(profileId)))
          throw new AppError("management.request_invalid", { field: "profileIds" });
        const keys =
          printer.kind === "a4"
            ? (["invoicePrinterIds"] as const)
            : (["receiptPrinterIds", "paymentSlipPrinterIds"] as const);
        for (const profileId of ids) {
          const lists = await readProfilePrinterLists(tx, profileId);
          const missing = keys.filter((key) => !lists[key].includes(id));
          if (missing.length === 0) continue;
          for (const key of missing) lists[key].push(id);
          await setProfilePrinterLists(tx, profileId, lists);
        }
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, async (tx) => {
        const configured = await listPrinters(tx);
        const holders = await readPrinterHolders(tx);
        const byPrinter = await readPrinterJobSummaries(tx, "receipt");
        return configured.map((printer) => {
          const summary = byPrinter.get(printer.id);
          return {
            ...printer,
            holder: holders.get(printer.id) ?? null,
            pendingJobs: summary?.pendingJobs ?? 0,
            lastPrintAgentId: summary?.lastPrintAgentId ?? null,
            lastPrintAt: summary?.lastPrintAt ?? null,
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
        patch.transport = requireEnum(
          body.transport,
          "transport",
          receiptPrintTransport.enumValues,
        );
      }
      const host = nullableOptionalString(body.host, "host");
      if (host !== undefined) patch.host = host;
      const port = nullableOptionalInt(body.port, "port");
      if (port !== undefined) patch.port = port;
      const localKey = nullableOptionalString(body.localKey, "localKey");
      if (localKey !== undefined) patch.localKey = localKey;
      const pollId = nullableOptionalString(body.pollId, "pollId");
      if (pollId !== undefined) patch.pollId = pollId;
      if (body.paperWidth !== undefined) {
        patch.paperWidth = requireEnum(body.paperWidth, "paperWidth", printPaperWidth.enumValues);
      }
      if (body.resolution !== undefined) {
        patch.resolution = requireEnum(body.resolution, "resolution", printResolution.enumValues);
      }
      const hasCashDrawer = optionalBool(body.hasCashDrawer, "hasCashDrawer");
      if (hasCashDrawer !== undefined) patch.hasCashDrawer = hasCashDrawer;
      if (body.pickupRoles !== undefined) patch.pickupRoles = requirePickupRoles(body.pickupRoles);
      if (body.active !== undefined) {
        throw new AppError("management.request_invalid", { field: "active" });
      }
      const portable = optionalBool(body.portable, "portable");
      await gated(sessionId, async (tx) => {
        // Either field can make the stored key a Bluetooth address, so both need the other's value.
        if (patch.transport !== undefined || typeof patch.localKey === "string") {
          const [current] = await tx
            .select({ transport: printers.transport, localKey: printers.localKey })
            .from(printers)
            .where(and(isReceiptPrinter(), eq(printers.id, id)));
          const key = patch.localKey === undefined ? current?.localKey : patch.localKey;
          const transport = patch.transport ?? current?.transport;
          if (typeof key === "string" && transport !== undefined) {
            const stored = storedLocalKey(transport, key);
            if (stored !== key) patch.localKey = stored;
          }
        }
        await updatePrinter(tx, id, patch);
        if (portable !== undefined) await setPrinterPortable(tx, id, portable);
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/printers/:id/delete-impact", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      return c.json(await gated(sessionId, (tx) => readPrinterDeleteImpact(tx, id)));
    }),
  );

  app.delete("/management-api/printers/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const { impact, address, agents } = await gated(sessionId, async (tx) => {
        const [printer] = await tx
          .select({ localKey: printers.localKey })
          .from(printers)
          .where(and(isReceiptPrinter(), eq(printers.id, id), eq(printers.transport, "bluetooth")));
        const impact = await deletePrinter(tx, id, deps.now?.());
        const address = printer?.localKey ?? null;
        const agents =
          address === null
            ? []
            : await tx
                .select({
                  id: printAgents.id,
                  name: printAgents.name,
                  active: printAgents.active,
                })
                .from(printAgents);
        return { impact, address, agents };
      });
      if (address === null) return c.json(impact);

      const commands: { agentId: string; agentName: string; command: BluetoothCommandStatus }[] =
        [];
      const warnings: { agentName: string | null }[] = [];
      for (const { id: agentId, name: agentName, active } of agents) {
        if (!reportedFresh(agentId, address, "pairedAt")) continue;
        if (!active) {
          warnings.push({ agentName });
          continue;
        }
        try {
          const command = bluetoothCommands.enqueue(agentId, "forget", address);
          commands.push({ agentId, agentName, command });
          wakePulls(agentId);
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== "printer.bluetooth_command_busy")
            throw error;
          warnings.push({ agentName });
        }
      }
      if (commands.length === 0 && warnings.length === 0) warnings.push({ agentName: null });
      return c.json({ ...impact, bluetoothUnpair: { commands, warnings } });
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
        const queued = await enqueuePrintJob(tx, id, esc().kick().bytes(), "drawer");
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

  app.post("/management-api/printers/:id/equipment-label", (c) =>
    runEquipmentLabel(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const printerId = requireUuidParam(c.req.param("id"), "PrinterId");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const kind = requireEnum(body.kind, "kind", ["printer", "reader"] as const);
      const id = requireBodyUuid(body.id, "id");
      const result = await gated(sessionId, async (tx) => {
        const [target] = await tx
          .select({ ...receiptRollColumns })
          .from(printers)
          .where(and(isReceiptPrinter(), eq(printers.id, printerId), eq(printers.active, true)));
        if (target === undefined) throw new AppError("printer.not_found", { id: printerId });
        const [label] =
          kind === "printer"
            ? await tx
                .select({ name: printers.name })
                .from(printers)
                .where(and(isReceiptPrinter(), eq(printers.id, id), isNull(printers.deletedAt)))
            : await tx
                .select({ name: cardReaders.name })
                .from(cardReaders)
                .where(and(eq(cardReaders.id, id), isNull(cardReaders.deletedAt)));
        if (label === undefined)
          throw new AppError(kind === "printer" ? "printer.not_found" : "reader.not_found", { id });
        return enqueuePrintJob(
          tx,
          printerId,
          formatEquipmentLabel(target, { kind, id, name: label.name }),
          "document",
        );
      });
      return c.json(result, 202);
    }),
  );

  app.post("/management-api/printers/:id/test-print", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const result = await gated(sessionId, async (tx) => {
        const locale = await resolveSessionLocale(
          tx,
          sessionId,
          c.req.header("Accept-Language"),
          deps.venueLocale,
        );
        return enqueuePrintJob(tx, id, formatTestPage({ locale }));
      });
      return c.json(result, 202);
    }),
  );

  // Prints with the printer's SAVED settings, unlike the sample receipt below.
  app.post("/management-api/printers/:id/print-test-page", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrinterId");
      const result = await gated(sessionId, async (tx) => {
        const [printer] = await tx
          .select({
            name: printers.name,
            ...receiptRollColumns,
          })
          .from(printers)
          .where(and(isReceiptPrinter(), eq(printers.id, id), eq(printers.active, true)));
        if (printer === undefined) throw new AppError("printer.not_found", { id });
        const payload = await layOutPrinterTestPage(tx, deps.cfg, {
          printer: { paperWidth: printer.paperWidth, resolution: printer.resolution },
          printerName: printer.name,
          now: (deps.now ?? (() => new Date()))(),
          qrText: deps.receiptQrText,
        });
        return enqueuePrintJob(tx, id, payload);
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
      const printer = {
        paperWidth: requireEnum(body.paperWidth, "paperWidth", printPaperWidth.enumValues),
        resolution: requireEnum(body.resolution, "resolution", printResolution.enumValues),
      };
      const result = await gated(sessionId, async (tx) => {
        const { locale } = await readReceiptLanguage(tx);
        const payload = formatSampleReceipt(printer, deps.receiptQrText, locale);
        return enqueuePrintJob(tx, id, payload);
      });
      return c.json(result, 202);
    }),
  );
}

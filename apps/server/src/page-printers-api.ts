import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq } from "drizzle-orm";
import { pagePrinters, withTransaction, type Database, type Transaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import { AppError } from "@waitron/shared";
import {
  createErrorBoundary,
  readJsonBody,
  requireBodyUuid,
  requireManagementSession,
  requireNullableBodyUuid,
  requireString,
  requireUuidParam,
} from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import {
  disablePagePrinter,
  listPagePrinters,
  registerPagePrinter,
  renamePagePrinter,
  setInvoicePrinter,
  type DiscoveryWindow,
  type PagePrinterDiscovery,
} from "./page-printers.js";
import type { PageTestPages } from "./page-test-pages.js";

/** The IPP queue a discovery entry's office report names, as reported by one agent. */
export interface PagePrinterQueue {
  agentId: string;
  host: string;
  port: number;
  resourcePath: string;
}

export interface PagePrintersApiDeps {
  db: Database;
  locationId: string;
  /** The agent's held discovery entry for that queue, fresh or not; `registerPagePrinter` judges freshness. */
  findDiscovery: (queue: PagePrinterQueue) => PagePrinterDiscovery | undefined;
  discoveryWindow: () => DiscoveryWindow;
  /** Shared with the agent routes that hand them out. */
  testPages: PageTestPages;
  now?: () => Date;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "page_printer.not_found": 404,
  "page_printer.not_printable": 409,
  "page_printer.rediscover": 409,
  "page_printer.no_agent": 409,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
};

const run = createErrorBoundary(STATUS, "page_printer.failed");

function requireName(v: unknown): string {
  const name = requireString(v, "name").trim();
  if (name === "") throw new AppError("management.request_invalid", { field: "name" });
  return name;
}

function requirePort(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new AppError("management.request_invalid", { field: "port" });
  }
  return v;
}

export function mountPagePrintersApi(app: Hono, deps: PagePrintersApiDeps, log: Logger): void {
  // Bodies are screened inside the gate, so a caller without the permission learns nothing about them.
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, { managementSessionId: sessionId, permission: "printer.manage" });
      return fn(tx);
    });

  app.get("/management-api/page-printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => listPagePrinters(tx, deps.locationId));
      return c.json(
        rows.map((row) => ({
          id: row.id,
          name: row.name,
          host: row.host,
          port: row.port,
          resourcePath: row.resourcePath,
          documentFormat: row.documentFormat,
          supportedFormats: row.supportedFormats,
          media: row.media,
          resolutionDpi: row.resolutionDpi,
          active: row.active,
          invoicePrinter: row.invoiceDefault,
          agentId: row.agentId,
          agentName: row.agentName,
        })),
      );
    }),
  );

  // Capabilities and agent come from the named discovery entry; the body's only other say is the name.
  app.post("/management-api/page-printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const result = await gated(sessionId, (tx) => {
        const agentId = requireBodyUuid(body.agentId, "agentId");
        const host = requireString(body.host, "host").trim();
        if (host === "") throw new AppError("management.request_invalid", { field: "host" });
        const port = requirePort(body.port);
        const resourcePath = requireString(body.path, "path");
        const named = body.name === undefined ? "" : requireString(body.name, "name").trim();
        return registerPagePrinter(
          tx,
          deps.locationId,
          {
            name: named === "" ? host : named,
            entry: deps.findDiscovery({ agentId, host, port, resourcePath }),
          },
          deps.discoveryWindow(),
        );
      });
      return c.json(result, result.outcome === "created" ? 201 : 200);
    }),
  );

  app.put("/management-api/page-printers/invoice-printer", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ pagePrinterId?: unknown }>(c);
      await gated(sessionId, (tx) =>
        setInvoicePrinter(
          tx,
          deps.locationId,
          requireNullableBodyUuid(body.pagePrinterId, "pagePrinterId"),
        ),
      );
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/page-printers/:id/test-page", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PagePrinterId");
      await gated(sessionId, async (tx) => {
        const [printer] = await tx
          .select({ agentId: pagePrinters.agentId })
          .from(pagePrinters)
          .where(
            and(
              eq(pagePrinters.id, id),
              eq(pagePrinters.locationId, deps.locationId),
              eq(pagePrinters.active, true),
            ),
          );
        if (printer === undefined) throw new AppError("page_printer.not_found", {});
        if (printer.agentId === null) throw new AppError("page_printer.no_agent", {});
      });
      return c.json(deps.testPages.request(id), 202);
    }),
  );

  app.get("/management-api/page-printers/:id/test-page", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PagePrinterId");
      // A disabled printer is still read: its waiting page fails as `printer_disabled` at the first agent
      // claim that hands out no invoice, or as `not_claimed` once its claim window has passed.
      await gated(sessionId, async (tx) => {
        const [printer] = await tx
          .select({ id: pagePrinters.id })
          .from(pagePrinters)
          .where(and(eq(pagePrinters.id, id), eq(pagePrinters.locationId, deps.locationId)));
        if (printer === undefined) throw new AppError("page_printer.not_found", {});
      });
      return c.json(deps.testPages.read(id));
    }),
  );

  // Enabling needs current capabilities and a current agent, which only a fresh discovery entry
  // gives: it goes through the POST.
  app.patch("/management-api/page-printers/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PagePrinterId");
      const body = await readJsonBody<{ name?: unknown; active?: unknown }>(c);
      await gated(sessionId, async (tx) => {
        const name = body.name === undefined ? undefined : requireName(body.name);
        if (body.active !== undefined && typeof body.active !== "boolean") {
          throw new AppError("management.request_invalid", { field: "active" });
        }
        if (body.active === true) throw new AppError("page_printer.rediscover", {});
        if (name === undefined && body.active === undefined) {
          throw new AppError("management.request_invalid", { field: "name" });
        }
        if (name !== undefined) await renamePagePrinter(tx, deps.locationId, id, name);
        if (body.active === false) await disablePagePrinter(tx, deps.locationId, id, deps.now?.());
      });
      return c.body(null, 204);
    }),
  );
}

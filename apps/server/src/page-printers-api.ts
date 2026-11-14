import { readReceiptLanguage } from "@waitron/menu";
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
  requireString,
  requireUuidParam,
} from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import {
  deletePagePrinter,
  readPagePrinterDeleteImpact,
  listPagePrinters,
  registerPagePrinter,
  renamePagePrinter,
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
  /** The agent's held discovery entry for that queue, fresh or not; `registerPagePrinter` judges freshness. */
  findDiscovery: (queue: PagePrinterQueue) => PagePrinterDiscovery | undefined;
  discoveryWindow: () => DiscoveryWindow;
  /** Shared with the agent routes that hand them out. */
  testPages: PageTestPages;
  now?: () => Date;
  wakeAgent?: (agentId: string) => void;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "page_printer.not_found": 404,
  "page_printer.not_printable": 409,
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
      await authorizeManager(tx, { managementSessionId: sessionId, permission: "hardware.manage" });
      return fn(tx);
    });

  app.get("/management-api/page-printers", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, (tx) => listPagePrinters(tx));
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

  app.post("/management-api/page-printers/:id/test-page", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PagePrinterId");
      const { receiptLocale, agentId } = await gated(sessionId, async (tx) => {
        const [printer] = await tx
          .select({ agentId: pagePrinters.agentId })
          .from(pagePrinters)
          .where(and(eq(pagePrinters.id, id), eq(pagePrinters.active, true)));
        if (printer === undefined) throw new AppError("page_printer.not_found", {});
        if (printer.agentId === null) throw new AppError("page_printer.no_agent", {});
        const { locale } = await readReceiptLanguage(tx);
        return { receiptLocale: locale, agentId: printer.agentId };
      });
      const page = deps.testPages.request(id, receiptLocale);
      deps.wakeAgent?.(agentId);
      return c.json(page, 202);
    }),
  );

  app.get("/management-api/page-printers/:id/test-page", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PagePrinterId");
      await gated(sessionId, async (tx) => {
        // Keep a pending test page's outcome readable after its printer is deleted.
        const [printer] = await tx
          .select({ id: pagePrinters.id })
          .from(pagePrinters)
          .where(eq(pagePrinters.id, id));
        if (printer === undefined) throw new AppError("page_printer.not_found", {});
      });
      return c.json(deps.testPages.read(id));
    }),
  );

  app.get("/management-api/page-printers/:id/delete-impact", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PagePrinterId");
      return c.json(await gated(sessionId, (tx) => readPagePrinterDeleteImpact(tx, id)));
    }),
  );

  app.delete("/management-api/page-printers/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PagePrinterId");
      return c.json(await gated(sessionId, (tx) => deletePagePrinter(tx, id, deps.now?.())));
    }),
  );

  app.patch("/management-api/page-printers/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PagePrinterId");
      const body = await readJsonBody<{ name?: unknown; active?: unknown }>(c);
      await gated(sessionId, async (tx) => {
        const name = body.name === undefined ? undefined : requireName(body.name);
        if (Object.hasOwn(body, "active")) {
          throw new AppError("management.request_invalid", { field: "active" });
        }
        if (name === undefined) {
          throw new AppError("management.request_invalid", { field: "name" });
        }
        if (name !== undefined) await renamePagePrinter(tx, id, name);
      });
      return c.body(null, 204);
    }),
  );
}

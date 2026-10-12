import "./errors.js";
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq } from "drizzle-orm";
import {
  a4HoldCodes,
  invoiceDeliveries,
  pagePrinters,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  createErrorBoundary,
  readJsonBody,
  requireEnum,
  requireUuidParam,
} from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { requireAgent } from "./print-agent-session.js";
import { isUuid } from "./till-session.js";
import {
  expireInvoiceDeliveryClaims,
  INVOICE_DELIVERY_LEASE_MS,
  tokenHash,
  type InvoiceDeliveryClaim,
} from "./invoice-delivery.js";
import {
  claimInvoicePagePrint,
  renewInvoicePagePrint,
  reportInvoicePagePrint,
  type A4DeliveryOutcome,
} from "./invoice-page-print.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { renderInvoiceRaster } from "./invoice-raster.js";
import { encodeInvoiceRaster } from "./invoice-raster-encode.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";
import type { ReceiptQrText } from "@waitron/fiscal";
import type { PageTestPages } from "./page-test-pages.js";
import { sampleDocument } from "./sample-receipt.js";

export type PageFormat = (typeof pagePrinters.$inferSelect)["documentFormat"];

export type RenderInvoicePage = (
  document: ReceiptDocumentInput,
  format: PageFormat,
  resolutionDpi: number,
) => Promise<Buffer>;

export interface PagePrintApiDeps {
  db: Database;
  locationId: string;
  readInvoiceDocument: (tx: Transaction, saleId: string) => Promise<ReceiptDocumentInput>;
  /** Tests hold a render here; production renders with {@link renderInvoicePage}. */
  render?: RenderInvoicePage;
  /** Shared with the management route that requests them. */
  testPages: PageTestPages;
  receiptQrText?: ReceiptQrText;
  now?: () => Date;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "agent.unauthorized": 401,
  "invoice_delivery.claim_lost": 409,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
};

const run = createErrorBoundary(STATUS, "print.failed");

export const renderInvoicePage: RenderInvoicePage = async (document, format, resolutionDpi) => {
  if (format === "application/pdf") return renderInvoicePdf(document);
  if (resolutionDpi !== 300 && resolutionDpi !== 600) {
    throw new RangeError("An invoice raster is drawn at 300 or 600 dpi");
  }
  return encodeInvoiceRaster(
    await renderInvoiceRaster(document, resolutionDpi),
    format === "image/pwg-raster" ? "pwg" : "apple",
  );
};

function readClaim(body: Record<string, unknown>, deliveryId: string, holder: string) {
  const { generation, token } = body;
  if (
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    typeof token !== "string" ||
    !isUuid(token)
  ) {
    throw new AppError("management.request_invalid", { field: "claim" });
  }
  return { deliveryId, generation, token, holder } satisfies InvoiceDeliveryClaim;
}

/** What an agent may report; `printer_disabled` and `switched` are the server's own. */
const AGENT_FAILURES = {
  failed: ["printer_refused", "printer_unreachable", "document_unavailable"],
  unknown: ["printer_aborted", "timeout"],
} as const;

function readOutcome(body: Record<string, unknown>): A4DeliveryOutcome {
  const status = requireEnum(body.status, "status", ["sent", "failed", "unknown"] as const);
  if (status === "sent") {
    if (body.failureCode !== undefined) {
      throw new AppError("management.request_invalid", { field: "failureCode" });
    }
    return { status };
  }
  return {
    status,
    failureCode: requireEnum(body.failureCode, "failureCode", AGENT_FAILURES[status]),
  };
}

function readHold(body: Record<string, unknown>) {
  return body.hold === undefined || body.hold === null
    ? null
    : requireEnum(body.hold, "hold", a4HoldCodes);
}

export function mountPagePrintApi(app: Hono, deps: PagePrintApiDeps, log: Logger): void {
  const render = deps.render ?? renderInvoicePage;
  const now = () => deps.now?.() ?? new Date();
  // What each claim fixed when it was handed out, so a re-pointed printer cannot change the bytes of
  // a claim already out. Memory is enough: boot ends every claim a previous process left `sending`
  // (`expireInvoiceDeliveryClaims` with `restart`, `boot.ts`).
  const claimed = new Map<
    string,
    { format: PageFormat; resolutionDpi: number; touchedAt: number }
  >();
  const keyOf = (claim: InvoiceDeliveryClaim) =>
    `${claim.deliveryId}:${claim.generation}:${tokenHash(claim.token)}`;
  // A record untouched for longer than the lease belongs to a claim the database has also ended.
  const forgetLapsed = (at: Date) => {
    for (const [key, record] of claimed) {
      if (at.getTime() - record.touchedAt > INVOICE_DELIVERY_LEASE_MS) claimed.delete(key);
    }
  };
  const claimFrom = async (c: Context) => {
    const { agentId } = await requireAgent({ db: deps.db }, c);
    const id = requireUuidParam(c.req.param("id")!, "InvoiceDeliveryId");
    const body = await readJsonBody<Record<string, unknown>>(c);
    return { claim: readClaim(body, id, agentId), body };
  };

  app.post("/print-api/agent/page-jobs/claim", (c) =>
    run(c, log, async () => {
      const { agentId } = await requireAgent({ db: deps.db }, c);
      const at = now();
      forgetLapsed(at);
      // The test page is claimed inside the transaction too, so an overlapping claim sees it.
      const job = await withTransaction(deps.db, async (tx) => {
        const { job: invoice, busyPrinterIds } = await claimInvoicePagePrint(
          tx,
          agentId,
          { locationId: deps.locationId, exceptPrinterIds: deps.testPages.printingOn() },
          at,
        );
        if (invoice !== undefined || !deps.testPages.anyWaiting()) return invoice;
        const printers = await tx
          .select()
          .from(pagePrinters)
          .where(eq(pagePrinters.locationId, deps.locationId));
        const page = deps.testPages.claim(agentId, printers, busyPrinterIds);
        if (page === undefined) return undefined;
        return { page, printer: printers.find(({ id }) => id === page.pagePrinterId)! };
      });
      if (job === undefined) return c.body(null, 204);
      if ("page" in job) {
        const { page, printer } = job;
        return c.json({
          id: page.id,
          generation: page.generation,
          token: page.token,
          printer: {
            id: printer.id,
            host: printer.host,
            port: printer.port,
            resourcePath: printer.resourcePath,
            documentFormat: printer.documentFormat,
            media: printer.media,
            resolutionDpi: printer.resolutionDpi,
          },
        });
      }
      claimed.set(keyOf(job.claim), {
        format: job.printer.documentFormat,
        resolutionDpi: job.printer.resolutionDpi,
        touchedAt: at.getTime(),
      });
      return c.json({
        id: job.claim.deliveryId,
        generation: job.claim.generation,
        token: job.claim.token,
        printer: job.printer,
      });
    }),
  );

  app.post("/print-api/agent/page-jobs/:id/document", (c) =>
    run(c, log, async () => {
      const { claim } = await claimFrom(c);
      if (deps.testPages.knows(claim.deliveryId)) {
        const held = deps.testPages.printing(claim);
        if (held === undefined) throw new AppError("invoice_delivery.claim_lost", {});
        const bytes = await render(
          { ...sampleDocument(deps.receiptQrText), surface: "a4" },
          held.format,
          held.resolutionDpi,
        );
        return c.body(new Uint8Array(bytes), 200, {
          "content-type": held.format,
          "cache-control": "no-store",
        });
      }
      const at = now();
      forgetLapsed(at);
      const record = claimed.get(keyOf(claim));
      if (record === undefined) throw new AppError("invoice_delivery.claim_lost", {});
      const read = await withTransaction(deps.db, async (tx) => {
        await expireInvoiceDeliveryClaims(tx, at);
        const [current] = await tx
          .select({ saleId: invoiceDeliveries.saleId, designation: invoiceDeliveries.designation })
          .from(invoiceDeliveries)
          .where(
            and(
              eq(invoiceDeliveries.id, claim.deliveryId),
              eq(invoiceDeliveries.status, "sending"),
              eq(invoiceDeliveries.generation, claim.generation),
              eq(invoiceDeliveries.claimTokenHash, tokenHash(claim.token)),
              eq(invoiceDeliveries.claimedBy, claim.holder),
            ),
          );
        if (current === undefined) return undefined;
        return {
          designation: current.designation,
          document: await deps.readInvoiceDocument(tx, current.saleId),
        };
      });
      if (read === undefined) throw new AppError("invoice_delivery.claim_lost", {});
      const bytes = await render(
        { ...read.document, duplicate: read.designation === "duplicate" },
        record.format,
        record.resolutionDpi,
      );
      return c.body(new Uint8Array(bytes), 200, {
        "content-type": record.format,
        "cache-control": "no-store",
      });
    }),
  );

  app.post("/print-api/agent/page-jobs/:id/renew", (c) =>
    run(c, log, async () => {
      const { claim, body } = await claimFrom(c);
      const hold = readHold(body);
      if (deps.testPages.knows(claim.deliveryId)) {
        if (!deps.testPages.renew(claim, hold)) {
          throw new AppError("invoice_delivery.claim_lost", {});
        }
        return c.body(null, 204);
      }
      const at = now();
      // Before the transaction, so a claim poll that runs while this renewal waits for the write
      // lock does not drop the record of a claim the renewal then keeps.
      const record = claimed.get(keyOf(claim));
      if (record !== undefined) record.touchedAt = at.getTime();
      const renewed = await withTransaction(deps.db, (tx) =>
        renewInvoicePagePrint(tx, claim, hold, at),
      );
      if (renewed === "lost") throw new AppError("invoice_delivery.claim_lost", {});
      return c.body(null, 204);
    }),
  );

  app.post("/print-api/agent/page-jobs/:id/result", (c) =>
    run(c, log, async () => {
      const { claim, body } = await claimFrom(c);
      const outcome = readOutcome(body);
      if (deps.testPages.knows(claim.deliveryId)) {
        if (!deps.testPages.report(claim, outcome)) {
          throw new AppError("invoice_delivery.claim_lost", {});
        }
        return c.body(null, 204);
      }
      const reported = await withTransaction(deps.db, (tx) =>
        reportInvoicePagePrint(tx, claim, outcome, now()),
      );
      if (!reported.updated && !reported.historical && !reported.repeated) {
        throw new AppError("invoice_delivery.claim_lost", {});
      }
      claimed.delete(keyOf(claim));
      return c.body(null, 204);
    }),
  );
}

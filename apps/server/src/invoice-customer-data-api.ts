import { recipientIdentifierResult } from "@waitron/country-packs";
import type { RecipientIdentifier } from "@waitron/country-packs";
import "./errors.js";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { Context, Hono } from "hono";
import { readTenant, type Database } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import { readPrivacyContact } from "@waitron/provisioning";
import { civilDateOf } from "@waitron/reporting";
import { AppError, resolveActiveLocale } from "@waitron/shared";
import { requireManagementSession } from "@waitron/server-kit";
import { archiveFileName, zipArchiveInTurns } from "./download-archive.js";
import {
  buildInvoiceCustomerFiles,
  findInvoiceCustomerSales,
  type InvoiceCustomerFilesDeps,
} from "./invoice-customer-data.js";
import { requiredInvoiceTaxId } from "./invoice-customer-tax-id.js";
import type { Logger } from "./logger.js";
import { toLanguage, venuePlace, withPersonalDataErrors } from "./personal-data-export-api.js";
import { invoiceCustomerReadme } from "./personal-data-readme.js";
import type { TradingContext } from "./trading-context.js";

export interface InvoiceCustomerDataDeps {
  db: Database;
  backend: FiscalBackend;
  tradingContext: TradingContext;
  /** The node whose time zone dates the download. */
  nodeId: string;
  venueLocale: string;
  now?: () => Date;
  render?: InvoiceCustomerFilesDeps["render"];
  readDocument?: InvoiceCustomerFilesDeps["readDocument"];
  /** Read per request; true refuses both routes (decision 14). */
  onMirror: () => boolean;
}

const SEARCH_PATH = "/management-api/invoice-customers/personal-data";
const DOWNLOAD_PATH = "/management-api/invoice-customers/personal-data/export";

function queriedIdentifier(c: Context): RecipientIdentifier {
  const query = new URL(c.req.url).searchParams;
  const keys = [...query.keys()];
  const accepted = ["taxId", "identifierType", "identifierCountryCode"];
  if (
    keys.some((key) => !accepted.includes(key)) ||
    accepted.some((key) => query.getAll(key).length > 1)
  )
    throw new AppError("management.request_invalid", { field: "query" });
  if (!query.has("identifierType") && !query.has("identifierCountryCode")) {
    return { taxId: requiredInvoiceTaxId(query.get("taxId") ?? undefined) };
  }
  const input = {
    taxId: query.get("taxId"),
    ...(query.has("identifierType") ? { identifierType: query.get("identifierType") } : {}),
    ...(query.has("identifierCountryCode")
      ? { identifierCountryCode: query.get("identifierCountryCode") }
      : {}),
  };
  const checked = recipientIdentifierResult(input);
  if (!checked.valid) throw new AppError("management.request_invalid", { field: checked.field });
  return checked.value;
}

export function mountInvoiceCustomerDataApi(
  app: Hono,
  deps: InvoiceCustomerDataDeps,
  log: Logger,
): void {
  // Lock turns read through the database itself, not `withTransaction`: nothing is written, and
  // its closing change-log drain is a write a full disk refuses.
  const tx = deps.db;
  const authorize = (token: string) =>
    authorizeManager(tx, {
      managementSessionId: token,
      permission: "personal_data.export",
      touch: false,
    });
  // Closed on a mirror for good: the owner decided on 2026-10-26 that a mirror serves no dashboard.
  const refuseOnMirror = () => {
    if (deps.onMirror()) throw new AppError("node.read_only", {});
  };

  app.get(SEARCH_PATH, (c) =>
    withPersonalDataErrors(c, log, async () => {
      refuseOnMirror();
      const token = requireManagementSession(c);
      const found = await deps.db.withWriteLock(async () => {
        // Permission before the query: a refused caller gets one answer whatever they typed.
        await authorize(token);
        const identity = queriedIdentifier(c);
        return { identity, sales: await findInvoiceCustomerSales(tx, identity.taxId, identity) };
      });
      c.header("Cache-Control", "no-store");
      return c.json({
        ...found.identity,
        invoices: found.sales.map(({ invoice, issuedAt, name, total }) => ({
          invoice,
          issuedAt,
          name,
          total,
        })),
      });
    }),
  );

  app.get(DOWNLOAD_PATH, (c) =>
    withPersonalDataErrors(c, log, async () => {
      refuseOnMirror();
      const token = requireManagementSession(c);
      const at = (deps.now ?? (() => new Date()))();
      const first = await deps.db.withWriteLock(async () => {
        const { authorizedBy } = await authorize(token);
        const identity = queriedIdentifier(c);
        const place = await venuePlace(tx, deps.nodeId);
        const tenant = await readTenant(tx);
        const privacyNoticeUrl = (await readPrivacyContact(tx))?.privacyNoticeUrl ?? null;
        const sales = await findInvoiceCustomerSales(tx, identity.taxId, identity);
        return { authorizedBy, taxId: identity.taxId, place, tenant, privacyNoticeUrl, sales };
      });
      const newest = first.sales.at(-1);
      if (newest === undefined) throw new AppError("invoice_customer.not_found", {});
      await nextTurn();
      const built = await buildInvoiceCustomerFiles(
        {
          db: deps.db,
          backend: deps.backend,
          tradingContext: deps.tradingContext,
          log,
          render: deps.render,
          readDocument: deps.readDocument,
        },
        first.taxId,
        first.sales,
      );
      const readme = invoiceCustomerReadme({
        // A customer has no saved language, so the venue's (decision 10).
        language: toLanguage(resolveActiveLocale(null, deps.venueLocale)),
        venue: first.tenant?.legalName ?? null,
        customer: newest.name,
        date: civilDateOf(at, first.place.timeZone),
        ...(first.privacyNoticeUrl === null ? {} : { privacyNoticeUrl: first.privacyNoticeUrl }),
        anyTaxRecord: built.anyTaxRecord,
        anyEmail: built.anyEmail,
      });
      const body = await zipArchiveInTurns(
        [{ name: "README.txt", content: readme }, ...built.files],
        at,
      );
      // Building and zipping outlive the first turn, so authority is checked again once the ZIP
      // is whole, and nothing yields between that check and the answer.
      await deps.db.withWriteLock(async () => {
        const again = await authorize(token);
        if (again.authorizedBy !== first.authorizedBy)
          throw new Error("invoice customer authorisation named a different person after building");
      });
      c.header("Content-Type", "application/zip");
      c.header(
        "Content-Disposition",
        `attachment; filename="${archiveFileName(newest.name, at, first.place.timeZone)}"`,
      );
      c.header("Cache-Control", "no-store");
      c.header("X-Content-Type-Options", "nosniff");
      return c.body(body);
    }),
  );
}

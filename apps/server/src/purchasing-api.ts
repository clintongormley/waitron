import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, decimal } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  createPurchaseInvoice,
  deletePurchaseInvoice,
  getPurchaseInvoice,
  listPurchaseInvoices,
  updatePurchaseInvoice,
  type ListPurchaseInvoicesInput,
  type PurchaseInvoiceHeaderInput,
  type PurchaseInvoiceLineInput,
  type PurchaseRegime,
  type PurchaseVatKind,
  type UpdatePurchaseInvoiceInput,
} from "@waitron/purchasing";
import { authorizeManager, type Permission } from "@waitron/identity";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import {
  requireNullableString,
  requirePeriod,
  requireString,
  requireUuidParam,
} from "@waitron/server-kit";
import type { Logger } from "./logger.js";

export interface PurchasingApiDeps {
  db: Database;
}

/** The one permission that gates every purchase-invoice route. */
const PURCHASE_WRITE_PERMISSION: Permission = "purchase.manage";

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "shared.invalid_decimal": 400,
  // Raised by the op's `decimalToCents`, after these screens, not by them.
  "shared.decimal_overflow": 400,
  "purchase.not_found": 404,
  "purchase.duplicate": 409,
  "purchase.invalid": 400,
};

const run = createErrorBoundary(STATUS, "purchase.failed");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checked here so a foreign value is a 400 naming the field, not the column's check refusal. */
function requireRegime(v: unknown): PurchaseRegime {
  if (v !== "general" && v !== "equivalence_surcharge") {
    throw new AppError("management.request_invalid", { field: "regime" });
  }
  return v;
}

function requireVatKind(v: unknown): PurchaseVatKind {
  if (v !== "ordinary" && v !== "capital") {
    throw new AppError("management.request_invalid", { field: "kind" });
  }
  return v;
}

function requireDecimal(v: unknown, field: string): Decimal {
  return decimal(requireString(v, field));
}

/**
 * This screens the decimal LITERAL; the op range-checks `deductibleProportion` and each line. The
 * header's `total` is not checked for sign on the server, deliberately: a negative total is a
 * supplier credit note (owner ruling 2026-09-21, docs/backlog.md → Track C).
 */
function screenHeaderCreate(v: unknown): PurchaseInvoiceHeaderInput {
  if (!isPlainObject(v)) throw new AppError("management.request_invalid", { field: "header" });
  const header: PurchaseInvoiceHeaderInput = {
    supplierTaxId: requireString(v.supplierTaxId, "supplierTaxId"),
    supplierName: requireString(v.supplierName, "supplierName"),
    supplierInvoiceNumber: requireString(v.supplierInvoiceNumber, "supplierInvoiceNumber"),
    issuedOn: requirePeriod(v.issuedOn, "issuedOn"),
    receivedOn: requirePeriod(v.receivedOn, "receivedOn"),
    total: requireDecimal(v.total, "total"),
  };
  if (v.regime !== undefined) header.regime = requireRegime(v.regime);
  if (v.deductibleProportion !== undefined) {
    header.deductibleProportion = requireDecimal(v.deductibleProportion, "deductibleProportion");
  }
  if (v.note !== undefined) header.note = requireNullableString(v.note, "note");
  return header;
}

function screenHeaderPatch(v: unknown): Partial<PurchaseInvoiceHeaderInput> {
  if (!isPlainObject(v)) throw new AppError("management.request_invalid", { field: "header" });
  const header: Partial<PurchaseInvoiceHeaderInput> = {};
  if (v.supplierTaxId !== undefined)
    header.supplierTaxId = requireString(v.supplierTaxId, "supplierTaxId");
  if (v.supplierName !== undefined)
    header.supplierName = requireString(v.supplierName, "supplierName");
  if (v.supplierInvoiceNumber !== undefined) {
    header.supplierInvoiceNumber = requireString(v.supplierInvoiceNumber, "supplierInvoiceNumber");
  }
  if (v.issuedOn !== undefined) header.issuedOn = requirePeriod(v.issuedOn, "issuedOn");
  if (v.receivedOn !== undefined) header.receivedOn = requirePeriod(v.receivedOn, "receivedOn");
  if (v.total !== undefined) header.total = requireDecimal(v.total, "total");
  if (v.regime !== undefined) header.regime = requireRegime(v.regime);
  if (v.deductibleProportion !== undefined) {
    header.deductibleProportion = requireDecimal(v.deductibleProportion, "deductibleProportion");
  }
  if (v.note !== undefined) header.note = requireNullableString(v.note, "note");
  return header;
}

/** An empty list passes this screen; the op refuses it with `purchase.invalid` `no_lines`. */
function screenLines(v: unknown): PurchaseInvoiceLineInput[] {
  if (!Array.isArray(v)) throw new AppError("management.request_invalid", { field: "lines" });
  return v.map((line) => {
    if (!isPlainObject(line)) throw new AppError("management.request_invalid", { field: "lines" });
    const parsed: PurchaseInvoiceLineInput = {
      rate: requireDecimal(line.rate, "rate"),
      base: requireDecimal(line.base, "base"),
      tax: requireDecimal(line.tax, "tax"),
    };
    if (line.kind !== undefined) parsed.kind = requireVatKind(line.kind);
    return parsed;
  });
}

export function mountPurchasingApi(app: Hono, deps: PurchasingApiDeps, log: Logger): void {
  // Every route's DB work goes through here, so the gate is applied in exactly one place.
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: PURCHASE_WRITE_PERMISSION,
      });
      return fn(tx);
    });

  app.get("/management-api/purchase-invoices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // An optional half-open `received_on` window: `from` inclusive, `to` exclusive.
      const opts: ListPurchaseInvoicesInput = {};
      const from = c.req.query("from");
      const to = c.req.query("to");
      if (from !== undefined) opts.from = requirePeriod(from, "from");
      if (to !== undefined) opts.to = requirePeriod(to, "to");
      const rows = await gated(sessionId, (tx) => listPurchaseInvoices(tx, opts));
      return c.json(rows);
    }),
  );

  app.get("/management-api/purchase-invoices/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PurchaseInvoiceId");
      const invoice = await gated(sessionId, (tx) => getPurchaseInvoice(tx, id));
      if (invoice === null) throw new AppError("purchase.not_found", { id });
      return c.json(invoice);
    }),
  );

  app.post("/management-api/purchase-invoices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ header?: unknown; lines?: unknown }>(c);
      const header = screenHeaderCreate(body.header);
      const lines = screenLines(body.lines);
      const created = await gated(sessionId, (tx) => createPurchaseInvoice(tx, { header, lines }));
      return c.json(created, 201);
    }),
  );

  app.patch("/management-api/purchase-invoices/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PurchaseInvoiceId");
      // An empty body is a no-op that still bumps `updated_at`; `lines` present replaces the whole
      // desglose.
      const body = await readJsonBody<{ header?: unknown; lines?: unknown }>(c);
      const patch: UpdatePurchaseInvoiceInput = {};
      if (body.header !== undefined) patch.header = screenHeaderPatch(body.header);
      if (body.lines !== undefined) patch.lines = screenLines(body.lines);
      await gated(sessionId, (tx) => updatePurchaseInvoice(tx, id, patch));
      return c.body(null, 204);
    }),
  );

  app.delete("/management-api/purchase-invoices/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PurchaseInvoiceId");
      await gated(sessionId, (tx) => deletePurchaseInvoice(tx, id));
      return c.body(null, 204);
    }),
  );
}

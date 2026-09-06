// Side-effect only: loads this host's errors.ts augmentation for `management.request_invalid` — the
// code the body/query screens below throw directly (declared in `./errors.js`), under the "every file
// that throws one of these imports ./errors.js" convention. `shared.invalid_id` (thrown by
// `requireUuidParam`) is declared in `@waitron/shared` and loads via the `AppError` value import; the
// `purchase.*` codes this file throws (`purchase.not_found` in the GET/PATCH/DELETE routes, and
// `purchase.duplicate`/`purchase.invalid` raised by the ops) are declared in `@waitron/purchasing`'s
// own errors.ts and load transitively through the value imports of its CRUD ops below — the same
// transitive-reachability shape `catalogue-api.ts` relies on for the `media.*` codes. So this one line
// is all this file needs.
import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import type { Decimal } from "@waitron/shared";
import { asAppUser, withTenant, type Database, type Transaction } from "@waitron/db";
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
import { createErrorBoundary } from "./error-boundary.js";
import { readJsonBody } from "./read-json-body.js";
import { requireManagementSession } from "./management-session.js";
import {
  requireNullableString,
  requirePeriod,
  requireString,
  requireUuidParam,
} from "./request-screens.js";
import type { Logger } from "./logger.js";

/**
 * Everything the dashboard's purchase-invoice routes need: `db` + this venue's own `cfg.tenantId`
 * are passed to every `withTenant` below. The database holds this server's one tenant. No
 * `nodeId` (unlike `CatalogueApiDeps`): the purchase-invoice tables carry no sync-capture
 * trigger, so there is no `sync_log.origin_id` to attribute. No card provider, clock or media
 * store either — these routes touch only the two purchase-invoice tables via the headless
 * `@waitron/purchasing` ops.
 */
export interface PurchasingApiDeps {
  db: Database;
  cfg: { tenantId: string };
}

/**
 * The ONE permission that gates every purchase-invoice route — the catalogue §3 seam, one named
 * constant referenced at every route rather than an inline literal, so a future re-mapping is a
 * one-line swap here. Realised (unlike the catalogue's placeholder `person.manage`) as the
 * domain-named `purchase.manage`, which maps to `manager` + `admin` — the dashboard's audience.
 */
const PURCHASE_WRITE_PERMISSION: Permission = "purchase.manage";

/**
 * Every AppError CODE these routes answer, and the HTTP status it maps to — the purchase parallel of
 * `catalogue-api.ts`'s `STATUS`. CLIENT faults only: a genuine SERVER fault (a driver error, or a
 * malformed decimal string that reaches the op's `compareDecimal` / a `numeric` column) reaches `run`
 * as a NON-AppError and becomes an opaque 500 — the same typeof-only posture `catalogue-api.ts` takes
 * for a malformed `unitPrice`. A registered code absent from this table defaults to 400 via `run`.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "purchase.not_found": 404,
  "purchase.duplicate": 409,
  "purchase.invalid": 400,
};

// The one error boundary every purchase-invoice route wraps its handler in — the shared
// `createErrorBoundary` closed over this surface's `STATUS` map and its `purchase.failed` log tag.
const run = createErrorBoundary(STATUS, "purchase.failed");

/** True for a non-null, non-array object — the shape a JSON `header` must take before its fields are
 * screened (the same guard `catalogue-api.ts` applies to its object fields). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Screen the `regime` enum — one of the two `purchase_regime` members, else
 * `management.request_invalid`. A typeof-only pass would let a foreign string reach the pgEnum as a
 * `22P02` → an opaque 500, so the two members are checked here for a clean 400. */
function requireRegime(v: unknown): PurchaseRegime {
  if (v !== "general" && v !== "equivalence_surcharge") {
    throw new AppError("management.request_invalid", { field: "regime" });
  }
  return v;
}

/** Screen a line's `kind` enum — one of the two `purchase_vat_kind` members, else
 * `management.request_invalid` (the `requireRegime` reasoning, for the per-line enum). */
function requireVatKind(v: unknown): PurchaseVatKind {
  if (v !== "ordinary" && v !== "capital") {
    throw new AppError("management.request_invalid", { field: "kind" });
  }
  return v;
}

/**
 * Screen the create body's `header`: every REQUIRED scalar present and well-typed, the two dates a real
 * calendar day (`requirePeriod`), the optional `regime`/`deductibleProportion`/`note` screened only
 * when present. Money fields are typeof-screened as strings and cast to `Decimal` — the op re-validates
 * ranges (`purchase.invalid`) and the DB is the value authority, the same typeof-only posture
 * `catalogue-api.ts` takes for `unitPrice` (a malformed decimal becomes an opaque 500 downstream).
 */
function screenHeaderCreate(v: unknown): PurchaseInvoiceHeaderInput {
  if (!isPlainObject(v)) throw new AppError("management.request_invalid", { field: "header" });
  const header: PurchaseInvoiceHeaderInput = {
    supplierTaxId: requireString(v.supplierTaxId, "supplierTaxId"),
    supplierName: requireString(v.supplierName, "supplierName"),
    supplierInvoiceNumber: requireString(v.supplierInvoiceNumber, "supplierInvoiceNumber"),
    issuedOn: requirePeriod(v.issuedOn, "issuedOn"),
    receivedOn: requirePeriod(v.receivedOn, "receivedOn"),
    total: requireString(v.total, "total") as Decimal,
  };
  if (v.regime !== undefined) header.regime = requireRegime(v.regime);
  if (v.deductibleProportion !== undefined) {
    header.deductibleProportion = requireString(
      v.deductibleProportion,
      "deductibleProportion",
    ) as Decimal;
  }
  if (v.note !== undefined) header.note = requireNullableString(v.note, "note");
  return header;
}

/**
 * Screen a PATCH body's `header`: any subset of the create fields, each screened ONLY when present (a
 * PATCH touches only what it names), so an absent field is left unchanged by the op. Same per-field
 * checks as `screenHeaderCreate`.
 */
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
  if (v.total !== undefined) header.total = requireString(v.total, "total") as Decimal;
  if (v.regime !== undefined) header.regime = requireRegime(v.regime);
  if (v.deductibleProportion !== undefined) {
    header.deductibleProportion = requireString(
      v.deductibleProportion,
      "deductibleProportion",
    ) as Decimal;
  }
  if (v.note !== undefined) header.note = requireNullableString(v.note, "note");
  return header;
}

/**
 * Screen the VAT desglose: an array (an empty one passes the shape screen and reaches the op, which
 * throws `purchase.invalid` `no_lines`), each element an object with well-typed `rate`/`base`/`tax`
 * strings and an optional `kind` enum. Money is typeof-only for the reason `screenHeaderCreate` gives.
 */
function screenLines(v: unknown): PurchaseInvoiceLineInput[] {
  if (!Array.isArray(v)) throw new AppError("management.request_invalid", { field: "lines" });
  return v.map((line) => {
    if (!isPlainObject(line)) throw new AppError("management.request_invalid", { field: "lines" });
    const parsed: PurchaseInvoiceLineInput = {
      rate: requireString(line.rate, "rate") as Decimal,
      base: requireString(line.base, "base") as Decimal,
      tax: requireString(line.tax, "tax") as Decimal,
    };
    if (line.kind !== undefined) parsed.kind = requireVatKind(line.kind);
    return parsed;
  });
}

/**
 * Mounts the dashboard's gated purchase-invoice write group on an existing Hono app —
 * `mountCatalogueApi`'s sibling, attached to the SAME app (the `mountWebhook`/`mountTillApi`
 * convention). Every route wraps its handler in `run`, calls `requireManagementSession(c)` (→ 401
 * before any DB work) and then, inside `withTenant` + `asAppUser`, `authorizeManager(...)` (→
 * 403) before the headless `@waitron/purchasing` op, in the database holding this server's one
 * tenant. The `purchase.manage` gate runs on every route through one constant.
 */
export function mountPurchasingApi(app: Hono, deps: PurchasingApiDeps, log: Logger): void {
  // Open a tenant-scoped transaction as the app role, confirm the caller's management session carries
  // PURCHASE_WRITE_PERMISSION, then run `fn`. Every route funnels its DB work through here so the gate
  // is applied identically and in exactly one place — the catalogue §3 seam.
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: PURCHASE_WRITE_PERMISSION,
      });
      return fn(tx);
    });

  // ── List ─────────────────────────────────────────────────────────────────────────────────────────
  app.get("/management-api/purchase-invoices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Optional half-open `received_on` window (the deduction-period bound). Each query param, when
      // present, is screened to a real calendar day; absent leaves the bound off.
      const opts: ListPurchaseInvoicesInput = {};
      const from = c.req.query("from");
      const to = c.req.query("to");
      if (from !== undefined) opts.from = requirePeriod(from, "from");
      if (to !== undefined) opts.to = requirePeriod(to, "to");
      const rows = await gated(sessionId, (tx) => listPurchaseInvoices(tx, opts));
      return c.json(rows);
    }),
  );

  // ── Get one ──────────────────────────────────────────────────────────────────────────────────────
  app.get("/management-api/purchase-invoices/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PurchaseInvoiceId");
      const invoice = await gated(sessionId, (tx) => getPurchaseInvoice(tx, id));
      // A well-formed id that names no visible row is a clean 404, not a 200 null body — the op
      // returns null (the database holds one tenant), so this route makes it explicit.
      if (invoice === null) throw new AppError("purchase.not_found", { id });
      return c.json(invoice);
    }),
  );

  // ── Create ───────────────────────────────────────────────────────────────────────────────────────
  app.post("/management-api/purchase-invoices", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      // Read via `readJsonBody` so an empty/malformed/`null`/non-object body reaches the header screen as
      // a 400 (naming `header`) rather than becoming an opaque 500 — the catalogue null-body convention.
      const body = await readJsonBody<{ header?: unknown; lines?: unknown }>(c);
      const header = screenHeaderCreate(body.header);
      const lines = screenLines(body.lines);
      const created = await gated(sessionId, (tx) =>
        createPurchaseInvoice(tx, brandTenantId(deps.cfg.tenantId), { header, lines }),
      );
      return c.json(created, 201);
    }),
  );

  // ── Update ───────────────────────────────────────────────────────────────────────────────────────
  app.patch("/management-api/purchase-invoices/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PurchaseInvoiceId");
      // Both `header` and `lines` are OPTIONAL; the body is coerced to `{}` by `readJsonBody` so an
      // empty/malformed/`null` body is a legitimate no-op that still bumps `updated_at` (and 404s a
      // missing id, via the op). `lines` present ⇒ a FULL replacement of the desglose (the op's contract).
      const body = await readJsonBody<{ header?: unknown; lines?: unknown }>(c);
      const patch: UpdatePurchaseInvoiceInput = {};
      if (body.header !== undefined) patch.header = screenHeaderPatch(body.header);
      if (body.lines !== undefined) patch.lines = screenLines(body.lines);
      await gated(sessionId, (tx) =>
        updatePurchaseInvoice(tx, brandTenantId(deps.cfg.tenantId), id, patch),
      );
      return c.body(null, 204);
    }),
  );

  // ── Delete ───────────────────────────────────────────────────────────────────────────────────────
  app.delete("/management-api/purchase-invoices/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PurchaseInvoiceId");
      // The op throws `purchase.not_found` (→ 404) when the id matches no visible row; its VAT lines
      // cascade on delete.
      await gated(sessionId, (tx) => deletePurchaseInvoice(tx, id));
      return c.body(null, 204);
    }),
  );
}

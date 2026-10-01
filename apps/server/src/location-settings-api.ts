import type { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { readInvoiceLocales } from "@waitron/catalogue";
import { locations, withTransaction, type Database, type Transaction } from "@waitron/db";
import type { FiscalContribution } from "@waitron/fiscal";
import { authorizeManager } from "@waitron/identity";
import { AppError, isAppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { readVenueReceiptLanguageRules } from "./venue-locale.js";
import "./errors.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "management.request_invalid": 400,
    "receipt.language_fixed": 400,
    "receipt.language_orders_open": 409,
  },
  "management.failed",
);

/**
 * The orders at the location with a line the till can still write. Such a write is refused by
 * `working_order_lines_check_locales_update` once the line's language key no longer matches the
 * location, so a language change waits for every one of them. An order blocks while it is open or
 * placed; while it is paid and its party, or the party it was merged into, is still seated, as its
 * dishes can then be served, unserved or fired; and while it is paid with an unsent line and no
 * kitchen item, which `POST /api/working-orders/:id/prep` can still send (it refuses once any line
 * has one). No route writes a line of an abandoned bill, or of a paid bill whose party has left.
 */
async function ordersBlockingReceiptLanguage(tx: Transaction, locationId: string): Promise<number> {
  const { rows } = await tx.execute<{ count: number }>(sql`
    with recursive seated(id) as (
      select id from parties where state = 'open'
      union
      select p.id from parties p join seated s on p.merged_into_party_id = s.id
    )
    select cast(count(*) as int) as count
    from working_orders wo
    join tills t on t.id = wo.till_id
    where t.location_id = ${locationId}
      and (
        wo.status in ('open', 'placed')
        or (wo.status = 'settled' and wo.party_id in (select id from seated))
        or (
          wo.status = 'settled'
          and exists (
            select 1 from working_order_lines l
            where l.working_order_id = wo.id and l.sent_at is null
          )
          and not exists (select 1 from ticket_items ti where ti.working_order_id = wo.id)
        )
      )`);
  return rows[0]!.count;
}

/** The location's saved receipt languages, the first being the one receipts print in. */
async function storedLanguages(tx: Transaction, locationId: string): Promise<string[]> {
  const stored = await readInvoiceLocales(tx, locationId);
  if (stored.length === 0)
    throw new AppError("management.request_invalid", { field: "locationId" });
  return stored;
}

function requestedLanguage(body: unknown): string {
  const language =
    typeof body === "object" && body !== null && "language" in body ? body.language : undefined;
  if (typeof language !== "string") {
    throw new AppError("management.request_invalid", { field: "receiptLanguage" });
  }
  return language;
}

export function mountLocationSettingsApi(
  app: Hono,
  deps: { db: Database; cfg: { locationId: string }; fiscal: FiscalContribution },
  log: Logger,
): void {
  const scope = eq(locations.id, deps.cfg.locationId);
  const gated = <T>(sessionId: string, fn: (tx: Transaction) => Promise<T>) =>
    withTransaction(deps.db, async (tx) => {
      await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: "venue.configure",
      });
      return fn(tx);
    });
  app.get("/management-api/location-settings", (c) =>
    run(c, log, async () => {
      const result = await gated(requireManagementSession(c), async (tx) => {
        const [location] = await tx
          .select({ name: locations.name, operationDescription: locations.operationDescription })
          .from(locations)
          .where(scope);
        if (location === undefined)
          throw new AppError("management.request_invalid", { field: "locationId" });
        return location;
      });
      return c.json(result);
    }),
  );
  app.put("/management-api/location-settings", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      await gated(sessionId, async (tx) => {
        const description =
          typeof body === "object" && body !== null && "operationDescription" in body
            ? body.operationDescription
            : undefined;
        if (typeof description !== "string" || description.trim() === "") {
          throw new AppError("management.request_invalid", { field: "operationDescription" });
        }
        try {
          deps.fiscal.venueFields?.validateOperationDescription(description);
        } catch (error) {
          if (!isAppError(error) || error.code !== "setup.request_invalid") throw error;
          throw new AppError("management.request_invalid", { field: "operationDescription" });
        }
        // Future records read this setting; previously recorded invoices keep their own description.
        const updated = await tx
          .update(locations)
          .set({ operationDescription: description })
          .where(scope)
          .returning({ id: locations.id });
        if (updated.length === 0)
          throw new AppError("management.request_invalid", { field: "locationId" });
      });
      return c.body(null, 204);
    }),
  );
  app.get("/management-api/receipt-language", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rules = await readVenueReceiptLanguageRules(deps.db, {
        locationId: deps.cfg.locationId,
      });
      const [language] = await gated(sessionId, (tx) => storedLanguages(tx, deps.cfg.locationId));
      return c.json({ language, choices: rules.choices, fixed: rules.fixed ?? null });
    }),
  );
  app.put("/management-api/receipt-language", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      const rules = await readVenueReceiptLanguageRules(deps.db, {
        locationId: deps.cfg.locationId,
      });
      await gated(sessionId, async (tx) => {
        const language = requestedLanguage(body);
        if (!rules.choices.includes(language)) {
          throw new AppError("management.request_invalid", { field: "receiptLanguage" });
        }
        if (rules.fixed !== undefined && language !== rules.fixed.locale) {
          throw new AppError("receipt.language_fixed", {
            field: "receiptLanguage",
            language: rules.fixed.locale,
          });
        }
        const stored = await storedLanguages(tx, deps.cfg.locationId);
        // Saving the list the location already holds changes no line's key.
        if (stored.length === 1 && stored[0] === language) return;
        const count = await ordersBlockingReceiptLanguage(tx, deps.cfg.locationId);
        if (count > 0) {
          throw new AppError("receipt.language_orders_open", { field: "receiptLanguage", count });
        }
        await tx
          .update(locations)
          .set({ invoiceLocales: [language] })
          .where(scope);
      });
      return c.body(null, 204);
    }),
  );
}

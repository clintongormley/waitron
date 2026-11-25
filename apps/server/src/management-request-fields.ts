import { type Transaction, withTransaction } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
// Error declaration for the `product.not_found` code in `requireProductId`.
import "@waitron/menu";
import { isUuid, AppError, int4InRange } from "@waitron/shared";
import type { ManagementApiDeps } from "./management-api-deps.js";
import type { TradingContext } from "./trading-context.js";

/**
 * Path id checks refuse a malformed id with the resource's not-found code before it reaches a
 * plain text column. The query checks whether a well-formed id names a row.
 */
export function requireStationId(id: string): string {
  if (!isUuid(id)) throw new AppError("station.not_found", { stationId: id });
  return id;
}
export function requireProductId(id: string): string {
  if (!isUuid(id)) throw new AppError("product.not_found", { productId: id });
  return id;
}
export function requireVenueCfg(deps: ManagementApiDeps): TradingContext {
  /* v8 ignore start -- boot always threads venueCfg; only a harness that omits it AND hits a department
     receipt settings GET route reaches this, which no suite does — a config error, surfaced as an opaque 500 by `run`. */
  if (deps.venueCfg === undefined) {
    throw new Error(
      "mountManagementApi: venueCfg is required for the department receipt settings GET route",
    );
  }
  /* v8 ignore stop */
  return deps.venueCfg;
}
/** Runs `fn` in one transaction after confirming the session holds `venue.configure`. */
export function withVenueAuth<T>(
  deps: ManagementApiDeps,
  sessionId: string,
  fn: (tx: Transaction, authorizedBy: string) => Promise<T>,
): Promise<T> {
  return withTransaction(deps.db, async (tx) => {
    const { authorizedBy } = await authorizeManager(tx, {
      managementSessionId: sessionId,
      permission: "venue.configure",
    });
    return fn(tx, authorizedBy);
  });
}
export function withVenueReadAuth<T>(
  deps: ManagementApiDeps,
  sessionId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withTransaction(deps.db, async (tx) => {
    await authorizeManager(tx, { managementSessionId: sessionId, permission: "venue.view" });
    return fn(tx);
  });
}
/**
 * An absent `displayOrder` stays `undefined`; a present one must be an integer number in int4 range,
 * never coerced, so an explicit `null` is refused rather than stored as 0. The range check is the
 * only bound: SQLite's INTEGER is 64-bit (`packages/db/src/schema/columns.ts`).
 */
export function parseDisplayOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!int4InRange(value))
    throw new AppError("management.request_invalid", { field: "displayOrder" });
  return value;
}

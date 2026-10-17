import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import type { BillEditExpected } from "../order-drafts.js";
import {
  payWorkingOrder as pay,
  collectOrderOrchestration as collect,
  recordTillSaleOrchestration as sale,
  payWorkingOrderIntegratedOrchestration as reader,
  collectOrder as deviceCollect,
  recordTillSale as deviceSale,
  payWorkingOrderIntegrated as deviceReader,
  type PayWorkingOrderRequest as PayRequest,
  type TillSaleRequest as SaleRequest,
  type IntegratedPayRequest as ReaderRequest,
} from "../till-sale.js";
export * from "../till-sale.js";

type ContentRequest<T> = Omit<T, "expectedEdit"> & { expectedEdit?: BillEditExpected | null };
export type PayWorkingOrderRequest = ContentRequest<PayRequest>;
export type TillSaleRequest = ContentRequest<SaleRequest>;
export type IntegratedPayRequest = ContentRequest<ReaderRequest>;
const observations = new WeakMap<Database, Map<string, BillEditExpected | null>>();
const OPERATOR = "cccccccc-0000-4000-8000-0000000000f1";

// Content fixtures retain the original observation without delaying the writer's queue admission.
function observed<T extends { expectedEdit?: BillEditExpected | null }>(
  db: Database,
  id: string | undefined,
  input: T,
  operatorId: string | undefined,
) {
  const [order] =
    id === undefined
      ? []
      : db.all<{
          partyId: string | null;
          editorId: string | null;
          editorVersion: number;
          draftId: string | null;
          draftRevision: number | null;
        }>(sql`select o.party_id as partyId, s.editor_id as editorId,
    coalesce(s.editor_version, 0) as editorVersion, d.id as draftId, d.revision as draftRevision
    from working_orders o left join bill_edit_states s on s.bill_id = o.id
    left join order_drafts d on d.bill_id = o.id and d.state = 'open'
    where o.id = ${id}`);
  let expectedEdit: BillEditExpected | null = null;
  if (order?.partyId != null) {
    let cache = observations.get(db);
    if (cache === undefined) {
      cache = new Map();
      observations.set(db, cache);
    }
    if (!cache.has(id!))
      cache.set(id!, {
        billId: id!,
        editorVersion: order.editorVersion,
        draftId: order.draftId,
        draftRevision: order.draftRevision,
      });
    expectedEdit = cache.get(id!)!;
    operatorId ??= order.editorId ?? OPERATOR;
  }
  return {
    operatorId,
    request: (Object.hasOwn(input, "expectedEdit") ? input : { ...input, expectedEdit }) as T & {
      expectedEdit: BillEditExpected | null;
    },
  };
}
export function observedWholePaymentBody(db: Database, path: string, body: unknown): unknown {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return body;
  const value = body as Record<string, unknown>;
  const match = /^\/api\/working-orders\/([^/]+)\/collect$/.exec(path);
  const id =
    path === "/api/sales" ? value.workingOrderId : path === "/api/pay" ? value.id : match?.[1];
  if (path !== "/api/sales" && path !== "/api/pay" && match === null) return body;
  return observed(db, typeof id === "string" ? id : undefined, body, undefined).request;
}

export function payWorkingOrder(
  deps: Parameters<typeof pay>[0],
  cfg: Parameters<typeof pay>[1],
  req: PayWorkingOrderRequest,
  operatorId?: string,
) {
  const captured = observed(deps.db, req.id, req, operatorId);
  return pay(deps, cfg, captured.request, captured.operatorId);
}
export function collectOrderOrchestration(
  deps: Parameters<typeof collect>[0],
  cfg: Parameters<typeof collect>[1],
  req: PayWorkingOrderRequest,
  operatorId?: string,
) {
  const captured = observed(deps.db, req.id, req, operatorId);
  return collect(deps, cfg, captured.request, captured.operatorId);
}
export function recordTillSaleOrchestration(
  deps: Parameters<typeof sale>[0],
  cfg: Parameters<typeof sale>[1],
  req: TillSaleRequest,
  operatorId?: string,
) {
  const captured = observed(deps.db, req.workingOrderId, req, operatorId);
  return sale(deps, cfg, captured.request, captured.operatorId);
}
export function payWorkingOrderIntegratedOrchestration(
  deps: Parameters<typeof reader>[0],
  cfg: Parameters<typeof reader>[1],
  req: IntegratedPayRequest,
  operatorId?: string,
) {
  const captured = observed(deps.db, req.id, req, operatorId);
  return reader(deps, cfg, captured.request, captured.operatorId);
}
export function collectOrder(
  deps: Parameters<typeof deviceCollect>[0],
  cfg: Parameters<typeof deviceCollect>[1],
  req: PayWorkingOrderRequest,
  operator: Parameters<typeof deviceCollect>[3],
) {
  const captured = observed(deps.db, req.id, req, operator.personId);
  return deviceCollect(deps, cfg, captured.request, operator);
}
export function recordTillSale(
  deps: Parameters<typeof deviceSale>[0],
  cfg: Parameters<typeof deviceSale>[1],
  req: TillSaleRequest,
  operator: Parameters<typeof deviceSale>[3],
) {
  const captured = observed(deps.db, req.workingOrderId, req, operator.personId);
  return deviceSale(deps, cfg, captured.request, operator);
}
export function payWorkingOrderIntegrated(
  deps: Parameters<typeof deviceReader>[0],
  cfg: Parameters<typeof deviceReader>[1],
  req: IntegratedPayRequest,
  operator: Parameters<typeof deviceReader>[3],
) {
  const captured = observed(deps.db, req.id, req, operator.personId);
  return deviceReader(deps, cfg, captured.request, operator);
}

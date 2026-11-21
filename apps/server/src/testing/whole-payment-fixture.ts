import { sql } from "drizzle-orm";
import type { Database } from "@waitron/db";
import type { BillEditExpected } from "../order-drafts.js";
import {
  payWorkingOrderIntegratedOrchestration as reader,
  payWorkingOrderIntegrated as deviceReader,
  type IntegratedPayRequest as ReaderRequest,
} from "../till-sale.js";
export * from "../till-sale.js";
export { readBillTenderLines } from "../receipt-payments.js";

type ContentRequest<T> = Omit<T, "expectedEdit"> & { expectedEdit?: BillEditExpected | null };
export type IntegratedPayRequest = ContentRequest<ReaderRequest>;
const observations = new WeakMap<Database, Map<string, BillEditExpected | null>>();

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
          openedBy: string;
          editorId: string | null;
          editorVersion: number;
          draftId: string | null;
          draftRevision: number | null;
        }>(sql`select p.opened_by as openedBy, o.editor_id as editorId,
    o.editor_version as editorVersion, d.id as draftId, d.revision as draftRevision
    from working_orders o
    join parties p on p.id = o.party_id
    left join order_drafts d on d.bill_id = o.id and d.state = 'open'
    where o.id = ${id}`);
  let expectedEdit: BillEditExpected | null = null;
  if (order !== undefined) {
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
    operatorId ??= order.editorId ?? order.openedBy;
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
  if (path !== "/api/pay") return body;
  return observed(db, typeof value.id === "string" ? value.id : undefined, body, undefined).request;
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
export function payWorkingOrderIntegrated(
  deps: Parameters<typeof deviceReader>[0],
  cfg: Parameters<typeof deviceReader>[1],
  req: IntegratedPayRequest,
  operator: Parameters<typeof deviceReader>[3],
) {
  const captured = observed(deps.db, req.id, req, operator.personId);
  return deviceReader(deps, cfg, captured.request, operator);
}

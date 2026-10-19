import { withTransaction, type Database } from "@waitron/db";
import { isUuid } from "@waitron/shared";
import { readBillEditState } from "../bill-editing.js";
import {
  previewBillPayment as preview,
  takeBillPayment as take,
  takeReaderBillPayment as reader,
  type BillPaymentAsk as Ask,
  type BillPaymentRequest as Request,
} from "../bill-payments.js";
import type { BillEditExpected } from "../order-drafts.js";
export * from "../bill-payments.js";
export type BillPaymentAsk = Omit<Ask, "expectedEdit"> & { expectedEdit?: BillEditExpected | null };
export type BillPaymentRequest = Omit<Request, "expectedEdit"> & {
  expectedEdit?: BillEditExpected | null;
};
const requests = new WeakMap<Database, Map<string, BillEditExpected>>();

// Content fixtures retain the first observed envelope for a payment's completed or unanswered retry.
async function observed<T extends BillPaymentAsk>(
  db: Database,
  billId: string,
  ask: T,
): Promise<T & Pick<Ask, "expectedEdit">> {
  if (Object.hasOwn(ask, "expectedEdit")) return ask as T & Pick<Ask, "expectedEdit">;
  const submissionId = (ask as T & { submissionId?: unknown }).submissionId;
  let cache = requests.get(db);
  if (cache === undefined) {
    cache = new Map();
    requests.set(db, cache);
  }
  const key = typeof submissionId === "string" ? `${billId}:${submissionId}` : undefined;
  let expectedEdit = key === undefined ? undefined : cache.get(key);
  if (expectedEdit === undefined) {
    expectedEdit = await withTransaction(db, (tx) => readBillEditState(tx, billId));
    if (key !== undefined) cache.set(key, expectedEdit);
  }
  return { ...ask, expectedEdit };
}
export async function observedPaymentBody(
  db: Database,
  path: string,
  body: unknown,
): Promise<unknown> {
  const match = /^\/api\/working-orders\/([^/]+)\/payments(?:\/preview)?$/.exec(path);
  if (
    match === null ||
    !isUuid(match[1]) ||
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body)
  )
    return body;
  return observed(db, match[1]!, body as BillPaymentAsk);
}
export async function previewBillPayment(
  deps: Parameters<typeof preview>[0],
  cfg: Parameters<typeof preview>[1],
  billId: string,
  ask: BillPaymentAsk,
  operatorId?: string,
) {
  const request = await observed(deps.db, billId, ask);
  const current = await withTransaction(deps.db, (tx) => readBillEditState(tx, billId));
  return preview(
    deps,
    cfg,
    billId,
    request,
    operatorId ?? current.editorId ?? "cccccccc-0000-4000-8000-0000000000f1",
  );
}
export async function takeBillPayment(
  deps: Parameters<typeof take>[0],
  cfg: Parameters<typeof take>[1],
  billId: string,
  request: BillPaymentRequest,
  operator: Parameters<typeof take>[4],
) {
  return take(deps, cfg, billId, await observed(deps.db, billId, request), operator);
}
export async function takeReaderBillPayment(
  deps: Parameters<typeof reader>[0],
  cfg: Parameters<typeof reader>[1],
  billId: string,
  request: BillPaymentRequest,
  operator: Parameters<typeof reader>[4],
) {
  return reader(deps, cfg, billId, await observed(deps.db, billId, request), operator);
}

export function observedPaymentSender(
  database: () => Database,
  sender: typeof import("./bill-venue.js").send,
) {
  return async (...[app, cookie, method, path, body]: Parameters<typeof sender>) =>
    sender(app, cookie, method, path, await observedPaymentBody(database(), path, body));
}

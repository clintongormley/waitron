import { randomUUID } from "node:crypto";
import {
  billPayments,
  persons,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { isUuid } from "@waitron/shared";
import { readBillEditState } from "../bill-editing.js";
import {
  getBillBalance,
  previewBillPayment as preview,
  takeBillPayment as take,
  takeReaderBillPayment as reader,
  type BillPaymentAsk as Ask,
  type BillPaymentRequest as Request,
  type CounterPaymentBasket,
  type BillPaymentDeps,
} from "../bill-payments.js";
import type { BillEditExpected } from "../order-drafts.js";
import type { DeviceRequestConfig } from "../trading-context.js";
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

export async function payFreshCounterInCash(
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  operator: Parameters<typeof take>[4],
  id: string,
  basket: CounterPaymentBasket,
  tendered: string,
) {
  return payCounterBasket(
    deps,
    cfg,
    operator,
    id,
    basket,
    { method: "cash", tendered },
    randomUUID(),
  );
}

export async function payCounterBasket(
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  operator: Parameters<typeof take>[4],
  id: string,
  basket: CounterPaymentBasket,
  payment: Pick<Request, "method" | "entry" | "externalRef" | "tendered" | "addedTip">,
  submissionId: string,
) {
  const result = await take(
    deps,
    cfg,
    id,
    {
      expectedEdit: null,
      submissionId,
      kind: "share",
      shareOf: 1,
      applied: "0.00",
      tip: "0.00",
      ...payment,
    },
    operator,
    basket,
  );
  if (result.invoice === undefined) throw new Error(`pay: bill ${id} has no invoice`);
  return result.invoice;
}

export function billShare(
  method: "cash" | "card",
  applied: string,
  fields: Partial<BillPaymentRequest> = {},
): BillPaymentRequest {
  return {
    submissionId: randomUUID(),
    kind: "share",
    shareOf: 1,
    applied,
    tip: "0.00",
    ...(method === "cash" ? { method, tendered: applied } : { method, entry: "manual" }),
    ...fields,
  };
}

export async function paySavedBillInCash(
  deps: BillPaymentDeps,
  cfg: DeviceRequestConfig,
  operator: Parameters<typeof take>[4],
  id: string,
  tendered: string,
  guestCount?: number | null,
) {
  const { outstanding } = await getBillBalance(deps, id);
  const result = await takeBillPayment(
    deps,
    cfg,
    id,
    {
      submissionId: randomUUID(),
      kind: "share",
      shareOf: 1,
      method: "cash",
      tendered,
      applied: outstanding,
      tip: "0.00",
      ...(guestCount === undefined ? {} : { guestCount }),
    },
    operator,
  );
  if (result.invoice == null) throw new Error(`pay: bill ${id} has no invoice`);
  return result.invoice;
}

export async function seedPendingCardPayment(db: Database | Transaction, billId: string) {
  const [person] = await db.select({ id: persons.id }).from(persons).orderBy(persons.id).limit(1);
  const payer = person ?? (await seedPersons(db, { displayName: "Card payment tester" }))[0]!;
  const [payment] = await db
    .insert(billPayments)
    .values({
      workingOrderId: billId,
      submissionId: randomUUID(),
      fingerprint: "pending card fixture",
      kind: "contribution",
      method: "card",
      applied: 1,
      state: "pending",
      requestedBy: payer.id,
      source: "operator_script",
    })
    .returning({ id: billPayments.id });
  return payment!.id;
}

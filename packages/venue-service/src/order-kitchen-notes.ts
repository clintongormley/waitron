import { and, eq, inArray, or } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { KitchenNote, KitchenNoteScope } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { orderKitchenNotes } from "./schema/order-kitchen-notes.js";
import "./errors.js";

export function normaliseKitchenNote(value: unknown): string | null {
  if (value !== null && typeof value !== "string")
    throw new AppError("kitchen_note.invalid", { field: "note" });
  // eslint-disable-next-line no-control-regex -- saved instructions must not carry printer controls
  const note = value?.replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").trim() || null;
  if (note !== null && note.length > 2000)
    throw new AppError("kitchen_note.too_long", { length: note.length, limit: 2000 });
  return note;
}

export function kitchenNoteKey(scope: KitchenNoteScope): string {
  if (scope === null || typeof scope !== "object")
    throw new AppError("kitchen_note.invalid", { field: "scope" });
  const orderId = "workingOrderId" in scope ? scope.workingOrderId : undefined;
  const partyId = "partyId" in scope ? scope.partyId : undefined;
  if (
    (orderId === undefined) === (partyId === undefined) ||
    (orderId !== undefined && (typeof orderId !== "string" || orderId === "")) ||
    (partyId !== undefined && (typeof partyId !== "string" || partyId === ""))
  )
    throw new AppError("kitchen_note.invalid", { field: "scope" });
  return orderId === undefined ? `party:${partyId!}` : `order:${orderId}`;
}

export async function readKitchenNotes(
  tx: Transaction,
  scopes: readonly KitchenNoteScope[],
): Promise<ReadonlyMap<string, KitchenNote>> {
  const result = new Map(
    scopes.map((scope) => [kitchenNoteKey(scope), { note: null, revision: 0 } as KitchenNote]),
  );
  if (result.size === 0) return result;
  const orders = scopes.flatMap((scope) =>
    "workingOrderId" in scope ? [scope.workingOrderId] : [],
  );
  const parties = scopes.flatMap((scope) => ("partyId" in scope ? [scope.partyId] : []));
  const rows = await tx
    .select()
    .from(orderKitchenNotes)
    .where(
      or(
        orders.length === 0 ? undefined : inArray(orderKitchenNotes.workingOrderId, orders),
        parties.length === 0 ? undefined : inArray(orderKitchenNotes.partyId, parties),
      ),
    );
  for (const row of rows) {
    const key =
      row.workingOrderId === null ? `party:${row.partyId!}` : `order:${row.workingOrderId}`;
    result.set(key, { note: row.note, revision: row.revision });
  }
  return result;
}

export async function writeKitchenNote(
  tx: Transaction,
  scope: KitchenNoteScope,
  expectedRevision: number,
  value: string | null,
): Promise<KitchenNote> {
  kitchenNoteKey(scope);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw new AppError("kitchen_note.invalid", { field: "revision" });
  const note = normaliseKitchenNote(value);
  const owner =
    "workingOrderId" in scope
      ? eq(orderKitchenNotes.workingOrderId, scope.workingOrderId)
      : eq(orderKitchenNotes.partyId, scope.partyId);
  const [row] = await tx.select().from(orderKitchenNotes).where(owner);
  const current =
    row === undefined ? { note: null, revision: 0 } : { note: row.note, revision: row.revision };
  if (expectedRevision !== current.revision)
    throw new AppError("kitchen_note.out_of_date", { revision: current.revision });
  if (note === current.note) return current;
  const revision = current.revision + 1;
  if (row === undefined) await tx.insert(orderKitchenNotes).values({ ...scope, note, revision });
  else
    await tx
      .update(orderKitchenNotes)
      .set({ note, revision })
      .where(and(owner, eq(orderKitchenNotes.revision, expectedRevision)));
  return { note, revision };
}

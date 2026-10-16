import { and, eq, inArray } from "drizzle-orm";
import {
  diningTables,
  parties,
  partySurvivors,
  partyTables,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import type { KitchenNoteScope, KitchenNoteSnapshot } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import { enqueueOrderKitchenNoteChange } from "./kitchen-print.js";
import { checkAndBumpParty, partyFamily, runServiceCommand } from "./parties.js";
import type { TillConfig } from "./till-config.js";
import { ordersWithUnfiledPayment, paymentAttemptIsLive } from "./till-sale.js";
import type { Database } from "@waitron/db";
import "./errors.js";

export async function inheritKitchenNote(
  tx: Transaction,
  cfg: TillConfig,
  from: KitchenNoteScope,
  into: KitchenNoteScope,
  mode: "copy" | "combine",
  arrivingOrderIds?: readonly string[],
): Promise<void> {
  const fromKey = VENUE_SERVICE.kitchenNoteKey(from);
  const intoKey = VENUE_SERVICE.kitchenNoteKey(into);
  const notes = await VENUE_SERVICE.readKitchenNotes(tx, [from, into]);
  const source = notes.get(fromKey)!;
  const target = notes.get(intoKey)!;
  const note =
    mode === "copy"
      ? source.note
      : [...new Set([target.note, source.note].filter((text) => text !== null))].join("; ") || null;
  await VENUE_SERVICE.writeKitchenNote(tx, into, target.revision, note);
  if (mode === "combine") {
    if (target.note !== note)
      await enqueueOrderKitchenNoteChange(tx, cfg, await kitchenNoteOrders(tx, into), {
        before: target.note,
        after: note,
      });
    if (source.note !== note)
      await enqueueOrderKitchenNoteChange(
        tx,
        cfg,
        arrivingOrderIds ?? (await kitchenNoteOrders(tx, from)),
        { before: source.note, after: note },
      );
  }
}

async function kitchenNoteOrders(tx: Transaction, scope: KitchenNoteScope): Promise<string[]> {
  if ("workingOrderId" in scope) return [scope.workingOrderId];
  const family = await partyFamily(tx, scope.partyId);
  return (
    await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(inArray(workingOrders.partyId, family))
  ).map((order) => order.id);
}

export async function readOrderKitchenNotes(
  tx: Transaction,
  orderIds: readonly string[],
): Promise<ReadonlyMap<string, KitchenNoteSnapshot>> {
  if (orderIds.length === 0) return new Map();
  const orders = await tx
    .select({
      id: workingOrders.id,
      partyId: workingOrders.partyId,
      revision: workingOrders.revision,
    })
    .from(workingOrders)
    .where(inArray(workingOrders.id, [...orderIds]));
  const partyIds = [...new Set(orders.flatMap((o) => (o.partyId === null ? [] : [o.partyId])))];
  const survivors = await partySurvivors(tx, partyIds);
  const partyRows =
    partyIds.length === 0
      ? []
      : await tx
          .select({ id: parties.id, revision: parties.revision })
          .from(parties)
          .where(inArray(parties.id, [...new Set(survivors.values())]));
  const partyRevisions = new Map(partyRows.map((p) => [p.id, p.revision]));
  const scopes = new Map<string, KitchenNoteScope>(
    orders.map(
      (o) =>
        [
          o.id,
          o.partyId === null ? { workingOrderId: o.id } : { partyId: survivors.get(o.partyId)! },
        ] as const,
    ),
  );
  const notes = await VENUE_SERVICE.readKitchenNotes(tx, [...scopes.values()]);
  return new Map(
    orders.map((o) => {
      const scope = scopes.get(o.id)!;
      return [
        o.id,
        {
          ...notes.get(VENUE_SERVICE.kitchenNoteKey(scope))!,
          scope,
          ownerRevision: "partyId" in scope ? partyRevisions.get(scope.partyId)! : o.revision,
        },
      ];
    }),
  );
}

export async function readPartyKitchenNote(
  tx: Transaction,
  cfg: TillConfig,
  partyId: string,
): Promise<KitchenNoteSnapshot> {
  const [party] = await tx.select().from(parties).where(eq(parties.id, partyId));
  if (party === undefined) throw new AppError("party.not_found", { partyId });
  const [table] = await tx
    .select({ id: diningTables.id })
    .from(partyTables)
    .innerJoin(diningTables, eq(diningTables.id, partyTables.tableId))
    .where(and(eq(partyTables.partyId, partyId), eq(diningTables.locationId, cfg.locationId)))
    .limit(1);
  if (table === undefined) {
    const [bill] = await tx
      .select({ id: workingOrders.id })
      .from(workingOrders)
      .where(and(eq(workingOrders.partyId, partyId), eq(workingOrders.locationId, cfg.locationId)))
      .limit(1);
    if (bill === undefined) throw new AppError("party.not_found", { partyId });
  }
  const scope = { partyId };
  const notes = await VENUE_SERVICE.readKitchenNotes(tx, [scope]);
  return {
    ...notes.get(VENUE_SERVICE.kitchenNoteKey(scope))!,
    scope,
    ownerRevision: party.revision,
  };
}

export async function requireKitchenNoteOrder(tx: Transaction, cfg: TillConfig, id: string) {
  const [order] = await tx
    .select()
    .from(workingOrders)
    .where(and(eq(workingOrders.id, id), eq(workingOrders.locationId, cfg.locationId)));
  if (order === undefined) throw new AppError("working_order.not_found", { workingOrderId: id });
  return order;
}

export interface KitchenNoteCommand {
  submissionId: string;
  expectedNoteRevision: number;
  expectedOwnerRevision: number;
  note: string | null;
  operatorId: string;
  deviceId: string;
}

export async function setOrderKitchenNote(
  tx: Transaction,
  db: Database,
  cfg: TillConfig,
  scope: KitchenNoteScope,
  args: KitchenNoteCommand,
): Promise<KitchenNoteSnapshot> {
  const commandScope =
    "partyId" in scope
      ? { kind: "party" as const, partyId: scope.partyId }
      : { kind: "bill" as const, workingOrderId: scope.workingOrderId };
  return runServiceCommand(
    tx,
    commandScope,
    args.submissionId,
    "kitchen_note.set",
    { ...args, scope },
    async () => {
      let current: KitchenNoteSnapshot;
      let orderIds: string[];
      if ("partyId" in scope) {
        current = await readPartyKitchenNote(tx, cfg, scope.partyId);
        const [party] = await tx
          .select({ state: parties.state })
          .from(parties)
          .where(eq(parties.id, scope.partyId));
        if (party!.state !== "open")
          throw new AppError("party.not_open", { partyId: scope.partyId });
        if (current.ownerRevision !== args.expectedOwnerRevision)
          throw new AppError("party.out_of_date", {
            partyId: scope.partyId,
            revision: current.ownerRevision,
          });
        orderIds = await kitchenNoteOrders(tx, scope);
      } else {
        const order = await requireKitchenNoteOrder(tx, cfg, scope.workingOrderId);
        if (order.partyId !== null || order.revision !== args.expectedOwnerRevision)
          throw new AppError("working_order.out_of_date", {
            workingOrderId: order.id,
            revision: order.revision,
          });
        if (order.status === "abandoned" || order.collectedAt !== null)
          throw new AppError("working_order.not_open", { workingOrderId: order.id });
        current = (await readOrderKitchenNotes(tx, [order.id])).get(order.id)!;
        orderIds = [order.id];
      }
      const pending =
        orderIds.find((id) => paymentAttemptIsLive(db, id)) ??
        (orderIds.length === 0
          ? undefined
          : [...(await ordersWithUnfiledPayment(tx, orderIds))][0]);
      const marked =
        orderIds.length === 0
          ? []
          : await tx
              .select({ id: workingOrders.id, at: workingOrders.paymentAttemptAt })
              .from(workingOrders)
              .where(inArray(workingOrders.id, orderIds));
      const busy = pending ?? marked.find((o) => o.at !== null)?.id;
      if (busy !== undefined)
        throw new AppError("order.payment_in_flight", { workingOrderId: busy });
      const next = await VENUE_SERVICE.writeKitchenNote(
        tx,
        scope,
        args.expectedNoteRevision,
        args.note,
      );
      const ownerRevision =
        "partyId" in scope && next.revision !== current.revision
          ? await checkAndBumpParty(tx, scope.partyId, args.expectedOwnerRevision, "open")
          : current.ownerRevision;
      if (next.revision !== current.revision)
        await enqueueOrderKitchenNoteChange(tx, cfg, orderIds, {
          before: current.note,
          after: next.note,
        });
      return { ...next, scope, ownerRevision };
    },
  );
}

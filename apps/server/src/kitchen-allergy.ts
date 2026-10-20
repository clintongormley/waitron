import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import {
  ticketItems,
  orderGroups,
  parties,
  workingOrderLines,
  workingOrders,
  type AllergenMap,
  type Transaction,
} from "@waitron/db";
import type {
  AllergyChangeSet,
  KitchenAllergyBlock,
  PartyAllergyGuest,
  TicketAllergyCopy,
} from "@waitron/module";
import type { TillConfig } from "./till-config.js";
import { VENUE_SERVICE } from "./modules.js";
import { readLineNutrition } from "./line-nutrition.js";
import { readLineCancellations, serviceQuantities } from "./line-service-state.js";
import { survivingParty } from "./party-allergy.js";
import { fingerprint, partyFamily } from "./parties.js";
import { isRecalledDish } from "./draft-source.js";
import { enqueueAllergyCorrectionSlips, type CorrectionItem } from "./kitchen-print.js";
import { thousandthsToDecimal } from "@waitron/shared";
import { kitchenAllergenLabel } from "./i18n/kitchen-allergy.js";

function canonicalAllergens(maps: readonly (AllergenMap | null | undefined)[]): AllergenMap {
  const byCode = new Map<string, Set<NonNullable<AllergenMap[string]["kinds"]>[number]>>();
  for (const map of maps) {
    for (const [code, entry] of Object.entries(map ?? {})) {
      const kinds = byCode.get(code) ?? new Set();
      for (const kind of entry.kinds ?? []) kinds.add(kind);
      byCode.set(code, kinds);
    }
  }
  return Object.fromEntries(
    [...byCode]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, kinds]) => [code, kinds.size === 0 ? {} : { kinds: [...kinds].sort() }]),
  );
}

export async function resolveKitchenAllergyBlocks(
  tx: Transaction,
  cfg: TillConfig,
  ticketItemIds: readonly string[],
): Promise<ReadonlyMap<string, KitchenAllergyBlock | null>> {
  if (ticketItemIds.length === 0) return new Map();
  const tickets = await tx
    .select({
      id: ticketItems.id,
      parentId: workingOrderLines.parentLineId,
      lineId: workingOrderLines.id,
      partyId: workingOrders.partyId,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(
      and(
        inArray(ticketItems.id, [...ticketItemIds]),
        eq(workingOrders.locationId, cfg.locationId),
        isNotNull(workingOrders.partyId),
        eq(ticketItems.madeHere, false),
      ),
    );
  if (tickets.length === 0) return new Map();
  const parents = [...new Set(tickets.map((ticket) => ticket.parentId ?? ticket.lineId))];
  const lines = await tx
    .select({
      id: workingOrderLines.id,
      parentId: workingOrderLines.parentLineId,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .where(
      or(inArray(workingOrderLines.id, parents), inArray(workingOrderLines.parentLineId, parents)),
    );
  const nutrition = await readLineNutrition(
    tx,
    lines.map((line) => line.id),
  );
  const cancelled = await readLineCancellations(
    tx,
    lines.map((line) => line.id),
  );
  const byParent = new Map<string, (AllergenMap | null | undefined)[]>();
  for (const line of lines) {
    if (line.quantity <= (cancelled.get(line.id) ?? 0)) continue;
    const parentId = line.parentId ?? line.id;
    const entries = byParent.get(parentId) ?? [];
    entries.push(nutrition.get(line.id)?.allergens);
    byParent.set(parentId, entries);
  }
  const guestsByLine = new Map<string, PartyAllergyGuest>();
  const survivors = new Map<string, string>();
  for (const partyId of new Set(tickets.map((ticket) => ticket.partyId!)))
    survivors.set(partyId, await survivingParty(tx, partyId));
  for (const partyId of new Set(survivors.values())) {
    const snapshot = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
    const guests = new Map(snapshot.guests.map((guest) => [guest.id, guest]));
    for (const tick of snapshot.ticks) {
      const guest = guests.get(tick.guestId);
      if (tick.workingLineId !== null && guest !== undefined)
        guestsByLine.set(tick.workingLineId, guest);
    }
  }
  const blocks = new Map<string, KitchenAllergyBlock | null>();
  for (const ticket of tickets) {
    const parentId = ticket.parentId ?? ticket.lineId;
    const guest = guestsByLine.get(parentId);
    if (guest === undefined) {
      blocks.set(ticket.id, null);
      continue;
    }
    const allergens = canonicalAllergens([guest.allergens]);
    const served = canonicalAllergens(byParent.get(parentId) ?? []);
    const clashes = Object.fromEntries(
      Object.entries(served).filter(([code]) => Object.hasOwn(allergens, code)),
    );
    const labels = (language: "en" | "es") => ({
      avoids: Object.entries(allergens).map(([code, entry]) =>
        kitchenAllergenLabel(code, entry, language),
      ),
      clashes: Object.entries(clashes).map(([code, entry]) =>
        kitchenAllergenLabel(code, entry, language),
      ),
    });
    blocks.set(ticket.id, {
      who: guest.who,
      allergens,
      note: guest.note,
      clashes,
      labels: { en: labels("en"), es: labels("es") },
    });
  }
  return blocks;
}

export async function freezeKitchenAllergies(
  tx: Transaction,
  cfg: TillConfig,
  ticketItemIds: readonly string[],
): Promise<void> {
  if (ticketItemIds.length === 0) return;
  const frozen = await VENUE_SERVICE.readTicketAllergies(tx, ticketItemIds);
  const missing = ticketItemIds.filter((id) => !frozen.has(id));
  const blocks = await resolveKitchenAllergyBlocks(tx, cfg, missing);
  await VENUE_SERVICE.recordTicketAllergies(
    tx,
    [...blocks].map(([ticketItemId, block]) => ({
      ticketItemId,
      originalBlock: block,
      currentBlock: block,
    })),
  );
}

export async function attachKitchenAllergyCopies(
  tx: Transaction,
  tickets: readonly { id: string; workingOrderLineId: string }[],
  copies: ReadonlyMap<string, TicketAllergyCopy> | undefined,
): Promise<void> {
  if (copies === undefined || copies.size === 0) return;
  // Attach before first-exposure capture: a replacement keeps even an explicit frozen null.
  await VENUE_SERVICE.recordTicketAllergies(
    tx,
    tickets.flatMap((ticket) => {
      const copy = copies.get(ticket.workingOrderLineId);
      return copy === undefined ? [] : [{ ticketItemId: ticket.id, ...copy }];
    }),
  );
}

export async function freezeKitchenAllergyItems(
  tx: Transaction,
  cfg: TillConfig,
  orderId: string,
  items: readonly { workingOrderLineId: string; stationId: string }[],
): Promise<void> {
  if (items.length === 0) return;
  const tickets = await tx
    .select({
      id: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
    })
    .from(ticketItems)
    .where(
      and(
        eq(ticketItems.workingOrderId, orderId),
        inArray(
          ticketItems.workingOrderLineId,
          items.map((item) => item.workingOrderLineId),
        ),
      ),
    );
  const selected = new Map(items.map((item) => [item.workingOrderLineId, item.stationId]));
  await freezeKitchenAllergies(
    tx,
    cfg,
    tickets
      .filter((ticket) => selected.get(ticket.lineId) === ticket.stationId)
      .map((ticket) => ticket.id),
  );
}

export async function enqueueKitchenAllergyChanges(
  tx: Transaction,
  cfg: TillConfig,
  changes: AllergyChangeSet,
): Promise<void> {
  if (changes.workingLineIds.length === 0) return;
  const family = await partyFamily(tx, changes.partyId);
  const rows = await tx
    .select({
      id: ticketItems.id,
      lineId: workingOrderLines.id,
      orderId: ticketItems.workingOrderId,
      stationId: ticketItems.stationId,
      firedAt: ticketItems.firedAt,
      madeHere: ticketItems.madeHere,
      state: ticketItems.state,
      quantity: workingOrderLines.quantity,
      firedQuantity: ticketItems.quantity,
      served: workingOrderLines.servedQuantity,
      orderStatus: workingOrders.status,
      collectedAt: workingOrders.collectedAt,
      partyState: parties.state,
      group: orderGroups.displayNumber,
      groupState: orderGroups.state,
      holdPrintedAt: orderGroups.holdPrintedAt,
      recalled: isRecalledDish(tx),
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
    .innerJoin(parties, eq(parties.id, changes.partyId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(
      and(
        eq(workingOrders.locationId, cfg.locationId),
        inArray(workingOrders.partyId, family),
        or(
          inArray(workingOrderLines.id, changes.workingLineIds),
          inArray(workingOrderLines.parentLineId, changes.workingLineIds),
        ),
      ),
    );
  const frozen = await VENUE_SERVICE.readTicketAllergies(
    tx,
    rows.map((row) => row.id),
  );
  const selected = rows.filter((row) => frozen.has(row.id));
  const after = await resolveKitchenAllergyBlocks(
    tx,
    cfg,
    selected.map((row) => row.id),
  );
  const cancelled = await readLineCancellations(
    tx,
    selected.map((row) => row.lineId),
  );
  const byOrder = new Map<
    string,
    (CorrectionItem & { allergyBlock: KitchenAllergyBlock | null })[]
  >();
  for (const row of selected) {
    const block = after.get(row.id) ?? null;
    if (fingerprint({ block: frozen.get(row.id)!.currentBlock }) === fingerprint({ block }))
      continue;
    await VENUE_SERVICE.setTicketAllergyCurrent(tx, row.id, block);
    const remaining = Math.min(
      row.firedQuantity ?? row.quantity,
      serviceQuantities(row.quantity, row.served, cancelled.get(row.lineId) ?? 0).remaining,
    );
    // Copy presence identifies the exact HOLD recipient; the group's stamp alone does not.
    const exposed =
      row.firedAt !== null || (row.groupState === "held" && row.holdPrintedAt !== null);
    if (
      remaining <= 0 ||
      !exposed ||
      row.recalled ||
      row.madeHere ||
      row.collectedAt !== null ||
      row.orderStatus === "abandoned" ||
      row.partyState !== "open"
    )
      continue;
    const items = byOrder.get(row.orderId) ?? [];
    items.push({
      workingOrderLineId: row.lineId,
      stationId: row.stationId,
      quantity: remaining,
      wasStarted: row.state !== "queued",
      allergyBlock: block,
      ...(row.firedAt === null && row.group !== null ? { group: row.group } : {}),
    });
    byOrder.set(row.orderId, items);
  }
  for (const [orderId, items] of byOrder) {
    for (const item of items)
      await VENUE_SERVICE.recordKitchenNotices(
        tx,
        cfg,
        orderId,
        [
          {
            workingOrderLineId: item.workingOrderLineId,
            stationId: item.stationId,
            quantity: thousandthsToDecimal(item.quantity),
            wasStarted: item.wasStarted,
          },
        ],
        item.allergyBlock === null ? "allergy_removed" : "allergy_changed",
        { allergyBlock: item.allergyBlock },
      );
    await enqueueAllergyCorrectionSlips(tx, cfg, orderId, items);
  }
}

export async function copyAllergyWorkingTick(
  tx: Transaction,
  fromLineId: string,
  toLineId: string,
): Promise<void> {
  const [line] = await tx
    .select({ partyId: workingOrders.partyId })
    .from(workingOrderLines)
    .innerJoin(workingOrders, eq(workingOrders.id, workingOrderLines.workingOrderId))
    .where(eq(workingOrderLines.id, fromLineId));
  if (line?.partyId == null) return;
  const partyId = await survivingParty(tx, line.partyId);
  const snapshot = await VENUE_SERVICE.readPartyAllergy(tx, partyId);
  const tick = snapshot.ticks.find((item) => item.workingLineId === fromLineId);
  if (tick !== undefined)
    await VENUE_SERVICE.setAllergyLineTicks(tx, partyId, [
      { workingLineId: toLineId, guestId: tick.guestId },
    ]);
}

export async function notifyKitchenAllergyDestination(
  tx: Transaction,
  cfg: TillConfig,
  ticketItemIds: readonly string[],
): Promise<void> {
  if (ticketItemIds.length === 0) return;
  const rows = await tx
    .select({
      id: ticketItems.id,
      lineId: workingOrderLines.id,
      orderId: ticketItems.workingOrderId,
      stationId: ticketItems.stationId,
      quantity: workingOrderLines.quantity,
      firedQuantity: ticketItems.quantity,
      served: workingOrderLines.servedQuantity,
      state: ticketItems.state,
      madeHere: ticketItems.madeHere,
      status: workingOrders.status,
      collectedAt: workingOrders.collectedAt,
      group: orderGroups.displayNumber,
      firedAt: ticketItems.firedAt,
    })
    .from(ticketItems)
    .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
    .innerJoin(workingOrders, eq(workingOrders.id, ticketItems.workingOrderId))
    .leftJoin(orderGroups, eq(orderGroups.id, workingOrderLines.groupId))
    .where(
      and(
        inArray(ticketItems.id, [...ticketItemIds]),
        eq(workingOrders.locationId, cfg.locationId),
      ),
    );
  const copies = await VENUE_SERVICE.readTicketAllergies(
    tx,
    rows.map((row) => row.id),
  );
  const cancelled = await readLineCancellations(
    tx,
    rows.map((row) => row.lineId),
  );
  const byOrder = new Map<
    string,
    (CorrectionItem & { allergyBlock: KitchenAllergyBlock | null })[]
  >();
  for (const row of rows) {
    const copy = copies.get(row.id);
    if (
      copy === undefined ||
      fingerprint({ block: copy.originalBlock }) === fingerprint({ block: copy.currentBlock })
    )
      continue;
    const quantity = Math.min(
      row.firedQuantity ?? row.quantity,
      serviceQuantities(row.quantity, row.served, cancelled.get(row.lineId) ?? 0).remaining,
    );
    if (quantity <= 0 || row.madeHere || row.status === "abandoned" || row.collectedAt !== null)
      continue;
    const item = {
      workingOrderLineId: row.lineId,
      stationId: row.stationId,
      quantity,
      wasStarted: row.state !== "queued",
      allergyBlock: copy.currentBlock,
      ...(row.firedAt === null && row.group !== null ? { group: row.group } : {}),
    };
    await VENUE_SERVICE.recordKitchenNotices(
      tx,
      cfg,
      row.orderId,
      [{ ...item, quantity: thousandthsToDecimal(quantity) }],
      copy.currentBlock === null ? "allergy_removed" : "allergy_changed",
      { allergyBlock: copy.currentBlock },
    );
    byOrder.set(row.orderId, [...(byOrder.get(row.orderId) ?? []), item]);
  }
  for (const [orderId, items] of byOrder)
    await enqueueAllergyCorrectionSlips(tx, cfg, orderId, items);
}

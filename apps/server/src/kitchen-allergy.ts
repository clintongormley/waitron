import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import {
  ticketItems,
  workingOrderLines,
  workingOrders,
  type AllergenMap,
  type Transaction,
} from "@waitron/db";
import type { KitchenAllergyBlock, PartyAllergyGuest } from "@waitron/module";
import type { TillConfig } from "./till-config.js";
import { VENUE_SERVICE } from "./modules.js";
import { readLineNutrition } from "./line-nutrition.js";
import { readLineCancellations } from "./line-service-state.js";
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
  for (const partyId of new Set(tickets.map((ticket) => ticket.partyId!))) {
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

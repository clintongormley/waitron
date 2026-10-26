import { BAND_RANK, classifyBand, stringToThousandths } from "@waitron/shared";
import type {
  QueueGroup,
  StationQueueGroup,
  StationQueueItem,
  TicketState,
} from "../api/client.js";

/** A merged queue's order: one station's lines of it, so `stationId` names whose. */
export type MergedQueueGroup = StationQueueGroup & { stationId?: string };

export interface KitchenCard {
  /** `${stationId ?? ""}|g:${groupId}`, or `${stationId ?? ""}|o:${orderId}` for dishes with no group: unique on one screen. */
  key: string;
  /** Its bills, in the read's order: one, or more when a group spans a party's bills (D1). */
  orders: MergedQueueGroup[];
  /** The group the dishes were sent in; null for a counter order, a bill with no party, or dishes moved in. */
  group: QueueGroup | null;
  /** In the read's order. */
  items: StationQueueItem[];
  /** Each dish's own bill, by item id: a dish carries no order id, and a card may span bills. */
  orderOf: ReadonlyMap<string, MergedQueueGroup>;
  /** Its least advanced dish's state, held dishes counting as `queued` (D2). */
  column: TicketState;
  /** The earliest `queuedAt` of its fired dishes, epoch ms; null when none is fired (D4). */
  since: number | null;
}

const STAGE_RANK: Record<TicketState, number> = { queued: 0, preparing: 1, ready: 2 };

const fired = (item: StationQueueItem) => item.firedAt !== null;

/** Held dishes count as `queued`; `ready` for no dishes. */
function leastAdvanced(items: readonly StationQueueItem[]): TicketState {
  let least: TicketState = "ready";
  for (const item of items) {
    const stage = fired(item) ? item.state : "queued";
    if (STAGE_RANK[stage] < STAGE_RANK[least]) least = stage;
  }
  return least;
}

interface Draft {
  card: KitchenCard;
  orderOf: Map<string, MergedQueueGroup>;
  readIndex: number;
}

/** One card per station and group across its bills, or per station and bill for dishes with no group; oldest first (D1, D2). */
export function kitchenCards(orders: readonly MergedQueueGroup[]): KitchenCard[] {
  const drafts = new Map<string, Draft>();
  orders.forEach((order, readIndex) => {
    for (const item of order.items) {
      const group = item.group ?? null;
      const key = `${order.stationId ?? ""}|${group === null ? `o:${order.orderId}` : `g:${group.id}`}`;
      let draft = drafts.get(key);
      if (draft === undefined) {
        const orderOf = new Map<string, MergedQueueGroup>();
        draft = {
          card: { key, orders: [], group, items: [], orderOf, column: "queued", since: null },
          orderOf,
          readIndex,
        };
        drafts.set(key, draft);
      }
      const { card } = draft;
      if (!card.orders.includes(order)) card.orders.push(order);
      card.items.push(item);
      draft.orderOf.set(item.id, order);
    }
  });

  const sorted = [...drafts.values()];
  for (const { card } of sorted) {
    card.column = leastAdvanced(card.items);
    const times = card.items.filter(fired).map((item) => Date.parse(item.queuedAt));
    card.since = times.length === 0 ? null : Math.min(...times);
  }
  const age = (draft: Draft) => draft.card.since ?? Number.POSITIVE_INFINITY;
  const position = (draft: Draft) => draft.card.group?.position ?? Number.NEGATIVE_INFINITY;
  // Two untimed cards give Infinity − Infinity, NaN, which `||` reads as a tie.
  sorted.sort((a, b) => age(a) - age(b) || a.readIndex - b.readIndex || position(a) - position(b));
  return sorted.map((draft) => draft.card);
}

/** The state a heading tap moves: its least advanced fired dish not Ready; undefined when none (D8). */
export function headingStage(card: KitchenCard): TicketState | undefined {
  const toMove = card.items.filter((item) => fired(item) && item.state !== "ready");
  return toMove.length === 0 ? undefined : leastAdvanced(toMove);
}

/** The ids a tap at `stage` moves: the card's fired dishes in that state (D8). */
export function dishesAt(card: KitchenCard, stage: TicketState): string[] {
  return card.items.filter((item) => fired(item) && item.state === stage).map((item) => item.id);
}

/** Fired dishes Waiting or Preparing, in thousandths of a dish; a dish whose unit shows counts 1000 (D9). */
export function thousandthsToMake(cards: readonly KitchenCard[]): number {
  let total = 0;
  for (const card of cards) {
    for (const item of card.items) {
      if (!fired(item) || item.state === "ready") continue;
      const unitShows = item.unitName != null && item.soldInEach !== true;
      total += unitShows ? 1000 : stringToThousandths(item.quantity);
    }
  }
  return total;
}

/** Cards with a fired dish not Ready whose band at `now` is overdue or forgotten (D9). */
export function lateCards(cards: readonly KitchenCard[], now: number): number {
  return cards.filter((card) => {
    const { since } = card;
    if (since === null || headingStage(card) === undefined) return false;
    // Every bill on one card is one station's, so any of them carries its thresholds.
    return card.orders.some(
      (order) => BAND_RANK[classifyBand(since, now, order.thresholds)] >= BAND_RANK.overdue,
    );
  }).length;
}

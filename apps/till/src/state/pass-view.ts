import { BAND_RANK, classifyBand, type TimingBand } from "@waitron/shared";
import { mergeLabel } from "@waitron/ui";
import type { PassBoard, PassCard, PassCardItem, TicketState } from "../api/client.js";
import { t } from "../i18n/t.js";
import type { ColumnKey } from "./kitchen-columns.js";
import { dishThousandths, type OverviewDish } from "./kitchen-overview.js";

export type PassMode = "pass" | "monitor" | "all_stations";
export type ItemCaption =
  | { kind: "none" }
  | { kind: "waitingForPass"; station: string }
  | { kind: "otherPass"; station: string }
  | { kind: "state"; state: TicketState; station: string }
  | { kind: "alreadyAt"; state: TicketState; station: string };
export interface ItemView {
  item: PassCardItem;
  caption: ItemCaption;
  dimmed: boolean;
  band: TimingBand | null;
  forgotten: boolean;
  closed: "blocked" | "extra" | null;
}
export interface CardView {
  card: PassCard;
  column: "held" | "toFire" | "inProgress" | "ready";
  kindWord: string | null;
  ageFrom: string | null;
  ageWord: "minutes" | "ready" | null;
  band: TimingBand | null;
  allergy: boolean;
  /** The dishes drawn; a dish Hide hid counts for `band` and `allergy`, undrawn. */
  items: ItemView[];
  fire: { shown: boolean; enabled: boolean };
  groupReady: boolean;
  billReady: boolean;
}

type PassColumn = CardView["column"];
const PASS_CARD_COLUMNS: readonly PassColumn[] = ["held", "toFire", "inProgress", "ready"];

const KIND_WORDS = {
  new_order: "pass.kind.new_order",
  next_course: "pass.kind.next_course",
  added: "pass.kind.added",
} as const;

/** A held dish is not cooking and keeps its insert time, so it has no band. */
export function passItemBand(item: PassCardItem, now: number): TimingBand | null {
  if (item.phase === "held") return null;
  const since = item.phase === "requested" ? (item.requestedAt ?? item.queuedAt) : item.queuedAt;
  return classifyBand(Date.parse(since), now, item.thresholds);
}

function captionOf(item: PassCardItem): ItemCaption {
  const station = item.stationName;
  if (item.phase === "held") return { kind: "none" };
  if (item.phase === "requested") {
    return item.informational
      ? { kind: "otherPass", station }
      : { kind: "waitingForPass", station };
  }
  return item.informational
    ? { kind: "alreadyAt", state: item.state, station }
    : { kind: "state", state: item.state, station };
}

function itemView(item: PassCardItem, now: number): ItemView {
  const band = passItemBand(item, now);
  return {
    item,
    caption: captionOf(item),
    dimmed: item.informational,
    band,
    forgotten: item.visible && band === "forgotten",
    closed: item.stationClosed ? (item.extra ? "extra" : "blocked") : null,
  };
}

/** Lateness counts every dish in view, dimmed or not. */
function cardBand(items: readonly ItemView[]): TimingBand | null {
  let worst: TimingBand | null = null;
  for (const { item, band } of items) {
    if (!item.visible || band === null) continue;
    if (worst === null || BAND_RANK[band] > BAND_RANK[worst]) worst = band;
  }
  return worst;
}

function cardView(
  card: PassCard,
  column: PassColumn,
  mode: PassMode,
  runsPass: boolean,
  now: number,
): CardView {
  const items = card.items.map((item) => itemView(item, now));
  const hidden = (card.hiddenItems ?? []).map((item) => itemView(item, now));
  const dishes = card.hiddenItems === undefined ? card.items : [...card.items, ...card.hiddenItems];
  const fireShown = column === "toFire" && mode === "pass" && runsPass;
  const levers = column === "inProgress" && mode !== "monitor" && runsPass;
  const age: Pick<CardView, "ageFrom" | "ageWord"> =
    column === "held"
      ? { ageFrom: null, ageWord: null }
      : column === "ready"
        ? { ageFrom: card.readyAt, ageWord: "ready" }
        : { ageFrom: card.requestedAt, ageWord: "minutes" };
  return {
    card,
    column,
    kindWord: card.kind === "held" ? null : t(KIND_WORDS[card.kind]),
    ...age,
    band: cardBand([...items, ...hidden]),
    allergy: dishes.some((item) => item.visible && item.allergy !== null),
    items,
    fire: { shown: fireShown, enabled: fireShown && card.releaseTicketItemIds.length > 0 },
    groupReady: levers && card.target.kind === "group",
    billReady: levers && card.target.kind === "bill",
  };
}

/** Where a card's bill is, as its heading and refusals name it: its tables by their short names,
 *  as the kitchen card names them, else its label. */
export function passOrderPlace(order: PassCard["orders"][number]): string | undefined {
  return order.tableShortNames === undefined ? order.tableLabel : mergeLabel(order.tableShortNames);
}

/** The server sorted each column; the view keeps its order. */
export function passCardViews(
  board: PassBoard,
  mode: PassMode,
  runsPass: boolean,
  now: number,
): Map<ColumnKey, CardView[]> {
  return new Map(
    PASS_CARD_COLUMNS.map((column) => [
      column,
      board[column].map((card) => cardView(card, column, mode, runsPass, now)),
    ]),
  );
}

export function passOverdueCount(views: Map<ColumnKey, CardView[]>): number {
  let count = 0;
  for (const cards of views.values()) {
    for (const { band } of cards)
      if (band !== null && BAND_RANK[band] >= BAND_RANK.overdue) count++;
  }
  return count;
}

/** The pass's own work: held and requested as held, waiting and preparing as making, ready left out. */
export function passOverviewDishes(board: PassBoard): OverviewDish[] {
  const dishes: OverviewDish[] = [];
  for (const fact of board.overview) {
    if (fact.informational || fact.phase === "ready") continue;
    dishes.push({
      name: fact.name,
      thousandths: dishThousandths(fact.qty, fact.unitName, fact.soldInEach),
      stage: fact.phase === "held" || fact.phase === "requested" ? "held" : "making",
    });
  }
  return dishes;
}

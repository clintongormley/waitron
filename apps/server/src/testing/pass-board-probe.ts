import type { PassScope } from "../pass-board.js";
import type { PassBoard, PassCard, PassCardItem } from "../pass-card.js";

export const EVERY: PassScope = { stationIds: null, zoneIds: null };

/** Every card on the board, column by column: Held, To fire, In progress, Ready. */
export function boardCards(board: PassBoard): PassCard[] {
  return [...board.held, ...board.toFire, ...board.inProgress, ...board.ready];
}

/** Every dish on every card; `inView` keeps only the dishes the board's scope sees. */
export function boardItems(board: PassBoard, { inView = false } = {}): PassCardItem[] {
  return boardCards(board)
    .flatMap((card) => card.items)
    .filter((item) => !inView || item.visible);
}

/** The ids of the orders the board's cards hold, sorted; `inView` keeps only the orders of the
 *  dishes the board's scope sees, since a card split across bills names every bill. */
export function boardOrderIds(board: PassBoard, { inView = false } = {}): string[] {
  const ids = inView
    ? boardItems(board, { inView }).map((item) => item.orderId)
    : boardCards(board).flatMap((card) => card.orders.map((o) => o.orderId));
  return [...new Set(ids)].sort();
}

/** The one card the predicate picks; throws when it picks none or several. */
export function cardOf(board: PassBoard, predicate: (card: PassCard) => boolean): PassCard {
  const found = boardCards(board).filter(predicate);
  if (found.length !== 1) throw new Error(`expected one matching card, found ${found.length}`);
  return found[0]!;
}

import { createHash } from "node:crypto";
import type { OrderGroupRequestKind } from "@waitron/db";
import { initiatedAt, kitchenPhase, type KitchenPhase } from "./kitchen-phase.js";
import { passSees, type PassScope } from "./pass-board.js";
import { canonicalJson } from "./parties.js";
import { byText } from "./text-order.js";
import type { ExpoItem } from "./working-order.js";

export type PassTarget =
  { kind: "group"; partyId: string; groupId: string } | { kind: "bill"; workingOrderId: string };

/** Null for a dish in no course. */
export type PassCourse = { id: string; name: string | null; displayOrder: number | null } | null;

/** One live kitchen item as the board and the release read it. */
export interface PassRow {
  item: ExpoItem;
  lineId: string;
  orderId: string;
  stationId: string;
  /** The order's watched zone. */
  zoneId: string | null;
  partyId: string | null;
  partyRevision: number | null;
  course: PassCourse;
  group: {
    id: string;
    partyId: string;
    partyRevision: number;
    state: "held" | "fired";
    requestKind: OrderGroupRequestKind;
    position: number;
    createdAt: string;
    displayNumber: number;
    numberPartyLabel?: string;
    /** The earliest `createdAt` of every group the party has stored, live or not (D64). */
    partyFirstCreatedAt: string;
  } | null;
  requestedAt: string | null;
  firedAt: string | null;
  readyAt: string | null;
  passControlled: boolean;
  /** Read for held rows: whether the station waits for the pass now. */
  stationWaitsNow: boolean;
  /** Requested, its station inactive or not open, and nothing kept it there. */
  stationClosed: boolean;
  /** A split-off extra: its line has a parent line. */
  extra: boolean;
  /** Thousandths: fired quantity less served quantity. */
  remaining: number;
  recalled: boolean;
  lineNo: number;
  order: {
    orderNumber: number;
    tableLabel?: string;
    kitchenNote: string | null;
    formerNumbers?: number[];
    openedAt: string;
  };
}

export interface PassCardItem extends ExpoItem {
  lineId: string;
  orderId: string;
  stationId: string;
  phase: KitchenPhase;
  requestedAt: string | null;
  readyAt: string | null;
  visible: boolean;
  informational: boolean;
  passControlled: boolean;
  course: PassCourse;
  stationClosed: boolean;
  extra: boolean;
}

export interface PassCard {
  key: string;
  target: PassTarget;
  kind: "held" | "new_order" | "next_course" | "added";
  /** Earliest initiation of its items; null on a held card. */
  requestedAt: string | null;
  /** The last part's ready time, on a ready card. */
  readyAt: string | null;
  allReady: boolean;
  party?: { id: string; revision: number };
  orders: {
    orderId: string;
    orderNumber: number;
    tableLabel?: string;
    kitchenNote: string | null;
    formerNumbers?: number[];
  }[];
  group?: { displayNumber: number; numberPartyLabel?: string; position: number };
  items: PassCardItem[];
  /** The dimmed dishes the pass's display choice hides: not drawn, but still counted for the
   *  card's lateness, its allergy marker and its course Ready levers (D83). Absent when none are
   *  hidden. */
  hiddenItems?: PassCardItem[];
  releaseTicketItemIds: string[];
  releaseContext: string | null;
}

export type OverviewFact = Pick<
  PassCardItem,
  "lineId" | "stationId" | "name" | "qty" | "phase" | "informational" | "unitName" | "soldInEach"
>;

export interface PassBoard {
  held: PassCard[];
  toFire: PassCard[];
  inProgress: PassCard[];
  ready: PassCard[];
  overview: OverviewFact[];
}

export function passCardKey(row: PassRow): string {
  return row.group === null ? `bill:${row.orderId}` : `group:${row.group.id}`;
}

const phaseOf = (row: PassRow): KitchenPhase =>
  kitchenPhase({ requestedAt: row.requestedAt, firedAt: row.firedAt, state: row.item.state });

/** A live Requested dish this pass sees and that is pass work: what puts a card in To fire. */
function isCandidate(row: PassRow, scope: PassScope): boolean {
  return (
    !row.recalled &&
    row.remaining > 0 &&
    row.passControlled &&
    passSees(scope, row) &&
    phaseOf(row) === "requested"
  );
}

/**
 * This pass's candidates of one card, the visible Requested items its Fire releases, and the
 * digest of their facts (D47). Nothing while a dish candidate sits at a closed station that
 * nothing kept it at (D51); a split-off extra there stays a candidate, since nothing can move it.
 */
export function passCardRelease(
  target: PassTarget,
  cardRows: readonly PassRow[],
  scope: PassScope,
): { ticketItemIds: string[]; context: string | null } {
  const candidates = cardRows
    .filter((row) => isCandidate(row, scope))
    .sort((a, b) => byText(a.item.id, b.item.id));
  if (candidates.length === 0 || candidates.some((row) => row.stationClosed && !row.extra)) {
    return { ticketItemIds: [], context: null };
  }
  const facts = candidates.map((row) => ({
    id: row.item.id,
    lineId: row.lineId,
    orderId: row.orderId,
    groupId: row.group?.id ?? null,
    stationId: row.stationId,
    zoneId: row.zoneId,
    requestedAt: row.requestedAt,
    firedAt: row.firedAt,
    passControlled: row.passControlled,
    remaining: row.remaining,
    recalled: row.recalled,
  }));
  return {
    ticketItemIds: candidates.map((row) => row.item.id),
    context: createHash("sha256")
      .update(canonicalJson({ target, candidates: facts }))
      .digest("hex"),
  };
}

type Column = "held" | "toFire" | "inProgress" | "ready";

function isPassWork(row: PassRow): boolean {
  return phaseOf(row) === "held" ? row.stationWaitsNow : row.passControlled;
}

function cardItem(row: PassRow, scope: PassScope, dims: boolean): PassCardItem {
  const phase = phaseOf(row);
  const visible = passSees(scope, row);
  return {
    ...row.item,
    lineId: row.lineId,
    orderId: row.orderId,
    stationId: row.stationId,
    phase,
    requestedAt: row.requestedAt,
    readyAt: row.readyAt,
    visible,
    informational: !visible || (dims && !isPassWork(row)),
    passControlled: row.passControlled,
    course: row.course,
    stationClosed: row.stationClosed,
    extra: row.extra,
  };
}

function itemOrder(a: PassRow, b: PassRow): number {
  const course = (row: PassRow) => row.course?.displayOrder ?? null;
  const [ca, cb] = [course(a), course(b)];
  return (
    byText(a.order.openedAt, b.order.openedAt) ||
    (ca === cb ? 0 : ca === null ? -1 : cb === null ? 1 : ca - cb) ||
    a.lineNo - b.lineNo ||
    byText(a.item.id, b.item.id)
  );
}

interface Placed {
  card: PassCard;
  column: Column;
  heldOrder: [string, string, number];
}

function placeCard(
  key: string,
  cardRows: PassRow[],
  scope: PassScope,
  dims: boolean,
  releases: boolean,
): Placed | null {
  cardRows.sort(itemOrder);
  const items = cardRows.map((row) => cardItem(row, scope, dims));
  if (!items.some((item) => item.visible)) return null;
  const first = cardRows[0]!;
  const group = first.group;
  const target: PassTarget =
    group === null
      ? { kind: "bill", workingOrderId: first.orderId }
      : { kind: "group", partyId: group.partyId, groupId: group.id };
  const allHeld = items.every((item) => item.phase === "held");
  const allReady = items.every((item) => item.phase === "ready");
  const column: Column = cardRows.some((row) => isCandidate(row, scope))
    ? "toFire"
    : allHeld
      ? "held"
      : allReady
        ? "ready"
        : "inProgress";
  const initiated = cardRows
    .map(initiatedAt)
    .filter((time): time is string => time !== null)
    .sort(byText);
  const readyTimes = cardRows
    .map((row) => row.readyAt)
    .filter((time): time is string => time !== null)
    .sort(byText);
  const orders = new Map<string, PassCard["orders"][number]>();
  for (const row of [...cardRows].sort(
    (a, b) => byText(a.order.openedAt, b.order.openedAt) || byText(a.orderId, b.orderId),
  )) {
    if (orders.has(row.orderId)) continue;
    const { openedAt, ...order } = row.order;
    void openedAt;
    orders.set(row.orderId, { orderId: row.orderId, ...order });
  }
  const release = releases
    ? passCardRelease(target, cardRows, scope)
    : { ticketItemIds: [], context: null };
  const card: PassCard = {
    key,
    target,
    kind: allHeld ? "held" : (group?.requestKind ?? "new_order"),
    requestedAt: initiated[0] ?? null,
    readyAt: column === "ready" ? (readyTimes.at(-1) ?? null) : null,
    allReady,
    ...(group !== null ? { party: { id: group.partyId, revision: group.partyRevision } } : {}),
    orders: [...orders.values()],
    ...(group === null
      ? {}
      : {
          group: {
            displayNumber: group.displayNumber,
            ...(group.numberPartyLabel === undefined
              ? {}
              : { numberPartyLabel: group.numberPartyLabel }),
            position: group.position,
          },
        }),
    items,
    releaseTicketItemIds: release.ticketItemIds,
    releaseContext: release.context,
  };
  const heldOrder: Placed["heldOrder"] =
    group === null
      ? [first.order.openedAt, first.orderId, 0]
      : [group.partyFirstCreatedAt, group.partyId, group.position];
  return { card, column, heldOrder };
}

export interface PassBoardOptions {
  showNonPassStations?: boolean;
  /** Releasing needs a pass screen, so a monitor's and a till's All stations cards name nothing
   *  to release. */
  release?: boolean;
  aStationInViewWaits?: boolean;
}

export function buildPassBoard(
  rows: readonly PassRow[],
  scope: PassScope,
  {
    showNonPassStations = true,
    release = true,
    aStationInViewWaits = false,
  }: PassBoardOptions = {},
): PassBoard {
  const live = rows.filter((row) => !row.recalled && row.remaining > 0);
  // Until the pass controls something in its view, nothing in view is dimmed (D89).
  const dims = aStationInViewWaits || live.some((row) => passSees(scope, row) && isPassWork(row));
  const byCard = new Map<string, PassRow[]>();
  for (const row of live) {
    const key = passCardKey(row);
    const cardRows = byCard.get(key);
    if (cardRows === undefined) byCard.set(key, [row]);
    else cardRows.push(row);
  }
  const placed = [...byCard]
    .map(([key, cardRows]) => placeCard(key, cardRows, scope, dims, release))
    .filter((entry): entry is Placed => entry !== null);
  const column = (name: Column, order: (a: Placed, b: Placed) => number) =>
    placed
      .filter((entry) => entry.column === name)
      .sort((a, b) => order(a, b) || byText(a.card.key, b.card.key))
      .map((entry) => entry.card);
  const byRequest = (a: Placed, b: Placed) =>
    byText(a.card.requestedAt ?? "", b.card.requestedAt ?? "");
  const board: PassBoard = {
    held: column(
      "held",
      (a, b) =>
        byText(a.heldOrder[0], b.heldOrder[0]) ||
        byText(a.heldOrder[1], b.heldOrder[1]) ||
        a.heldOrder[2] - b.heldOrder[2],
    ),
    toFire: column("toFire", byRequest),
    inProgress: column("inProgress", byRequest),
    ready: column("ready", (a, b) => byText(a.card.readyAt ?? "", b.card.readyAt ?? "")),
    overview: [],
  };
  for (const card of [...board.held, ...board.toFire, ...board.inProgress, ...board.ready]) {
    if (!showNonPassStations) {
      const hidden = card.items.filter((item) => item.informational);
      if (hidden.length > 0) {
        card.items = card.items.filter((item) => !item.informational);
        card.hiddenItems = hidden;
      }
    }
    for (const item of card.items) {
      board.overview.push({
        lineId: item.lineId,
        stationId: item.stationId,
        name: item.name,
        qty: item.qty,
        phase: item.phase,
        informational: item.informational,
        unitName: item.unitName,
        soldInEach: item.soldInEach,
      });
    }
  }
  return board;
}

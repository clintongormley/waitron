import type { PassBoard, PassCard, PassCardItem } from "../src/api/client.js";

export const PASS_NOW = Date.parse("2026-11-02T20:00:00.000Z");

/** An ISO time `minutes` before {@link PASS_NOW}. */
export function minutesAgo(minutes: number): string {
  return new Date(PASS_NOW - minutes * 60_000).toISOString();
}

/** A released, in-view dish of this pass's own work, Waiting at Grill, sent a minute ago. */
export function passItem(overrides: Partial<PassCardItem> = {}): PassCardItem {
  return {
    allergy: null,
    id: "ti-1",
    name: "Steak",
    qty: "1",
    stationName: "Grill",
    state: "queued",
    firedAt: minutesAgo(1),
    queuedAt: minutesAgo(1),
    thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
    band: "fresh",
    lineId: "line-1",
    orderId: "order-1",
    stationId: "st-grill",
    phase: "waiting",
    requestedAt: minutesAgo(1),
    readyAt: null,
    visible: true,
    informational: false,
    passControlled: true,
    course: { id: "course-mains", name: "Mains", displayOrder: 2 },
    stationClosed: false,
    extra: false,
    ...overrides,
  };
}

/** An In progress bill card of one order at table T1, asked for a minute ago. */
export function passCard(overrides: Partial<PassCard> = {}): PassCard {
  return {
    key: "bill:order-1",
    target: { kind: "bill", workingOrderId: "order-1" },
    kind: "new_order",
    requestedAt: minutesAgo(1),
    readyAt: null,
    allReady: false,
    orders: [{ orderId: "order-1", orderNumber: 1, tableLabel: "T1", kitchenNote: null }],
    items: [passItem()],
    releaseTicketItemIds: [],
    releaseContext: null,
    ...overrides,
  };
}

export function passBoard(overrides: Partial<PassBoard> = {}): PassBoard {
  return { held: [], toFire: [], inProgress: [], ready: [], overview: [], ...overrides };
}

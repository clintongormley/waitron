import { describe, expect, it } from "vitest";
import type { PassBoard, PassCard, PassCardItem } from "../pass-card.js";
import { boardCards, boardItems, boardOrderIds, cardOf } from "./pass-board-probe.js";

const dish = (id: string, orderId: string, visible: boolean) =>
  ({ id, orderId, visible }) as PassCardItem;

const card = (key: string, orderIds: string[], items: PassCardItem[]) =>
  ({ key, orders: orderIds.map((orderId) => ({ orderId })), items }) as PassCard;

const board: PassBoard = {
  held: [card("held", ["b"], [dish("h1", "b", true)])],
  toFire: [card("fire", ["c"], [dish("f1", "c", false)])],
  inProgress: [card("split", ["a", "d"], [dish("p1", "a", true), dish("p2", "d", false)])],
  ready: [card("ready", ["a"], [dish("r1", "a", true)])],
  overview: [],
};

describe("the pass board probe", () => {
  it("reads every column's cards, Held, To fire, In progress, then Ready", () => {
    expect(boardCards(board).map((c) => c.key)).toEqual(["held", "fire", "split", "ready"]);
  });

  it("lists every dish, or only those in view", () => {
    expect(boardItems(board).map((i) => i.id)).toEqual(["h1", "f1", "p1", "p2", "r1"]);
    expect(boardItems(board, { inView: true }).map((i) => i.id)).toEqual(["h1", "p1", "r1"]);
  });

  it("lists each order once, sorted; in view, only the orders of dishes in view", () => {
    expect(boardOrderIds(board)).toEqual(["a", "b", "c", "d"]);
    expect(boardOrderIds(board, { inView: true })).toEqual(["a", "b"]);
  });

  it("finds the one matching card, and throws on none or several", () => {
    expect(cardOf(board, (c) => c.key === "ready").key).toBe("ready");
    expect(() => cardOf(board, (c) => c.key === "missing")).toThrow(/found 0/);
    expect(() => cardOf(board, (c) => c.orders.some((o) => o.orderId === "a"))).toThrow(/found 2/);
  });
});
